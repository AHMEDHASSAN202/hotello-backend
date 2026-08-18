import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TenantUrlsService } from '../hotels/tenant-urls.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import { BulkCommitDto } from './dto/bulk-commit.dto';
import { BulkPreviewDto } from './dto/bulk-preview.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import {
  expandRange,
  RoomRowInput,
  RowIssue,
  validateRoomRows,
  ValidatedRow,
} from './room-rows';
import { QrFormat, QrResult, RoomQrService } from './room-qr.service';
import { COUNTABLE_ROOM_STATUSES, Room, RoomStatus } from './room.entity';
import { RoomType } from './room-type.entity';
import { IMPORT_XLSX_MIME_TYPES } from './xlsx/rooms-xlsx.constants';
import { RoomsXlsxService } from './xlsx/rooms-xlsx.service';

/**
 * Story 11.2 — the natural-sort expression for room numbers: numeric prefix
 * cast to bigint (so "2" sorts before "10"), `NULLIF` turns a non-numeric
 * prefix (or none at all) into SQL NULL so those rows fall through to the
 * `NULLS LAST` tiebreak on the plain `roomNumber` string. Exported so tests
 * can assert the exact expression reaches the query builder.
 */
export const NATURAL_ROOM_ORDER = `NULLIF(regexp_replace(r."roomNumber", '\\D.*$', ''), '')::bigint`;

/** `RoomView` shape returned by list + detail (Story 11.2). */
export interface RoomView {
  id: string;
  roomNumber: string;
  floor: number | null;
  status: Room['status'];
  roomType: { id: string; nameEn: string; nameAr: string };
}

/** Detail response (Story 11.5 AC4) — `RoomView` plus the derived guest URL. */
export interface RoomDetailView extends RoomView {
  guestUrl: string;
}

/** A generated QR's bytes plus the filename the download should carry (Story 11.5 AC3). */
export interface RoomQrDownload extends QrResult {
  filename: string;
}

/** One row of a bulk-range preview (Story 11.3 AC2). */
export interface PreviewRow {
  row: number;
  roomNumber: string;
  floor: number | null;
  roomTypeId: string | null;
  status: 'active' | 'out_of_service';
  duplicate: boolean;
  issues: RowIssue[];
}

/** `POST /tenant/rooms/bulk/preview` response (Story 11.3 AC2). */
export interface BulkPreview {
  rows: PreviewRow[];
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  remaining: number | null;
}

@Injectable()
export class TenantRoomsService {
  constructor(
    @InjectRepository(Room)
    private readonly roomsRepo: Repository<Room>,
    @InjectRepository(RoomType)
    private readonly roomTypesRepo: Repository<RoomType>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly subscriptions: SubscriptionsService,
    private readonly dataSource: DataSource,
    private readonly auditLogs: AuditLogsService,
    private readonly tenantUrls: TenantUrlsService,
    private readonly roomQrService: RoomQrService,
    // Story 11.7 — RoomsXlsxService.parseImport (xlsx -> RoomRowInput[]).
    // forwardRef both directions: RoomsXlsxService already depends on this
    // service (exportForHotel calls listAllForExport), so the two are
    // mutually dependent within the same module.
    @Inject(forwardRef(() => RoomsXlsxService))
    private readonly roomsXlsxService: RoomsXlsxService,
  ) {}

  /**
   * Story 11.2 AC2/AC3 — hotel-scoped, filterable, naturally-sorted room
   * list plus the plan usage counter. `usage.used` reads the hotel's
   * derived `roomsCount` (kept live by every mutation in this epic) rather
   * than a live COUNT, so the list path stays cheap.
   */
  async list(hotelId: string, query: ListRoomsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    // IMPORTANT — never leftJoinAndSelect('r.roomType', …) on this query.
    // TypeORM only special-cases raw-SQL addOrderBy() through its normal
    // planner when the query has NO joins. The moment skip/take is combined
    // with ANY join, TypeORM switches to a two-pass "distinct ids" pagination
    // algorithm (SelectQueryBuilder#executeEntitiesAndRawResults: `(skip ||
    // take) && joinAttributes.length > 0`) that tries to recombine every
    // orderBy entry with the SELECT by naively splitting it on the first
    // "." — which blows up on NATURAL_ROOM_ORDER's embedded `r."roomNumber"`
    // with `"NULLIF(regexp_replace(r" alias was not found` against real
    // Postgres (fully-mocked unit tests never generate real SQL, so they
    // can't catch this). Fix: fetch the bare Room page with zero joins
    // (matches RoomsPdfService.roomsForScope, already smoke-tested), then
    // batch-load roomType for just that page below.
    const qb = this.roomsRepo.createQueryBuilder('r');
    this.applyRoomFilters(qb, hotelId, query);

    // The total count is taken before orderBy/skip/take are applied — cheap
    // and keeps the count query minimal regardless of the pagination path.
    const total = await qb.getCount();

    // Story 11.2 AC2 — floor groups first (unset floors last), then the
    // "101, 102, …, 110" natural order within a floor.
    qb.orderBy('r.floor', 'ASC', 'NULLS LAST')
      .addOrderBy(NATURAL_ROOM_ORDER, 'ASC', 'NULLS LAST')
      .addOrderBy('r.roomNumber', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    // The now-ordered page, hotel (for the derived counter) and the plan
    // limit are independent lookups — fetch them concurrently.
    const [rows, hotel, max] = await Promise.all([
      qb.getMany(),
      this.hotelsRepo.findOne({ where: { id: hotelId } }),
      this.roomsLimit(hotelId),
    ]);
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }

    const roomTypes = await this.loadRoomTypesByIds(
      rows.map((room) => room.roomTypeId),
    );

    return {
      data: rows.map((room) =>
        this.toRoomView({
          ...room,
          roomType: roomTypes.get(room.roomTypeId) as RoomType,
        }),
      ),
      total,
      page,
      pageSize,
      usage: {
        used: hotel.roomsCount,
        max,
      },
    };
  }

  /** Batch-loads room types for a page of rooms — no join, no N+1. */
  private async loadRoomTypesByIds(
    ids: string[],
  ): Promise<Map<string, RoomType>> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return new Map();
    const types = await this.roomTypesRepo.find({
      where: { id: In(uniqueIds) },
    });
    return new Map(types.map((type) => [type.id, type]));
  }

  /**
   * Story 11.2/11.7 — the hotelId scope + optional filter clauses shared by
   * `list()` and `listAllForExport()`, kept in one place so the two paths
   * can never drift apart (a filter added to one and not the other would
   * make the export silently disagree with what the screen shows).
   */
  private applyRoomFilters(
    qb: SelectQueryBuilder<Room>,
    hotelId: string,
    query: Pick<ListRoomsQueryDto, 'floor' | 'typeId' | 'status' | 'search'>,
  ): SelectQueryBuilder<Room> {
    qb.where('r.hotelId = :hotelId', { hotelId });

    if (query.floor !== undefined) {
      qb.andWhere('r.floor = :floor', { floor: query.floor });
    }
    if (query.typeId) {
      qb.andWhere('r.roomTypeId = :typeId', { typeId: query.typeId });
    }
    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }
    if (query.search) {
      qb.andWhere('r."roomNumber" ILIKE :q', {
        q: `%${query.search.trim().toUpperCase()}%`,
      });
    }
    return qb;
  }

  /**
   * Story 11.7 — the same hotel scope, filters and natural order as
   * `list()`, but with no `skip`/`take`: every matching room, for the xlsx
   * export. Same no-join + batch-load discipline as `list()` (see that
   * method's doc comment for why a join here would be a real-Postgres
   * regression) — there's no pagination to trip the two-pass planner in this
   * path either way, but the fetch stays identical on purpose.
   */
  async listAllForExport(
    hotelId: string,
    query: ListRoomsQueryDto,
  ): Promise<Room[]> {
    const qb = this.roomsRepo.createQueryBuilder('r');
    this.applyRoomFilters(qb, hotelId, query);
    qb.orderBy('r.floor', 'ASC', 'NULLS LAST')
      .addOrderBy(NATURAL_ROOM_ORDER, 'ASC', 'NULLS LAST')
      .addOrderBy('r.roomNumber', 'ASC');

    const rows = await qb.getMany();
    const roomTypes = await this.loadRoomTypesByIds(
      rows.map((room) => room.roomTypeId),
    );
    return rows.map((room) => ({
      ...room,
      roomType: roomTypes.get(room.roomTypeId) as RoomType,
    }));
  }

  /**
   * Story 11.2 AC1/isolation — the cross-tenant chokepoint every later
   * rooms task reuses. Cross-tenant or unknown ids 404, never confirm
   * another hotel's room exists.
   */
  async findRoomInHotel(hotelId: string, id: string): Promise<Room> {
    const room = await this.roomsRepo.findOne({
      where: { id, hotelId },
      relations: ['roomType'],
    });
    if (!room) {
      throw new NotFoundException({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found',
      });
    }
    return room;
  }

  /**
   * Story 11.2/11.5 AC4 — the room detail view (roomType relation) plus the
   * derived guest URL. The slug always comes from the actor's own hotel
   * (loaded server-side by `hotelId`) — never from client input.
   */
  async detail(hotelId: string, id: string): Promise<RoomDetailView> {
    const [room, hotel] = await Promise.all([
      this.findRoomInHotel(hotelId, id),
      this.loadHotel(hotelId),
    ]);
    return {
      ...this.toRoomView(room),
      guestUrl: this.tenantUrls.buildGuestUrl(hotel.slug, {
        room: room.roomNumber,
      }),
    };
  }

  /** Story 11.5 AC3/AC4 — `GET /tenant/rooms/qr/general`: the hotel-wide guest URL as a QR. */
  async generalQr(hotelId: string, format: QrFormat): Promise<RoomQrDownload> {
    const hotel = await this.loadHotel(hotelId);
    const url = this.tenantUrls.buildGuestUrl(hotel.slug);
    const { body, contentType } = await this.roomQrService.generate(url, format);
    return { body, contentType, filename: `general-qr.${format}` };
  }

  /**
   * Story 11.5 AC3/AC4 — `GET /tenant/rooms/:id/qr`: the room-scoped guest
   * URL as a QR. Reuses `findRoomInHotel`, so a cross-tenant id 404s before
   * any QR is generated (never confirms another hotel's room exists).
   */
  async roomQr(
    hotelId: string,
    id: string,
    format: QrFormat,
  ): Promise<RoomQrDownload> {
    const [room, hotel] = await Promise.all([
      this.findRoomInHotel(hotelId, id),
      this.loadHotel(hotelId),
    ]);
    const url = this.tenantUrls.buildGuestUrl(hotel.slug, {
      room: room.roomNumber,
    });
    const { body, contentType } = await this.roomQrService.generate(url, format);
    return { body, contentType, filename: `room-${room.roomNumber}.${format}` };
  }

  /** Story 11.5 — loads the actor's own hotel (for its slug); 404s if somehow missing. */
  private async loadHotel(hotelId: string): Promise<Hotel> {
    const hotel = await this.hotelsRepo.findOne({ where: { id: hotelId } });
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }
    return hotel;
  }

  /** Story 11.2 AC3 — the current plan's `maxRooms` (`null` = unlimited). */
  async roomsLimit(hotelId: string): Promise<number | null> {
    const { current } = await this.subscriptions.getForHotel(hotelId);
    return current?.plan?.maxRooms ?? null;
  }

  /**
   * Countable rooms = `active` + `out_of_service` (global constraint).
   * A live COUNT within a caller's transaction — used by later tasks
   * (bulk create/import) that must check the plan limit against rooms not
   * yet reflected in `hotel.roomsCount`.
   */
  async countCountable(manager: EntityManager, hotelId: string): Promise<number> {
    return manager
      .getRepository(Room)
      .createQueryBuilder('r')
      .where('r.hotelId = :hotelId', { hotelId })
      .andWhere('r.status IN (:...statuses)', {
        statuses: COUNTABLE_ROOM_STATUSES,
      })
      .getCount();
  }

  /**
   * Story 11.3 AC1/AC3/AC5 — create a single room. Runs the seat-limit check,
   * room-type validation and dupe check inside one transaction (pessimistic
   * hotel lock, so two concurrent creates for the last seat can't both pass),
   * then audits after commit.
   */
  async createRoom(actor: TenantUser, dto: CreateRoomDto): Promise<Room> {
    const room = await this.dataSource.transaction(async (manager) => {
      const { hotel, used } = await this.assertRoomSeatAvailable(
        manager,
        actor.hotelId,
        1,
      );
      const roomType = await this.assertTypeInHotel(
        manager,
        actor.hotelId,
        dto.roomTypeId,
      );

      const roomNumber = dto.roomNumber.trim().toUpperCase();
      const dupe = await manager
        .getRepository(Room)
        .findOne({ where: { hotelId: actor.hotelId, roomNumber } });
      if (dupe) {
        throw new ConflictException({
          code: 'ROOM_NUMBER_TAKEN',
          message: `Room ${roomNumber} already exists`,
          roomNumber,
        });
      }

      const roomsRepo = manager.getRepository(Room);
      const saved = await roomsRepo.save(
        roomsRepo.create({
          hotelId: actor.hotelId,
          roomNumber,
          floor: dto.floor ?? null,
          roomTypeId: dto.roomTypeId,
          status: dto.status ?? 'active',
        }),
      );

      hotel.roomsCount = used + 1;
      await manager.getRepository(Hotel).save(hotel);

      saved.roomType = roomType;
      return saved;
    });

    await this.auditLogs.log({
      action: 'room.created',
      entityType: 'room',
      entityId: room.id,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId: actor.hotelId,
        roomNumber: room.roomNumber,
      },
    });

    return room;
  }

  /**
   * Story 11.4 — edit a room and/or transition its status. Runs entirely in
   * one transaction: the hotel row is locked FIRST (same discipline as every
   * other room-mutating path — see `lockHotel`'s doc comment), so a
   * concurrent create/bulk-commit/update can't race the seat count or a
   * room-number dupe check against a stale snapshot.
   *
   * AC1 — floor/type/status are always editable; the room number is only
   * editable while `hasStayHistory()` is false (currently always — see that
   * method's doc). AC2 — a status change that moves the room INTO the
   * countable set (`inactive` → `active`/`out_of_service`) re-checks the
   * plan limit BEFORE the room is saved, using the count of its current
   * (still non-countable) state so it isn't double-counted against itself;
   * a change between the two countable statuses needs no limit check at all.
   * Every status change recomputes `hotel.roomsCount` from the just-saved
   * row AFTER saving (the staff `disable()`/`enable()` discipline).
   */
  async updateRoom(
    actor: TenantUser,
    id: string,
    dto: UpdateRoomDto,
  ): Promise<RoomView> {
    const { room, diff } = await this.dataSource.transaction(async (manager) => {
      const hotel = await this.lockHotel(manager, actor.hotelId);
      const roomsRepo = manager.getRepository(Room);

      const room = await roomsRepo.findOne({
        where: { id, hotelId: actor.hotelId },
        relations: ['roomType'],
      });
      if (!room) {
        throw new NotFoundException({
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found',
        });
      }

      const diff: Record<string, { from: unknown; to: unknown }> = {};

      if (dto.roomTypeId !== undefined && dto.roomTypeId !== room.roomTypeId) {
        const roomType = await this.assertTypeInHotel(
          manager,
          actor.hotelId,
          dto.roomTypeId,
        );
        diff.roomTypeId = { from: room.roomTypeId, to: dto.roomTypeId };
        room.roomTypeId = dto.roomTypeId;
        room.roomType = roomType;
      }

      if (dto.floor !== undefined && dto.floor !== room.floor) {
        diff.floor = { from: room.floor, to: dto.floor };
        room.floor = dto.floor;
      }

      if (dto.roomNumber !== undefined) {
        // Epic 12: check stays table — once stays exist, a true result here
        // throws instead of falling through to the renumber below. The stub
        // always returns false today, so every renumber is currently allowed.
        const hasHistory = await this.hasStayHistory(room.id);
        if (!hasHistory) {
          const normalized = dto.roomNumber.trim().toUpperCase();
          if (normalized !== room.roomNumber) {
            const dupe = await roomsRepo.findOne({
              where: { hotelId: actor.hotelId, roomNumber: normalized },
            });
            if (dupe && dupe.id !== room.id) {
              throw new ConflictException({
                code: 'ROOM_NUMBER_TAKEN',
                message: `Room ${normalized} already exists`,
                roomNumber: normalized,
              });
            }
            diff.roomNumber = { from: room.roomNumber, to: normalized };
            room.roomNumber = normalized;
          }
        }
      }

      const statusChanged =
        dto.status !== undefined && dto.status !== room.status;
      if (statusChanged) {
        const wasCountable = COUNTABLE_ROOM_STATUSES.includes(room.status);
        const willBeCountable = COUNTABLE_ROOM_STATUSES.includes(
          dto.status as RoomStatus,
        );
        if (!wasCountable && willBeCountable) {
          // AC2 re-enable discipline — count BEFORE this room's status
          // flips, so it isn't counted against its own reactivation.
          const used = await this.countCountable(manager, actor.hotelId);
          await this.assertWithinLimit(actor.hotelId, used, 1);
        }
        diff.status = { from: room.status, to: dto.status };
        room.status = dto.status as RoomStatus;
      }

      const hasChanges = Object.keys(diff).length > 0;
      const saved = hasChanges ? await roomsRepo.save(room) : room;

      if (statusChanged) {
        // Recompute from the just-saved row, not an arithmetic +/-1 — a
        // lateral active<->out_of_service move must report the same total.
        hotel.roomsCount = await this.countCountable(manager, actor.hotelId);
        await manager.getRepository(Hotel).save(hotel);
      }

      return { room: saved, diff };
    });

    if (Object.keys(diff).length > 0) {
      await this.auditLogs.log({
        action: 'room.updated',
        entityType: 'room',
        entityId: room.id,
        actorId: actor.id,
        metadata: {
          actorType: 'tenant_user',
          hotelId: actor.hotelId,
          diff,
        },
      });
    }

    return this.toRoomView(room);
  }

  /**
   * Story 11.4 AC1 — whether this room has ever hosted a guest stay. Once
   * true, renumbering is blocked (the number is printed on QR cards tied to
   * that stay's history). No stays table exists yet, so this always returns
   * false — Epic 12 wires the real check.
   */
  async hasStayHistory(roomId: string): Promise<boolean> {
    // Epic 12: check stays table
    return false;
  }

  /**
   * Story 11.3 AC2 — expands the range, validates every number against a
   * fresh (non-transactional) read of the hotel's existing numbers + active
   * room types, and reports remaining seats. Read-only: nothing is written,
   * so a stale preview just gets re-resolved by `bulkCommit`.
   */
  async bulkPreview(actor: TenantUser, dto: BulkPreviewDto): Promise<BulkPreview> {
    const numbers = expandRange({
      from: dto.from,
      to: dto.to,
      exclusions: dto.exclusions,
    });
    const rowInputs: RoomRowInput[] = numbers.map((roomNumber, i) => ({
      row: i + 1,
      roomNumber,
      floor: dto.floor ?? null,
      roomTypeId: dto.roomTypeId,
      status: 'active',
    }));

    return this.assemblePreview(actor.hotelId, rowInputs);
  }

  /**
   * Story 11.7 AC4/AC5 — the Excel-import counterpart of `bulkPreview`:
   * validates the uploaded file, parses it via `RoomsXlsxService.parseImport`
   * (type names resolved to ids against the hotel's ACTIVE types), then
   * reuses `assemblePreview` so the range and import preview surfaces can
   * never drift apart. Read-only — nothing is written; `bulkCommit` with
   * `source: 'import'` is the only path that persists rows, and it
   * re-validates everything itself under the hotel lock.
   */
  async importPreview(
    actor: TenantUser,
    file: Express.Multer.File,
  ): Promise<BulkPreview> {
    this.assertImportFile(file);

    const hotelId = actor.hotelId;
    const types = await this.roomTypesRepo.find({
      where: { hotelId, isActive: true },
    });

    const { rows } = await this.roomsXlsxService.parseImport(file.buffer, types);
    return this.assemblePreview(hotelId, rows);
  }

  /**
   * Story 11.7 AC5 — `.xlsx` extension + mime-type check, mirroring the
   * `LOGO_MIME_TYPES` upload-validation pattern (`hotels.service.ts`
   * `uploadLogo`). File-size is already capped by `FileInterceptor`
   * (`IMPORT_MAX_BYTES`) before this runs.
   */
  private assertImportFile(
    file?: Express.Multer.File,
  ): asserts file is Express.Multer.File {
    const nameOk = !!file?.originalname?.toLowerCase().endsWith('.xlsx');
    const mimeOk = !!file && IMPORT_XLSX_MIME_TYPES.includes(file.mimetype);
    if (!file || !nameOk || !mimeOk) {
      throw new BadRequestException({
        code: 'IMPORT_FILE_INVALID',
        message: 'Please upload a valid .xlsx file',
      });
    }
  }

  /**
   * Story 11.3/11.7 — the preview-assembly logic shared by the range
   * (`bulkPreview`) and Excel-import (`importPreview`) surfaces: loads a
   * fresh (non-transactional) read of the hotel's existing numbers, active
   * room-type ids and seat usage, runs `validateRoomRows` (the single
   * validation source), and reports remaining plan seats. Read-only: nothing
   * is written, so a stale preview just gets re-resolved by `bulkCommit`.
   */
  private async assemblePreview(
    hotelId: string,
    rowInputs: RoomRowInput[],
  ): Promise<BulkPreview> {
    const manager = this.dataSource.manager;

    const [existingNumbers, typeIds, used, limit] = await Promise.all([
      this.loadExistingNumbers(manager, hotelId),
      this.loadActiveTypeIds(manager, hotelId),
      this.countCountable(manager, hotelId),
      this.roomsLimit(hotelId),
    ]);

    const { rows } = validateRoomRows(rowInputs, { existingNumbers, typeIds });
    const previewRows = rows.map((row) => this.toPreviewRow(row));

    return {
      rows: previewRows,
      validCount: previewRows.filter((r) => r.issues.length === 0).length,
      duplicateCount: previewRows.filter((r) => r.duplicate).length,
      invalidCount: previewRows.filter((r) => !r.duplicate && r.issues.length > 0)
        .length,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  }

  /**
   * Story 11.3 AC4/AC5 — commits a bulk batch (range or Excel import, Story
   * 11.7) in one transaction: locks the hotel row FIRST (race guard — see
   * `lockHotel`'s doc comment), only then re-validates every row against a
   * fresh, lock-consistent read (a stale preview can't create a duplicate or
   * bust the seat limit), skips or rejects mid-flight duplicates per
   * `skipDuplicates`, rejects on any other issue, then inserts survivors in
   * one `manager.save` and bumps `hotel.roomsCount`. Audits after commit.
   */
  async bulkCommit(
    actor: TenantUser,
    dto: BulkCommitDto,
  ): Promise<{ created: number; skipped: number }> {
    const hotelId = actor.hotelId;

    const result = await this.dataSource.transaction(async (manager) => {
      // Lock the hotel row and read the current countable count BEFORE
      // reading existing room numbers/types — every other room-mutating path
      // (createRoom) does the same, so any two concurrent mutations
      // serialize here instead of both reading a pre-insert snapshot.
      const hotel = await this.lockHotel(manager, hotelId);
      const used = await this.countCountable(manager, hotelId);

      const [existingNumbers, typeIds] = await Promise.all([
        this.loadExistingNumbers(manager, hotelId),
        this.loadActiveTypeIds(manager, hotelId),
      ]);

      const rowInputs: RoomRowInput[] = dto.rooms.map((row) => ({
        row: row.row,
        roomNumber: row.roomNumber,
        floor: row.floor ?? null,
        roomTypeId: row.roomTypeId,
        // DTO status is typed as the full RoomStatus (mirrors CreateRoomDto)
        // but @IsIn restricts it to active/out_of_service at the boundary.
        status: (row.status ?? 'active') as 'active' | 'out_of_service',
      }));
      const { rows: validated } = validateRoomRows(rowInputs, {
        existingNumbers,
        typeIds,
      });

      const isDuplicate = (r: ValidatedRow) =>
        r.issues.some(
          (i) => i.code === 'DUPLICATE_IN_HOTEL' || i.code === 'DUPLICATE_IN_FILE',
        );
      const otherIssues = validated.filter((r) =>
        r.issues.some(
          (i) => i.code !== 'DUPLICATE_IN_HOTEL' && i.code !== 'DUPLICATE_IN_FILE',
        ),
      );
      if (otherIssues.length > 0) {
        throw new BadRequestException({
          code: 'BULK_ROWS_INVALID',
          message: 'Some rows failed validation',
          issues: validated.flatMap((r) => r.issues),
        });
      }

      const duplicateRows = validated.filter(isDuplicate);
      if (duplicateRows.length > 0 && !dto.skipDuplicates) {
        throw new ConflictException({
          code: 'ROOM_NUMBER_TAKEN',
          message: `Room ${duplicateRows[0].normalizedNumber} already exists`,
          roomNumbers: duplicateRows.map((r) => r.normalizedNumber),
        });
      }

      const survivors = validated.filter((r) => !isDuplicate(r));

      // Limit check deferred until here — now that `survivors.length` (the
      // real number of seats this commit needs) is known — but reuses the
      // SAME `used` figure read right after the lock above, so the whole
      // count-then-check stays atomic within this one locked transaction.
      await this.assertWithinLimit(hotelId, used, survivors.length);

      const roomsRepo = manager.getRepository(Room);
      const entities = survivors.map((r) =>
        roomsRepo.create({
          hotelId,
          roomNumber: r.normalizedNumber,
          floor: r.floor,
          // Survivors have no REQUIRED/UNKNOWN_TYPE issue (those were
          // rejected above as "other issues"), so roomTypeId is guaranteed.
          roomTypeId: r.roomTypeId as string,
          status: r.status,
        }),
      );
      const saved = entities.length > 0 ? await manager.save(Room, entities) : [];

      hotel.roomsCount = used + saved.length;
      await manager.getRepository(Hotel).save(hotel);

      return { created: saved.length, skipped: duplicateRows.length };
    });

    // Audit outside the transaction (global rule: never audit inside it).
    // There's no single room to point at for a bulk operation, so entityId
    // is the hotel id — the metadata carries the per-row detail instead.
    await this.auditLogs.log({
      action: dto.source === 'import' ? 'rooms.imported' : 'rooms.bulk_created',
      entityType: 'room',
      entityId: hotelId,
      actorId: actor.id,
      metadata: {
        actorType: 'tenant_user',
        hotelId,
        count: result.created,
        skipped: result.skipped,
        range: dto.range ?? null,
        source: dto.source,
      },
    });

    return result;
  }

  /** Story 11.3 — normalized room numbers already taken in the hotel. */
  private async loadExistingNumbers(
    manager: EntityManager,
    hotelId: string,
  ): Promise<Set<string>> {
    const rows = await manager
      .getRepository(Room)
      .find({ where: { hotelId }, select: ['roomNumber'] });
    return new Set(rows.map((r) => r.roomNumber));
  }

  /** Story 11.3 — ids of active room types the hotel can assign to a row. */
  private async loadActiveTypeIds(
    manager: EntityManager,
    hotelId: string,
  ): Promise<Set<string>> {
    const rows = await manager
      .getRepository(RoomType)
      .find({ where: { hotelId, isActive: true }, select: ['id'] });
    return new Set(rows.map((r) => r.id));
  }

  /** Story 11.3 — `ValidatedRow` → the shape `bulkPreview` returns to the UI. */
  private toPreviewRow(row: ValidatedRow): PreviewRow {
    const duplicate = row.issues.some(
      (i) => i.code === 'DUPLICATE_IN_HOTEL' || i.code === 'DUPLICATE_IN_FILE',
    );
    return {
      row: row.row,
      roomNumber: row.normalizedNumber,
      floor: row.floor,
      roomTypeId: row.roomTypeId,
      status: row.status,
      duplicate,
      issues: row.issues,
    };
  }

  /**
   * Story 11.3 AC3 — THE chokepoint for the plan room-limit guard, reused by
   * bulk create and status-change tasks. Locks the hotel row
   * (`pessimistic_write`) so the count and the limit check happen atomically
   * within the caller's transaction, then hands back `{ hotel, used }` so the
   * caller updates `hotel.roomsCount` itself (the exact seats it is adding
   * may differ per caller).
   */
  private async assertRoomSeatAvailable(
    manager: EntityManager,
    hotelId: string,
    adding: number,
  ): Promise<{ hotel: Hotel; used: number }> {
    const hotel = await this.lockHotel(manager, hotelId);
    const used = await this.countCountable(manager, hotelId);
    await this.assertWithinLimit(hotelId, used, adding);
    return { hotel, used };
  }

  /**
   * Story 11.3 AC3/AC4 — the `pessimistic_write` hotel-row lock, split out of
   * `assertRoomSeatAvailable` so `bulkCommit` can acquire it BEFORE reading
   * existing room numbers / room types (fix for a race: two concurrent bulk
   * commits — or a bulk commit racing `createRoom` — must not both read
   * "not a duplicate" pre-lock and then both try to insert the same number;
   * everyone that mutates rooms takes this lock first, so the loser's read
   * of existing numbers always reflects the winner's committed insert).
   */
  private async lockHotel(manager: EntityManager, hotelId: string): Promise<Hotel> {
    const hotel = await manager.getRepository(Hotel).findOne({
      where: { id: hotelId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!hotel) {
      throw new NotFoundException({
        code: 'HOTEL_NOT_FOUND',
        message: 'Hotel not found',
      });
    }
    return hotel;
  }

  /** Story 11.3 AC3 — the plan-limit check on its own, given an already-known `used`. */
  private async assertWithinLimit(
    hotelId: string,
    used: number,
    adding: number,
  ): Promise<void> {
    const limit = await this.roomsLimit(hotelId);
    if (limit !== null && used + adding > limit) {
      throw new ConflictException({
        code: 'ROOM_LIMIT_REACHED',
        message: `Your plan allows up to ${limit} room(s)`,
        limit,
        used,
        remaining: Math.max(0, limit - used),
      });
    }
  }

  /** Story 11.3 — resolve a room type within the hotel inside a transaction. */
  private async assertTypeInHotel(
    manager: EntityManager,
    hotelId: string,
    roomTypeId: string,
  ): Promise<RoomType> {
    const type = await manager
      .getRepository(RoomType)
      .findOne({ where: { id: roomTypeId, hotelId } });
    if (!type) {
      throw new NotFoundException({
        code: 'ROOM_TYPE_NOT_FOUND',
        message: 'Room type not found',
      });
    }
    return type;
  }

  /** Public: the controller maps `createRoom`'s `Room` result through this. */
  toRoomView(room: Room): RoomView {
    return {
      id: room.id,
      roomNumber: room.roomNumber,
      floor: room.floor,
      status: room.status,
      roomType: {
        id: room.roomType.id,
        nameEn: room.roomType.nameEn,
        nameAr: room.roomType.nameAr,
      },
    };
  }
}

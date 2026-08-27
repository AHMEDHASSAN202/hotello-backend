import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { Hotel } from '../hotels/hotel.entity';
import { TranslationMap } from '../requests/requests.constants';
import { TenantUser } from '../tenant-users/tenant-user.entity';
import {
  mergeDescriptions,
  mergeNames,
  touchesDescriptions,
  touchesNames,
} from '../fnb/fnb-translations.util';
import {
  CreateInfoEntryDto,
  ReorderInfoEntriesDto,
  UpdateInfoEntryDto,
  UpsertAboutDto,
  UpsertEssentialsDto,
} from './dto/hotel-info.dto';
import { HotelInfoEntry } from './hotel-info-entry.entity';
import {
  EssentialsStructured,
  HotelInfoSection,
  HotelInfoStructured,
  REPEATABLE_SECTIONS,
} from './hotel-info.constants';
import {
  HotelInfoManageView,
  InfoEntryManageView,
  toManageView,
} from './hotel-info-view';

const ESSENTIALS_FIELDS = [
  'wifiName',
  'wifiPassword',
  'receptionPhone',
  'whatsapp',
  'emergencyPhone',
] as const;

/** Aux translated fields, flattened per the F&B DTO convention. */
const LANG_SUFFIXES = [
  ['Ar', 'ar'],
  ['En', 'en'],
  ['Ru', 'ru'],
  ['Fr', 'fr'],
  ['It', 'it'],
  ['Es', 'es'],
  ['De', 'de'],
] as const;

type AuxPrefix = 'locationNote' | 'howTo' | 'priceNote';
type LangSuffix = (typeof LANG_SUFFIXES)[number][0];
/** Structural view of the flat DTO fields the helpers below read. */
type AuxFields = Partial<Record<`${AuxPrefix}${LangSuffix}`, string>> & {
  windows?: { start: string; end: string }[];
};

/** Which structured fields each repeatable section accepts (AC1). */
const SECTION_FIELDS: Record<string, ('windows' | AuxPrefix)[]> = {
  facilities: ['windows', 'locationNote'],
  services: ['howTo', 'priceNote'],
  house_rules: [],
};

function auxDtoValues(
  prefix: AuxPrefix,
  dto: AuxFields,
): Partial<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [suffix, lang] of LANG_SUFFIXES) {
    const value = dto[`${prefix}${suffix}`];
    if (typeof value === 'string') out[lang] = value;
  }
  return out;
}

function touchesAux(prefix: AuxPrefix, dto: AuxFields): boolean {
  return LANG_SUFFIXES.some(
    ([suffix]) => dto[`${prefix}${suffix}`] !== undefined,
  );
}

/** Merge aux locale values over an existing map; empty collapses away. */
function mergeAux(
  prefix: AuxPrefix,
  dto: AuxFields,
  existing: TranslationMap | undefined,
): TranslationMap | undefined {
  const merged: TranslationMap = { ...(existing ?? {}) };
  for (const [lang, value] of Object.entries(auxDtoValues(prefix, dto))) {
    if (value && value.trim()) {
      merged[lang as keyof TranslationMap] = value.trim();
    } else {
      delete merged[lang as keyof TranslationMap];
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

const bySort = (a: { sortOrder: number }, b: { sortOrder: number }): number =>
  a.sortOrder - b.sortOrder;

/**
 * Epic 17, Story 17.1 — the hotel-filled directory. Singletons
 * (essentials/about) are PUT upserts where all-empty deletes the row;
 * repeatable entries soft-deactivate only. All lookups filter hotelId →
 * cross-tenant is a 404 (repo law). Every mutation audits
 * `hotel_info.updated` with diffs; the WiFi password never appears in a
 * diff or log — only `{ changed: true }` (spec note 3).
 */
@Injectable()
export class TenantHotelInfoService {
  constructor(
    @InjectRepository(HotelInfoEntry)
    private readonly repo: Repository<HotelInfoEntry>,
    @InjectRepository(Hotel)
    private readonly hotelsRepo: Repository<Hotel>,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Full overview incl. inactive rows — the editor shows everything. */
  async getOverview(user: TenantUser): Promise<HotelInfoManageView> {
    const [hotel, entries] = await Promise.all([
      this.hotelsRepo.findOne({ where: { id: user.hotelId } }),
      this.repo.find({ where: { hotelId: user.hotelId } }),
    ]);
    const of = (section: HotelInfoSection): InfoEntryManageView[] =>
      entries
        .filter((e) => e.section === section)
        .sort(bySort)
        .map(toManageView);
    return {
      checkoutTime: hotel?.checkoutTime ?? '12:00',
      essentials: of('essentials')[0] ?? null,
      facilities: of('facilities'),
      services: of('services'),
      houseRules: of('house_rules'),
      about: of('about')[0] ?? null,
    };
  }

  // ------------------------------------------------------------------
  // Singletons
  // ------------------------------------------------------------------

  async upsertEssentials(
    user: TenantUser,
    dto: UpsertEssentialsDto,
  ): Promise<InfoEntryManageView | null> {
    const entry = await this.findSingleton(user.hotelId, 'essentials');
    const current = (entry?.structured ?? {}) as EssentialsStructured;

    // PUT semantics — the form sends the whole card; absent = cleared.
    const next: EssentialsStructured = {};
    const diff: Record<string, unknown> = {};
    for (const field of ESSENTIALS_FIELDS) {
      const value = dto[field]?.trim() ?? '';
      if (value) next[field] = value;
      if ((current[field] ?? '') === value) continue;
      // Guest-facing by nature, but never in audit metadata (spec note 3).
      diff[field] =
        field === 'wifiPassword'
          ? { changed: true }
          : { from: current[field] ?? null, to: value || null };
    }

    const empty = ESSENTIALS_FIELDS.every((f) => !next[f]);
    if (empty) {
      if (!entry) return null;
      await this.repo.remove(entry);
      await this.audit(user, entry.id, {
        removed: { from: 'essentials', to: null },
      });
      return null;
    }

    if (Object.keys(diff).length === 0 && entry) {
      return toManageView(entry);
    }
    const saved = await this.repo.save(
      entry
        ? Object.assign(entry, { structured: next })
        : this.repo.create({
            hotelId: user.hotelId,
            section: 'essentials' as const,
            names: {},
            structured: next,
          }),
    );
    await this.audit(user, saved.id, diff);
    return toManageView(saved);
  }

  async upsertAbout(
    user: TenantUser,
    dto: UpsertAboutDto,
  ): Promise<InfoEntryManageView | null> {
    const entry = await this.findSingleton(user.hotelId, 'about');
    const next = mergeDescriptions(dto, entry?.descriptions ?? null);

    if (next === null && (entry?.photos.length ?? 0) === 0) {
      if (!entry) return null;
      await this.repo.remove(entry);
      await this.audit(user, entry.id, { removed: { from: 'about', to: null } });
      return null;
    }

    if (
      entry &&
      JSON.stringify(next) === JSON.stringify(entry.descriptions)
    ) {
      return toManageView(entry);
    }
    const diff = {
      descriptions: { from: entry?.descriptions ?? null, to: next },
    };
    const saved = await this.repo.save(
      entry
        ? Object.assign(entry, { descriptions: next })
        : this.repo.create({
            hotelId: user.hotelId,
            section: 'about' as const,
            names: {},
            descriptions: next,
          }),
    );
    await this.audit(user, saved.id, diff);
    return toManageView(saved);
  }

  // ------------------------------------------------------------------
  // Repeatable entries
  // ------------------------------------------------------------------

  async createEntry(
    user: TenantUser,
    dto: CreateInfoEntryDto,
  ): Promise<InfoEntryManageView> {
    this.assertSectionFields(dto.section, dto);
    const structured = this.buildStructured(dto.section, dto, {});
    const entry = await this.repo.save(
      this.repo.create({
        hotelId: user.hotelId,
        section: dto.section,
        names: mergeNames(dto, {}, 'HOTEL_INFO_NAMES_REQUIRED'),
        descriptions: mergeDescriptions(dto),
        structured,
        isActive: dto.isActive ?? true,
        sortOrder: await this.nextSort(user.hotelId, dto.section),
      }),
    );
    await this.audit(user, entry.id, {
      created: { from: null, to: { nameEn: entry.names.en, section: dto.section } },
    });
    return toManageView(entry);
  }

  async updateEntry(
    user: TenantUser,
    id: string,
    dto: UpdateInfoEntryDto,
  ): Promise<InfoEntryManageView> {
    const entry = await this.repo.findOne({
      where: {
        id,
        hotelId: user.hotelId,
        section: In(REPEATABLE_SECTIONS),
      },
    });
    if (!entry) {
      throw new NotFoundException({
        code: 'HOTEL_INFO_ENTRY_NOT_FOUND',
        message: 'Entry not found',
      });
    }
    this.assertSectionFields(entry.section, dto);

    const diff: Record<string, unknown> = {};
    if (touchesNames(dto)) {
      const next = mergeNames(dto, entry.names, 'HOTEL_INFO_NAMES_REQUIRED');
      diff.names = { from: entry.names, to: next };
      entry.names = next;
    }
    if (touchesDescriptions(dto)) {
      const next = mergeDescriptions(dto, entry.descriptions);
      diff.descriptions = { from: entry.descriptions, to: next };
      entry.descriptions = next;
    }
    const structured = this.buildStructured(entry.section, dto, entry.structured);
    if (JSON.stringify(structured) !== JSON.stringify(entry.structured)) {
      diff.structured = { from: entry.structured, to: structured };
      entry.structured = structured;
    }
    if (dto.isActive !== undefined && dto.isActive !== entry.isActive) {
      diff.isActive = { from: entry.isActive, to: dto.isActive };
      entry.isActive = dto.isActive;
    }

    if (Object.keys(diff).length > 0) {
      await this.repo.save(entry);
      await this.audit(user, entry.id, diff);
    }
    return toManageView(entry);
  }

  /** AC3 — index in the array becomes sortOrder; the set must be exact. */
  async reorder(
    user: TenantUser,
    section: HotelInfoSection,
    dto: ReorderInfoEntriesDto,
  ): Promise<InfoEntryManageView[]> {
    const rows = await this.repo.find({
      where: { hotelId: user.hotelId, section },
    });
    const known = new Set(rows.map((r) => r.id));
    const valid =
      dto.entryIds.length === rows.length &&
      new Set(dto.entryIds).size === dto.entryIds.length &&
      dto.entryIds.every((id) => known.has(id));
    if (!valid) {
      throw new BadRequestException({
        code: 'HOTEL_INFO_REORDER_INVALID',
        message: 'Reorder must reference every entry of this section, once each',
      });
    }
    const before = rows.sort(bySort).map((r) => r.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [index, id] of dto.entryIds.entries()) {
      const row = byId.get(id) as HotelInfoEntry;
      row.sortOrder = index;
      await this.repo.save(row);
    }
    await this.audit(user, section, {
      order: { from: before, to: dto.entryIds },
    });
    return dto.entryIds.map((id) => toManageView(byId.get(id) as HotelInfoEntry));
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private findSingleton(
    hotelId: string,
    section: 'essentials' | 'about',
  ): Promise<HotelInfoEntry | null> {
    return this.repo.findOne({ where: { hotelId, section } });
  }

  private async nextSort(
    hotelId: string,
    section: HotelInfoSection,
  ): Promise<number> {
    const rows = await this.repo.find({ where: { hotelId, section } });
    return rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 1 : 0;
  }

  /** Windows belong to facilities, how-to/price to services (AC1). */
  private assertSectionFields(
    section: HotelInfoSection,
    dto: AuxFields,
  ): void {
    const allowed = SECTION_FIELDS[section] ?? [];
    const sent: ('windows' | AuxPrefix)[] = [];
    if (dto.windows !== undefined) sent.push('windows');
    for (const prefix of ['locationNote', 'howTo', 'priceNote'] as const) {
      if (touchesAux(prefix, dto)) sent.push(prefix);
    }
    const invalid = sent.find((f) => !allowed.includes(f));
    if (invalid) {
      throw new BadRequestException({
        code: 'HOTEL_INFO_FIELD_INVALID',
        message: `Field ${invalid} is not valid for section ${section}`,
        field: invalid,
        section,
      });
    }
  }

  private buildStructured(
    section: HotelInfoSection,
    dto: AuxFields,
    current: HotelInfoStructured,
  ): HotelInfoStructured {
    const next: HotelInfoStructured = { ...current };
    if (section === 'facilities') {
      if (dto.windows !== undefined) {
        next.windows = dto.windows as HotelInfoStructured['windows'];
      }
      if (touchesAux('locationNote', dto)) {
        const merged = mergeAux('locationNote', dto, current.locationNote);
        if (merged) next.locationNote = merged;
        else delete next.locationNote;
      }
    }
    if (section === 'services') {
      for (const prefix of ['howTo', 'priceNote'] as const) {
        if (!touchesAux(prefix, dto)) continue;
        const merged = mergeAux(prefix, dto, current[prefix]);
        if (merged) next[prefix] = merged;
        else delete next[prefix];
      }
    }
    return next;
  }

  /** 17.1 AC5 — one action for the whole directory, diffs attached. */
  private async audit(
    user: TenantUser,
    entityId: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await this.auditLogs.log({
      action: 'hotel_info.updated',
      entityType: 'hotel_info_entry',
      entityId,
      actorId: user.id,
      metadata: { actorType: 'tenant_user', hotelId: user.hotelId, diff },
    });
  }
}

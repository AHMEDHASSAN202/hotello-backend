/**
 * Task B4c (Epic 22 — Reports & Analytics, Implementation Note 1) — a
 * throwaway-but-committed perf-testing tool. Seeds ONE hotel
 * (`qa-epic22-perf`) with ~50 rooms x ~90 days of realistic operational
 * history so `qa/epic-22-perf-measure.ts` can time the report queries on
 * plausible volume instead of an empty dev DB.
 *
 * Real module/plan mechanism (verified by reading the entities before writing
 * this, per the task brief): a Hotel has NO module/plan columns of its own.
 * Module access flows Hotel -> Subscription (`endDate IS NULL` row) -> Plan
 * (`enabledModules: string[]`). This script creates a dedicated QA plan with
 * the modules the report services touch and an `active` subscription linking
 * the hotel to it. Tenant permissions are the code-versioned
 * `DEFAULT_TENANT_ROLES` (Owner = wildcard `['*']`) — reused directly here,
 * matching `src/database/seeds/seed.ts`'s own loop, since we call report
 * SERVICE methods directly (Part 2) and never need a real login.
 *
 * Safely re-runnable: deletes any prior `qa-epic22-perf` hotel and all its
 * children first (dependency order, since none of these FKs cascade), then
 * rebuilds from scratch. Does NOT delete the hotel at the end — see the QA
 * report's Cleanup section for the manual teardown SQL.
 *
 * Run from `gxp-backend/`:
 *   npx ts-node -r tsconfig-paths/register qa/epic-22-perf-seed.ts
 */
import 'reflect-metadata';
import * as crypto from 'crypto';
import { IsNull } from 'typeorm';
import { AppDataSource } from '../src/data-source';
import { Hotel } from '../src/modules/hotels/hotel.entity';
import { Plan } from '../src/modules/plans/plan.entity';
import { Subscription } from '../src/modules/subscriptions/subscription.entity';
import { TenantRole } from '../src/modules/tenant-roles/tenant-role.entity';
import { DEFAULT_TENANT_ROLES } from '../src/modules/tenant-roles/default-tenant-roles';
import { TenantUser } from '../src/modules/tenant-users/tenant-user.entity';
import { RoomType } from '../src/modules/tenant-rooms/room-type.entity';
import { Room } from '../src/modules/tenant-rooms/room.entity';
import { Stay } from '../src/modules/tenant-stays/stay.entity';
import { StayRoomChange } from '../src/modules/tenant-stays/stay-room-change.entity';
import { GUEST_LANGUAGES, GuestLanguage, STAY_TYPES, StayType } from '../src/modules/tenant-stays/stays.constants';
import { hotelLocalParts } from '../src/modules/tenant-stays/stay-time';
import { GuestRequest } from '../src/modules/requests/request.entity';
import { RequestCategory } from '../src/modules/requests/request-category.entity';
import { RequestItem } from '../src/modules/requests/request-item.entity';
import { REQUEST_CANCEL_REASONS } from '../src/modules/requests/requests.constants';
import { FnbMenu } from '../src/modules/fnb/fnb-menu.entity';
import { FnbMenuSection } from '../src/modules/fnb/fnb-menu-section.entity';
import { FnbItem } from '../src/modules/fnb/fnb-item.entity';
import { FnbLocation } from '../src/modules/fnb/fnb-location.entity';
import { FnbOrder } from '../src/modules/fnb/fnb-order.entity';
import { FnbOrderLine } from '../src/modules/fnb/fnb-order-line.entity';
import { FNB_CANCEL_REASONS, FnbPaymentMethod } from '../src/modules/fnb/fnb.constants';
import { Event } from '../src/modules/events/event.entity';
import { EventBooking } from '../src/modules/events/event-booking.entity';
import { EVENT_BOOKING_CANCELLED_BY } from '../src/modules/events/events.constants';
import { HousekeepingEvent } from '../src/modules/housekeeping/housekeeping-event.entity';

// ---------------------------------------------------------------- config

const HOTEL_SLUG = 'qa-epic22-perf';
const TIMEZONE = 'Africa/Cairo';
const CURRENCY = 'EGP';
const NUM_ROOMS = 50;
const FLOORS = 5;
const ROOMS_PER_FLOOR = NUM_ROOMS / FLOORS;
const HISTORY_DAYS = 90;

// ---------------------------------------------------------------- helpers

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function weightedPick<T>(weighted: [T, number][]): T {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [value, w] of weighted) {
    if (r < w) return value;
    r -= w;
  }
  return weighted[weighted.length - 1][0];
}

/** Pure UTC-anchored date-string arithmetic — the reports-period.ts `shiftLocalDate` shape. */
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function atUtc(dateStr: string, hh: number, mm: number): Date {
  return new Date(`${dateStr}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

/**
 * Epic 22 final review, C1 — this script backdates `createdAt` on naive
 * `timestamp` columns (Hotel/Stay/GuestRequest/FnbOrder, all default
 * `@CreateDateColumn()`) instead of letting the DB auto-populate them, so it
 * must reproduce the storage convention those columns expect: UTC wall time.
 *
 * Handing TypeORM a `Date` object (or even an ISO string — TypeORM's
 * `preparePersistentValue` re-parses strings back into a `Date` via dayjs
 * before it reaches the pg driver, so `naiveUtc()`'s "pass a string" trick
 * does NOT survive the entity-property/insert path, only raw QueryBuilder
 * WHERE-clause params) makes the pg driver serialize it via `date.getHours()`
 * etc — i.e. HOST-LOCAL wall-clock digits, not the intended UTC ones. On a
 * UTC host that's a no-op, which is exactly why this was invisible before:
 * the seed + report-read round-trip is self-consistent on any ONE host, but
 * silently wrong the moment either side runs under a different TZ.
 *
 * The fix: build the `Date` object so its LOCAL getters already equal the
 * intended UTC digits. The pg driver then serializes those (correct) digits
 * regardless of host timezone, and the read-side `fromNaive()` (which
 * re-reads a naive column's LOCAL getters as UTC) recovers the original
 * instant exactly. Verified empirically against the dev DB (port 5433):
 * write via this helper -> stored wall-clock == intended UTC digits ->
 * `fromNaive()` on read == original instant, independent of host TZ.
 */
function toNaiveColumnValue(d: Date): Date {
  return new Date(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

function randomCodeHash(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ----------------------------------------------------------- cleanup pass

/** Children before parents — none of these FKs cascade on delete. */
async function deleteExistingHotel(hotelId: string): Promise<void> {
  const manager = AppDataSource.manager;
  const tables = [
    'housekeeping_events',
    'stay_room_changes',
    'event_bookings',
    'events',
    'fnb_order_lines',
    'fnb_orders',
    'fnb_items',
    'fnb_menu_sections',
    'fnb_menus',
    'fnb_locations',
    'requests',
    'stays',
    'rooms',
    'room_types',
    'tenant_users',
    'tenant_roles',
    'subscriptions',
  ];
  for (const table of tables) {
    await manager.query(`DELETE FROM "${table}" WHERE "hotelId" = $1`, [hotelId]);
  }
  await manager.query(`DELETE FROM "hotels" WHERE "id" = $1`, [hotelId]);
}

// -------------------------------------------------------------------- main

async function main() {
  await AppDataSource.initialize();
  const manager = AppDataSource.manager;

  const hotelsRepo = manager.getRepository(Hotel);
  const plansRepo = manager.getRepository(Plan);
  const subscriptionsRepo = manager.getRepository(Subscription);
  const tenantRolesRepo = manager.getRepository(TenantRole);
  const tenantUsersRepo = manager.getRepository(TenantUser);
  const roomTypesRepo = manager.getRepository(RoomType);
  const roomsRepo = manager.getRepository(Room);
  const staysRepo = manager.getRepository(Stay);
  const roomChangesRepo = manager.getRepository(StayRoomChange);
  const requestsRepo = manager.getRepository(GuestRequest);
  const categoriesRepo = manager.getRepository(RequestCategory);
  const itemsRepo = manager.getRepository(RequestItem);
  const fnbMenusRepo = manager.getRepository(FnbMenu);
  const fnbSectionsRepo = manager.getRepository(FnbMenuSection);
  const fnbItemsRepo = manager.getRepository(FnbItem);
  const fnbLocationsRepo = manager.getRepository(FnbLocation);
  const fnbOrdersRepo = manager.getRepository(FnbOrder);
  const fnbOrderLinesRepo = manager.getRepository(FnbOrderLine);
  const eventsRepo = manager.getRepository(Event);
  const eventBookingsRepo = manager.getRepository(EventBooking);
  const hkEventsRepo = manager.getRepository(HousekeepingEvent);

  // ---- 0. cleanup ----
  const existing = await hotelsRepo.findOne({ where: { slug: HOTEL_SLUG } });
  if (existing) {
    console.log(`Found existing "${HOTEL_SLUG}" (${existing.id}) — deleting before reseed...`);
    await deleteExistingHotel(existing.id);
  }

  const today = new Date();
  const todayLocal = hotelLocalParts(TIMEZONE, today).date;
  const startLocal = addDaysStr(todayLocal, -(HISTORY_DAYS - 1)); // inclusive 90-day window ending today
  const hotelCreatedAt = atUtc(addDaysStr(startLocal, -5), 6, 0); // hotel predates the seeded history

  // ---- 1. plan (find-or-create, shared across reseeds) ----
  const PLAN_NAME = 'QA Epic 22 Perf Plan';
  let plan = await plansRepo.findOne({ where: { nameEn: PLAN_NAME } });
  if (!plan) {
    plan = await plansRepo.save(
      plansRepo.create({
        nameEn: PLAN_NAME,
        nameAr: 'خطة اختبار الأداء - الحلقة 22',
        descriptionEn: 'QA-only plan for Epic 22 performance seeding.',
        descriptionAr: 'خطة اختبار فقط لتحميل بيانات أداء الحلقة 22.',
        monthlyPrice: 0,
        yearlyPrice: null,
        currency: CURRENCY,
        maxRooms: null,
        maxStaffUsers: null,
        maxGuestRequestsPerMonth: null,
        enabledModules: ['analytics', 'housekeeping', 'requests', 'fnb', 'events'],
        status: 'active',
        isTrial: false,
        trialDurationDays: null,
      }),
    );
    console.log(`Created plan "${PLAN_NAME}" (${plan.id})`);
  } else {
    console.log(`Reusing plan "${PLAN_NAME}" (${plan.id})`);
  }

  // ---- 2. hotel ----
  const hotel = await hotelsRepo.save(
    hotelsRepo.create({
      nameEn: 'QA Epic 22 Perf Hotel',
      nameAr: 'فندق اختبار أداء الحلقة 22',
      slug: HOTEL_SLUG,
      status: 'active',
      contactEmail: 'ops@qa-epic22-perf.example',
      contactPhone: '+20 100 000 0001',
      city: 'Cairo',
      country: 'Egypt',
      timezone: TIMEZONE,
      defaultLanguage: 'en',
      currency: CURRENCY,
      checkoutTime: '12:00',
      dailyServiceTime: '09:00',
      defaultStayType: 'room_only',
      roomChargeEnabled: true,
      declaredRoomsCount: NUM_ROOMS,
      roomsCount: NUM_ROOMS,
      createdAt: toNaiveColumnValue(hotelCreatedAt),
    }),
  );
  console.log(`Created hotel "${HOTEL_SLUG}" (${hotel.id})`);

  // ---- 3. subscription (this is the REAL module-access mechanism — see header note) ----
  await subscriptionsRepo.save(
    subscriptionsRepo.create({
      hotelId: hotel.id,
      planId: plan.id,
      billingCycle: 'monthly',
      status: 'active',
      startDate: hotelCreatedAt,
      endDate: null,
      nextRenewalAt: null,
      trialEndsAt: null,
      changedById: null,
    }),
  );
  console.log('Created active subscription linking hotel -> plan');

  // ---- 4. tenant roles (reuse the code-versioned defaults, Owner = wildcard) ----
  const roles: TenantRole[] = [];
  for (const def of DEFAULT_TENANT_ROLES) {
    roles.push(await tenantRolesRepo.save(tenantRolesRepo.create({ hotelId: hotel.id, ...def })));
  }
  const ownerRole = roles.find((r) => r.nameEn === 'Owner')!;
  const managerRole = roles.find((r) => r.nameEn === 'Manager')!;
  const frontDeskRole = roles.find((r) => r.nameEn === 'Front Desk')!;
  const housekeepingRole = roles.find((r) => r.nameEn === 'Housekeeping')!;
  console.log(`Seeded ${roles.length} default tenant roles`);

  // ---- 5. tenant users (actor/assignee/createdBy FKs need real rows) ----
  const owner = await tenantUsersRepo.save(
    tenantUsersRepo.create({
      hotelId: hotel.id,
      name: 'QA Owner',
      email: 'owner@qa-epic22-perf.example',
      roleId: ownerRole.id,
      status: 'active',
      preferredLanguage: 'en',
    }),
  );
  const managerUser = await tenantUsersRepo.save(
    tenantUsersRepo.create({
      hotelId: hotel.id,
      name: 'QA Manager',
      email: 'manager@qa-epic22-perf.example',
      roleId: managerRole.id,
      status: 'active',
      preferredLanguage: 'en',
    }),
  );
  const frontDesk = await tenantUsersRepo.save(
    tenantUsersRepo.create({
      hotelId: hotel.id,
      name: 'QA Front Desk',
      email: 'frontdesk@qa-epic22-perf.example',
      roleId: frontDeskRole.id,
      status: 'active',
      preferredLanguage: 'en',
    }),
  );
  const housekeeper1 = await tenantUsersRepo.save(
    tenantUsersRepo.create({
      hotelId: hotel.id,
      name: 'QA Housekeeper A',
      email: 'hk1@qa-epic22-perf.example',
      roleId: housekeepingRole.id,
      status: 'active',
      preferredLanguage: 'ar',
    }),
  );
  const housekeeper2 = await tenantUsersRepo.save(
    tenantUsersRepo.create({
      hotelId: hotel.id,
      name: 'QA Housekeeper B',
      email: 'hk2@qa-epic22-perf.example',
      roleId: housekeepingRole.id,
      status: 'active',
      preferredLanguage: 'ar',
    }),
  );
  const attendants = [housekeeper1, housekeeper2, frontDesk];
  console.log('Created 5 tenant users (Owner, Manager, Front Desk, 2x Housekeeping)');

  // ---- 6. room types + rooms ----
  const roomTypeDefs = [
    { nameEn: 'Standard', nameAr: 'قياسية' },
    { nameEn: 'Deluxe', nameAr: 'ديلوكس' },
    { nameEn: 'Suite', nameAr: 'جناح' },
  ];
  const roomTypes: RoomType[] = [];
  for (const def of roomTypeDefs) {
    roomTypes.push(
      await roomTypesRepo.save(
        roomTypesRepo.create({
          hotelId: hotel.id,
          nameEn: def.nameEn,
          nameAr: def.nameAr,
          isActive: true,
        }),
      ),
    );
  }

  const rooms: Room[] = [];
  for (let floor = 1; floor <= FLOORS; floor++) {
    for (let n = 1; n <= ROOMS_PER_FLOOR; n++) {
      const roomNumber = `${floor}${String(n).padStart(2, '0')}`;
      rooms.push(
        roomsRepo.create({
          hotelId: hotel.id,
          roomNumber,
          floor,
          roomTypeId: roomTypes[(floor + n) % roomTypes.length].id,
          status: 'active',
          housekeepingStatus: 'clean',
        }),
      );
    }
  }
  await roomsRepo.insert(rooms);
  const savedRooms = await roomsRepo.find({ where: { hotelId: hotel.id } });
  console.log(`Created ${roomTypes.length} room types and ${savedRooms.length} rooms`);

  // ---- 7. stays: 90 days of staggered check-ins, cycling through rooms ----
  interface DraftStay {
    roomId: string;
    guestName: string;
    email: string | null;
    phone: string | null;
    language: GuestLanguage;
    guestsCount: number;
    stayType: StayType;
    checkInDate: string;
    checkOutDate: string;
    createdAt: Date;
  }

  const draftStays: DraftStay[] = [];
  let roomCursor = 0;
  let guestSeq = 0;
  for (let day = 0; day < HISTORY_DAYS; day++) {
    const checkInDate = addDaysStr(startLocal, day);
    const checkInsToday = randInt(2, 5);
    for (let i = 0; i < checkInsToday; i++) {
      const room = savedRooms[roomCursor % savedRooms.length];
      roomCursor++;
      const nights = randInt(1, 7);
      const checkOutDate = addDaysStr(checkInDate, nights);
      guestSeq++;
      draftStays.push({
        roomId: room.id,
        guestName: `QA Guest ${guestSeq}`,
        email: guestSeq % 3 === 0 ? null : `guest${guestSeq}@qa-epic22-perf.example`,
        phone: `+2010${String(guestSeq).padStart(7, '0')}`,
        language: pick(GUEST_LANGUAGES),
        guestsCount: randInt(1, 4),
        stayType: weightedPick<StayType>([
          ['room_only', 5],
          ['bed_breakfast', 3],
          ['half_board', 1],
          ['all_inclusive', 1],
        ]),
        checkInDate,
        checkOutDate,
        createdAt: atUtc(checkInDate, randInt(8, 18), randInt(0, 59)),
      });
    }
  }

  // Only the LAST occurrence of a given room whose checkout is still in the
  // future may be 'active' (UQ_stays_room_active) — downgrade any earlier
  // duplicates to checked_out so the insert never violates the partial index.
  const lastActiveIndexByRoom = new Map<string, number>();
  draftStays.forEach((s, idx) => {
    if (s.checkOutDate > todayLocal) lastActiveIndexByRoom.set(s.roomId, idx);
  });

  const stayEntities: Stay[] = draftStays.map((s, idx) => {
    const wouldBeActive = s.checkOutDate > todayLocal;
    const isActive = wouldBeActive && lastActiveIndexByRoom.get(s.roomId) === idx;
    const checkedOutAt = isActive ? null : atUtc(s.checkOutDate, 11, randInt(0, 45));
    return staysRepo.create({
      hotelId: hotel.id,
      roomId: s.roomId,
      guestName: s.guestName,
      email: s.email,
      phone: s.phone,
      language: s.language,
      guestsCount: s.guestsCount,
      stayType: s.stayType,
      codeHash: randomCodeHash(),
      checkInDate: s.checkInDate,
      checkOutDate: s.checkOutDate,
      status: isActive ? 'active' : 'checked_out',
      checkoutType: isActive ? null : 'manual',
      checkedOutAt,
      checkedOutById: isActive ? null : frontDesk.id,
      createdAt: toNaiveColumnValue(s.createdAt),
    });
  });
  await staysRepo.insert(stayEntities);
  const savedStays = await staysRepo.find({ where: { hotelId: hotel.id } });
  const activeStays = savedStays.filter((s) => s.status === 'active');
  const checkedOutStays = savedStays.filter((s) => s.status === 'checked_out');
  console.log(`Created ${savedStays.length} stays (${activeStays.length} active, ${checkedOutStays.length} checked_out)`);

  const roomNumberById = new Map(savedRooms.map((r) => [r.id, r.roomNumber]));

  // ---- 8. guest requests: ~45% of stays get 1-3 requests ----
  const platformCategories = await categoriesRepo.find();
  const platformItems = await itemsRepo.find({ where: { hotelId: IsNull() } });
  if (platformItems.length === 0) {
    throw new Error('No platform request_items found — run `npm run seed` first (seedRequestCatalog).');
  }
  const categoryById = new Map(platformCategories.map((c) => [c.id, c]));

  const requestDrafts: GuestRequest[] = [];
  for (const stay of savedStays) {
    if (Math.random() > 0.45) continue;
    const count = randInt(1, 3);
    for (let i = 0; i < count; i++) {
      const item = pick(platformItems);
      const category = categoryById.get(item.categoryId);
      const isPastStay = stay.status === 'checked_out';
      const windowStart = atUtc(stay.checkInDate, 8, 0).getTime();
      const windowEnd = Math.min(
        atUtc(stay.checkOutDate, 20, 0).getTime(),
        isPastStay ? Date.now() : Date.now(),
      );
      const createdAt = new Date(randInt(windowStart, Math.max(windowStart + 1, windowEnd)));
      const slaTargetMinutes = item.defaultSlaMinutes;
      const dueAt = addMinutes(createdAt, slaTargetMinutes);

      const status = isPastStay
        ? weightedPick<'done' | 'cancelled'>([
            ['done', 8],
            ['cancelled', 2],
          ])
        : weightedPick<'done' | 'cancelled' | 'in_progress' | 'new'>([
            ['done', 5],
            ['in_progress', 2],
            ['new', 2],
            ['cancelled', 1],
          ]);

      const base = requestsRepo.create({
        hotelId: hotel.id,
        stayId: stay.id,
        roomId: stay.roomId,
        roomNumber: roomNumberById.get(stay.roomId) ?? '',
        itemId: item.id,
        categoryId: item.categoryId,
        itemNames: item.names as Record<string, string>,
        itemIcon: item.icon,
        optionType: item.optionType,
        optionValue: item.optionType === 'quantity' ? String(randInt(1, 3)) : item.optionType === 'time' ? '10:00' : null,
        slaTargetMinutes,
        dueAt,
        // GuestRequest.createdAt is naive; dueAt/startedAt/completedAt/
        // cancelledAt below are timestamptz and keep using the true
        // `createdAt` instant for their arithmetic.
        createdAt: toNaiveColumnValue(createdAt),
        status: 'new',
      });

      if (status === 'done') {
        const breach = Math.random() < 0.15;
        const minutesToComplete = breach
          ? slaTargetMinutes + randInt(5, 90)
          : randInt(3, Math.max(4, Math.floor(slaTargetMinutes * 0.8)));
        base.status = 'done';
        base.assignedToId = pick(attendants).id;
        base.startedAt = addMinutes(createdAt, randInt(1, 5));
        base.startedById = base.assignedToId;
        base.completedAt = addMinutes(createdAt, minutesToComplete);
        base.completedById = base.assignedToId;
      } else if (status === 'in_progress') {
        base.status = 'in_progress';
        base.assignedToId = pick(attendants).id;
        base.startedAt = addMinutes(createdAt, randInt(1, 5));
        base.startedById = base.assignedToId;
      } else if (status === 'cancelled') {
        const reason = pick(REQUEST_CANCEL_REASONS);
        base.status = 'cancelled';
        base.cancelledAt = addMinutes(createdAt, randInt(2, 30));
        base.cancelledById = reason === 'guest' ? null : pick(attendants).id;
        base.cancelledReason = reason;
        if (reason === 'other') base.cancelNote = 'QA seed: staff-cancelled example.';
      }
      // 'new' needs no further fields.
      requestDrafts.push(base);
    }
  }
  await requestsRepo.insert(requestDrafts);
  console.log(`Created ${requestDrafts.length} guest requests`);

  // ---- 9. F&B catalog (menu -> sections -> items -> locations) ----
  const menu = await fnbMenusRepo.save(
    fnbMenusRepo.create({
      hotelId: hotel.id,
      names: { en: 'In-Room Dining', ar: 'خدمة الغرف' },
      descriptions: null,
      windows: [],
      defaultIncludedFor: [],
      prepSlaMinutes: 30,
      isActive: true,
      sortOrder: 0,
    }),
  );
  const startersSection = await fnbSectionsRepo.save(
    fnbSectionsRepo.create({ hotelId: hotel.id, menuId: menu.id, names: { en: 'Starters', ar: 'مقبلات' }, isActive: true, sortOrder: 0 }),
  );
  const mainsSection = await fnbSectionsRepo.save(
    fnbSectionsRepo.create({ hotelId: hotel.id, menuId: menu.id, names: { en: 'Mains', ar: 'أطباق رئيسية' }, isActive: true, sortOrder: 1 }),
  );
  const fnbItemDefs = [
    { section: startersSection, en: 'Club Sandwich', ar: 'ساندويتش كلوب', price: 180 },
    { section: startersSection, en: 'Caesar Salad', ar: 'سلطة سيزر', price: 150 },
    { section: mainsSection, en: 'Grilled Chicken', ar: 'دجاج مشوي', price: 260 },
    { section: mainsSection, en: 'Beef Burger', ar: 'برجر لحم', price: 220 },
    { section: mainsSection, en: 'Seafood Pasta', ar: 'باستا بحرية', price: 320 },
    { section: startersSection, en: 'Fresh Juice', ar: 'عصير طازج', price: 90 },
  ];
  const fnbItems: FnbItem[] = [];
  for (const def of fnbItemDefs) {
    fnbItems.push(
      await fnbItemsRepo.save(
        fnbItemsRepo.create({
          hotelId: hotel.id,
          menuId: menu.id,
          sectionId: def.section.id,
          names: { en: def.en, ar: def.ar },
          price: def.price,
          allowNotes: true,
          isActive: true,
          sortOrder: 0,
        }),
      ),
    );
  }
  const poolLocation = await fnbLocationsRepo.save(
    fnbLocationsRepo.create({ hotelId: hotel.id, key: 'pool', names: { en: 'Pool', ar: 'المسبح' }, hasSpots: true, isActive: true }),
  );
  const beachLocation = await fnbLocationsRepo.save(
    fnbLocationsRepo.create({ hotelId: hotel.id, key: 'beach', names: { en: 'Beach', ar: 'الشاطئ' }, hasSpots: false, isActive: true }),
  );
  const fnbLocations = [poolLocation, beachLocation];
  console.log(`Created F&B catalog: 1 menu, 2 sections, ${fnbItems.length} items, 2 locations`);

  // ---- 10. F&B orders + lines: ~60% of stays get 1-2 orders ----
  const orderDrafts: FnbOrder[] = [];
  const lineDrafts: FnbOrderLine[] = [];
  for (const stay of savedStays) {
    if (Math.random() > 0.6) continue;
    const orderCount = randInt(1, 2);
    for (let i = 0; i < orderCount; i++) {
      const windowStart = atUtc(stay.checkInDate, 7, 0).getTime();
      const windowEnd = Math.min(atUtc(stay.checkOutDate, 22, 0).getTime(), Date.now());
      const createdAt = new Date(randInt(windowStart, Math.max(windowStart + 1, windowEnd)));
      const dueAt = addMinutes(createdAt, menu.prepSlaMinutes);
      const destinationType = Math.random() < 0.7 ? 'room' : 'location';
      const location = destinationType === 'location' ? pick(fnbLocations) : null;

      const paymentMethod = weightedPick<FnbPaymentMethod | null>([
        [null, 2],
        ['cash', 4],
        ['room_charge', 4],
      ]);

      const status = weightedPick<'delivered' | 'cancelled' | 'new' | 'preparing' | 'on_the_way'>([
        ['delivered', 75],
        ['cancelled', 15],
        ['new', 3],
        ['preparing', 4],
        ['on_the_way', 3],
      ]);

      const lineCount = randInt(1, 3);
      const chosenItems = Array.from({ length: lineCount }, () => pick(fnbItems));
      let totalAmount = 0;
      const orderId = crypto.randomUUID();
      const included = paymentMethod === null;
      for (const item of chosenItems) {
        const quantity = randInt(1, 3);
        const lineTotal = included ? 0 : Math.round(item.price * quantity * 100) / 100;
        totalAmount += lineTotal;
        lineDrafts.push(
          fnbOrderLinesRepo.create({
            id: crypto.randomUUID(),
            orderId,
            hotelId: hotel.id,
            itemId: item.id,
            itemNames: item.names,
            quantity,
            unitPrice: item.price,
            included,
            lineTotal,
            sortOrder: 0,
          }),
        );
      }
      totalAmount = Math.round(totalAmount * 100) / 100;

      const order = fnbOrdersRepo.create({
        id: orderId,
        hotelId: hotel.id,
        stayId: stay.id,
        roomId: stay.roomId,
        roomNumber: roomNumberById.get(stay.roomId) ?? '',
        guestName: stay.guestName,
        guestLanguage: stay.language,
        stayType: stay.stayType,
        menuIds: [menu.id],
        destinationType,
        locationId: location?.id ?? null,
        locationKey: location?.key ?? null,
        locationNames: location?.names ?? null,
        paymentMethod,
        totalAmount,
        currency: CURRENCY,
        status,
        slaTargetMinutes: menu.prepSlaMinutes,
        dueAt,
        // FnbOrder.createdAt is naive; deliveredAt/startedAt/etc below are
        // timestamptz and keep using the true `createdAt` instant.
        createdAt: toNaiveColumnValue(createdAt),
      });

      if (status === 'delivered') {
        order.deliveredAt = addMinutes(createdAt, randInt(20, 75));
        order.deliveredById = pick(attendants).id;
        order.startedAt = addMinutes(createdAt, randInt(2, 10));
        order.startedById = order.deliveredById;
        if (paymentMethod === 'room_charge' && Math.random() < 0.5) {
          order.settledAt = addMinutes(order.deliveredAt, randInt(30, 600));
          order.settledById = owner.id;
        }
      } else if (status === 'cancelled') {
        order.cancelledAt = addMinutes(createdAt, randInt(2, 20));
        order.cancelledById = pick(attendants).id;
        order.cancelledReason = pick(FNB_CANCEL_REASONS);
      } else if (status === 'preparing' || status === 'on_the_way') {
        order.startedAt = addMinutes(createdAt, randInt(2, 10));
        order.startedById = pick(attendants).id;
        if (status === 'on_the_way') order.outForDeliveryAt = addMinutes(order.startedAt, randInt(5, 20));
      }
      orderDrafts.push(order);
    }
  }
  await fnbOrdersRepo.insert(orderDrafts);
  await fnbOrderLinesRepo.insert(lineDrafts);
  console.log(`Created ${orderDrafts.length} F&B orders and ${lineDrafts.length} order lines`);

  // ---- 11. events + bookings: a handful of events across the 90 days ----
  const eventDefs = [
    { en: 'Poolside BBQ Night', ar: 'ليلة شواء بجانب المسبح', dayOffset: 5 },
    { en: 'Sunset Yoga', ar: 'يوجا الغروب', dayOffset: 15 },
    { en: 'Live Music Evening', ar: 'أمسية موسيقية', dayOffset: 28 },
    { en: 'Kids Craft Workshop', ar: 'ورشة حرف للأطفال', dayOffset: 40 },
    { en: 'Wine Tasting', ar: 'تذوق النبيذ', dayOffset: 52 },
    { en: 'Beach Volleyball Tournament', ar: 'بطولة الكرة الطائرة الشاطئية', dayOffset: 63 },
    { en: 'Cultural Night', ar: 'ليلة ثقافية', dayOffset: 75 },
    { en: 'New Arrivals Welcome Mixer', ar: 'حفل ترحيب بالنزلاء الجدد', dayOffset: 85 },
  ];
  const events: Event[] = [];
  for (const def of eventDefs) {
    const startDate = addDaysStr(startLocal, def.dayOffset);
    const isPast = startDate < todayLocal;
    const status = isPast ? (Math.random() < 0.1 ? 'cancelled' : 'completed') : 'published';
    const includedFor: StayType[] = Math.random() < 0.25 ? ['all_inclusive'] : [];
    const event = await eventsRepo.save(
      eventsRepo.create({
        hotelId: hotel.id,
        titles: { en: def.en, ar: def.ar },
        descriptions: { en: `${def.en} — QA seed event.`, ar: `${def.ar} - حدث اختبار.` },
        startAtLocal: `${startDate} 19:00`,
        endAtLocal: `${startDate} 21:00`,
        locationText: 'Main Lawn',
        capacity: 40,
        price: randInt(2, 6) * 50,
        includedFor,
        status,
        createdById: managerUser.id,
        publishedAt: status === 'published' || status === 'completed' ? atUtc(addDaysStr(startDate, -3), 10, 0) : null,
        completedAt: status === 'completed' ? atUtc(startDate, 22, 0) : null,
        cancelledAt: status === 'cancelled' ? atUtc(addDaysStr(startDate, -1), 10, 0) : null,
        cancelledById: status === 'cancelled' ? managerUser.id : null,
      }),
    );
    events.push(event);
  }

  const bookingDrafts: EventBooking[] = [];
  for (const event of events) {
    const bookingCount = randInt(5, 15);
    for (let i = 0; i < bookingCount; i++) {
      const stay = pick(savedStays);
      const partySize = randInt(1, 4);
      const includedByStayType = event.includedFor.includes(stay.stayType);
      const unitPrice = event.price;
      const included = includedByStayType;
      const totalAmount = included ? 0 : Math.round(unitPrice * partySize * 100) / 100;
      const paymentMethod: FnbPaymentMethod | null = included
        ? null
        : weightedPick<FnbPaymentMethod>([
            ['cash', 1],
            ['room_charge', 1],
          ]);
      const status = Math.random() < 0.15 ? 'cancelled' : 'booked';

      const booking = eventBookingsRepo.create({
        hotelId: hotel.id,
        eventId: event.id,
        stayId: stay.id,
        partySize,
        snapshot: {
          titles: event.titles,
          startAtLocal: event.startAtLocal,
          endAtLocal: event.endAtLocal,
          locationText: event.locationText,
        },
        unitPrice,
        included,
        totalAmount,
        currency: CURRENCY,
        paymentMethod,
        status,
      });
      if (status === 'cancelled') {
        booking.cancelledBy = pick(EVENT_BOOKING_CANCELLED_BY);
        booking.cancelledAt = atUtc(event.startAtLocal.slice(0, 10), 8, 0);
        booking.cancelledReason = 'QA seed: sample cancellation.';
      } else if (paymentMethod === 'room_charge' && Math.random() < 0.5) {
        booking.settledAt = atUtc(event.startAtLocal.slice(0, 10), 23, 0);
        booking.settledById = owner.id;
      }
      bookingDrafts.push(booking);
    }
  }
  await eventBookingsRepo.insert(bookingDrafts);
  console.log(`Created ${events.length} events and ${bookingDrafts.length} event bookings`);

  // ---- 12. housekeeping events: turnover + occasional daily service/DND ----
  const hkDrafts: HousekeepingEvent[] = [];
  for (const stay of savedStays) {
    const attendant = pick(attendants);
    const nights = Math.round((new Date(stay.checkOutDate).getTime() - new Date(stay.checkInDate).getTime()) / 86_400_000);

    // Occasional mid-stay daily service or DND toggle for longer stays.
    if (nights >= 3) {
      const midDate = addDaysStr(stay.checkInDate, Math.min(nights - 1, randInt(1, 2)));
      if (Math.random() < 0.4) {
        const flaggedAt = atUtc(midDate, 9, randInt(0, 30));
        hkDrafts.push(
          hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'flagged', cleaningType: 'daily', actorId: null, assignedToId: attendant.id, occurredAt: flaggedAt }),
        );
        hkDrafts.push(
          hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'started', cleaningType: null, actorId: attendant.id, assignedToId: attendant.id, occurredAt: addMinutes(flaggedAt, randInt(5, 30)) }),
        );
        hkDrafts.push(
          hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'completed', cleaningType: 'daily', actorId: attendant.id, assignedToId: attendant.id, occurredAt: addMinutes(flaggedAt, randInt(35, 70)) }),
        );
      } else if (Math.random() < 0.25) {
        const dndSetAt = atUtc(midDate, 8, randInt(0, 59));
        hkDrafts.push(
          hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'dnd_set', cleaningType: null, actorId: null, assignedToId: null, occurredAt: dndSetAt }),
        );
        hkDrafts.push(
          hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'dnd_cleared', cleaningType: null, actorId: null, assignedToId: null, occurredAt: addMinutes(dndSetAt, randInt(180, 600)) }),
        );
      }
    }

    // Checkout turnover — only for stays that have actually checked out.
    if (stay.status === 'checked_out' && stay.checkedOutAt) {
      const flaggedAt = addMinutes(stay.checkedOutAt, randInt(2, 15));
      hkDrafts.push(
        hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'flagged', cleaningType: 'checkout', actorId: null, assignedToId: attendant.id, occurredAt: flaggedAt }),
      );
      let cursor = addMinutes(flaggedAt, randInt(10, 45));
      hkDrafts.push(
        hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'started', cleaningType: null, actorId: attendant.id, assignedToId: attendant.id, occurredAt: cursor }),
      );
      if (Math.random() < 0.15) {
        cursor = addMinutes(cursor, randInt(5, 20));
        hkDrafts.push(
          hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'interrupted', cleaningType: null, actorId: attendant.id, assignedToId: attendant.id, occurredAt: cursor }),
        );
        cursor = addMinutes(cursor, randInt(10, 30));
        hkDrafts.push(
          hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'started', cleaningType: null, actorId: attendant.id, assignedToId: attendant.id, occurredAt: cursor }),
        );
      }
      cursor = addMinutes(cursor, randInt(20, 60));
      hkDrafts.push(
        hkEventsRepo.create({ hotelId: hotel.id, roomId: stay.roomId, eventType: 'completed', cleaningType: 'checkout', actorId: attendant.id, assignedToId: attendant.id, occurredAt: cursor }),
      );
    }
  }
  await hkEventsRepo.insert(hkDrafts);
  console.log(`Created ${hkDrafts.length} housekeeping events`);

  // ---- 13. a handful of stay room changes (query is trivial regardless of volume) ----
  const roomChangeDrafts: StayRoomChange[] = [];
  const sampleStays = savedStays.slice(0, Math.min(12, savedStays.length));
  for (const stay of sampleStays) {
    const otherRoom = pick(savedRooms.filter((r) => r.id !== stay.roomId));
    const occurredAt = atUtc(stay.checkInDate, randInt(10, 20), randInt(0, 59));
    roomChangeDrafts.push(
      roomChangesRepo.create({ hotelId: hotel.id, stayId: stay.id, fromRoomId: stay.roomId, toRoomId: otherRoom.id, occurredAt }),
    );
  }
  await roomChangesRepo.insert(roomChangeDrafts);
  console.log(`Created ${roomChangeDrafts.length} stay room changes`);

  // ---- summary ----
  console.log('\n=== Seed summary ===');
  console.log(`Hotel: ${HOTEL_SLUG} (${hotel.id})`);
  console.log(`Rooms: ${savedRooms.length}`);
  console.log(`Stays: ${savedStays.length} (${activeStays.length} active, ${checkedOutStays.length} checked_out)`);
  console.log(`Guest requests: ${requestDrafts.length}`);
  console.log(`F&B orders: ${orderDrafts.length} / lines: ${lineDrafts.length}`);
  console.log(`Events: ${events.length} / bookings: ${bookingDrafts.length}`);
  console.log(`Housekeeping events: ${hkDrafts.length}`);
  console.log(`Stay room changes: ${roomChangeDrafts.length}`);
  console.log(`Seeded date range: ${startLocal} .. ${todayLocal} (${HISTORY_DAYS} days)`);
  console.log('====================\n');

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

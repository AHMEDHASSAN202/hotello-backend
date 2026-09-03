import { MetricWithDelta, ReportPreset } from './reports-period';

// Re-exported so downstream imports (e.g. reports-operational.service.ts)
// can pull it from report-views.ts alongside the report shapes that use it,
// without duplicating the interface (it's already defined in reports-period.ts).
export type { MetricWithDelta };

export interface ReportPeriodView {
  preset: ReportPreset;
  from: string; // hotel-local 'YYYY-MM-DD', inclusive
  to: string; // hotel-local 'YYYY-MM-DD', inclusive
  days: number;
}

export interface BalanceRow {
  stayId: string;
  roomId: string;
  roomNumber: string;
  guestName: string;
  checkOutDate: string; // hotel-local 'YYYY-MM-DD'
  departsToday: boolean;
  total: number;
  byKey: Record<'fnb' | 'events', number>;
  oldestUnsettledAt: string; // ISO instant
}

export interface BalancesReport {
  currency: string;
  departingTodayCount: number;
  departingTodayTotal: number;
  totalOutstanding: number;
  rows: BalanceRow[]; // sorted by checkOutDate ascending
}

export interface LeakageRow {
  stayId: string;
  roomNumber: string;
  guestName: string;
  checkedOutAt: string; // ISO instant
  checkoutType: 'manual' | 'automatic';
  total: number;
  byKey: Record<'fnb' | 'events', number>;
}

export interface LeakageReport {
  period: ReportPeriodView;
  currency: string;
  totalLost: number;
  rows: LeakageRow[];
}

// ---------------------------------------------------------- Story 22.2

export interface GuestsReport {
  period: ReportPeriodView;
  arrivals: MetricWithDelta;
  departures: MetricWithDelta;
  inHouseNow: number;
  avgLengthOfStayDays: number | null; // null when no stay departed in the period
  occupancyTrend: { date: string; occupied: number; totalRooms: number }[];
  stayTypes: Record<string, number>;
  languages: Record<string, number>;
  roomChanges: number;
}

export interface RequestsReport {
  period: ReportPeriodView;
  receivedCount: number; // total requests created in period
  completedCount: number; // status='done' in period
  overallDoneWithSlaCount: number; // sample size behind the two ratios below
  overallSlaBreachRatePct: number | null; // breach %, ALL categories combined (not an average of per-category %s)
  overallAvgCompletionMinutes: number | null;
  volumeByDay: { date: string; count: number }[];
  byCategory: {
    categoryId: string;
    names: Record<string, string>;
    count: number;
    slaCompliancePct: number | null; // null when zero done-with-SLA rows
    avgCompletionMinutes: number | null;
  }[];
  byItem: { itemId: string; names: Record<string, string>; count: number }[];
  completionBuckets: { label: '<15m' | '15-30m' | '30-60m' | '1-2h' | '>2h'; count: number }[];
  cancellations: { count: number; reasons: { reason: string; count: number }[] };
  busiestHours: number[]; // 24 entries, hotel-local hour 0-23, index = hour
}

export interface HousekeepingReport {
  period: ReportPeriodView;
  cleanedByDay: { date: string; checkout: number; daily: number }[];
  avgFlagToCleanMinutes: number | null;
  attendants: { userId: string; name: string; completed: number; perDay: number }[];
  dndClearedCount: number;
  dndNow: number;
  dataSince?: string; // 'YYYY-MM-DD' — absent if data covers the whole period
}

// ---------------------------------------------------------- Story 22.3

export interface DiningReport {
  period: ReportPeriodView;
  currency: string;
  revenueByDay: { date: string; revenue: number; orders: number }[];
  ordersCount: number;
  revenueTotal: number;
  avgOrderValue: number | null; // over paid (totalAmount > 0) delivered orders only
  topItems: { itemId: string; names: Record<string, string>; qty: number; revenue: number }[];
  includedConsumption: { itemId: string; names: Record<string, string>; qty: number }[]; // NEVER revenue
  byZone: { destinationType: 'room' | 'location'; locationKey: string | null; names: Record<string, string> | null; revenue: number; orders: number }[];
  paymentSplit: { cash: number; roomCharge: number };
  cancellations: { count: number; reasons: { reason: string; count: number }[] };
  basis: 'delivered_only';
}

export interface EventPerformance {
  eventId: string;
  titles: Record<string, string>;
  startAtLocal: string;
  capacity: number | null;
  booked: number;
  revenue: number;
  paidSeats: number;
  freeSeats: number;
  includedSeats: number;
  cancellationRatePct: number;
}

export interface EventsReport {
  period: ReportPeriodView;
  currency: string;
  events: EventPerformance[];
  totals: { revenue: number; booked: number; cancellationRatePct: number };
  basis: 'events_starting_in_period';
}

export interface TotalsReport {
  period: ReportPeriodView;
  currency: string;
  byDay: { date: string; dining: number; events: number; total: number }[];
  byMethod: { cash: number; roomCharge: number };
  grandTotal: number;
  collected: number;
  outstanding: number;
  basis: 'delivered_booked';
}

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

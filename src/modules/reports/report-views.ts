import { ReportPreset } from './reports-period';

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

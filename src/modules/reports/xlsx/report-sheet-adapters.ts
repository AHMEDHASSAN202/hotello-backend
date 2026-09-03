import {
  BalancesReport,
  DiningReport,
  EventsReport,
  GuestsReport,
  HousekeepingReport,
  LeakageReport,
  OverviewReport,
  RequestsReport,
  TotalsReport,
} from '../report-views';
import { XlsxSheetSpec } from './reports-xlsx.service';

const nameOf = (names: Record<string, string>): string => names.en ?? Object.values(names)[0] ?? '';

export function overviewSheets(r: OverviewReport): XlsxSheetSpec[] {
  const rows: (string | number)[][] = [
    ['Occupied rooms', r.occupancy.occupiedNow],
    ['Total rooms', r.occupancy.totalRooms],
    ['Occupancy %', r.occupancy.pct],
    ['Arrivals', r.occupancy.arrivalsToday],
    ['Departures', r.occupancy.departuresToday],
    ['In-house guests', r.occupancy.inHouseGuests],
    ['Requests received', r.service.received.value],
    ['Requests completed', r.service.completed.value],
    ['Requests open now', r.service.openNow],
    ['Avg completion (min)', r.service.avgCompletionMinutes.value],
    ['SLA breach rate %', r.service.slaBreachRatePct.value],
    ['Cleaned today', r.housekeeping.cleanedToday],
    ['Needing cleaning', r.housekeeping.needingCleaning],
    ['Housekeeping in progress', r.housekeeping.inProgress],
    ['DND rooms', r.housekeeping.dnd],
  ];
  if (r.revenue) {
    rows.push(
      ['Dining revenue', r.revenue.dining.value],
      ['Events revenue', r.revenue.events.value],
      ['Total revenue', r.revenue.total.value],
      ['Cash', r.revenue.cash],
      ['Room charge', r.revenue.roomCharge],
      ['Unsettled total', r.revenue.unsettledTotal],
    );
  }
  return [{ name: 'Overview', headers: ['Metric', 'Value'], rows }];
}

export function guestsSheets(r: GuestsReport): XlsxSheetSpec[] {
  return [{
    name: 'Occupancy by day',
    headers: ['Date', 'Occupied', 'Total rooms'],
    rows: r.occupancyTrend.map((d) => [d.date, d.occupied, d.totalRooms]),
  }];
}

export function requestsSheets(r: RequestsReport): XlsxSheetSpec[] {
  return [
    { name: 'Volume by day', headers: ['Date', 'Count'], rows: r.volumeByDay.map((d) => [d.date, d.count]) },
    {
      name: 'By category',
      headers: ['Category', 'Count', 'SLA compliance %', 'Avg completion (min)'],
      rows: r.byCategory.map((c) => [nameOf(c.names), c.count, c.slaCompliancePct ?? '', c.avgCompletionMinutes ?? '']),
    },
    { name: 'By item', headers: ['Item', 'Count'], rows: r.byItem.map((i) => [nameOf(i.names), i.count]) },
  ];
}

export function housekeepingSheets(r: HousekeepingReport): XlsxSheetSpec[] {
  return [
    { name: 'Cleaned by day', headers: ['Date', 'Checkout', 'Daily'], rows: r.cleanedByDay.map((d) => [d.date, d.checkout, d.daily]) },
    { name: 'By attendant', headers: ['Attendant', 'Completed', 'Per day'], rows: r.attendants.map((a) => [a.name, a.completed, a.perDay]) },
  ];
}

export function diningSheets(r: DiningReport): XlsxSheetSpec[] {
  return [
    { name: 'Revenue by day', headers: ['Date', 'Revenue', 'Orders'], rows: r.revenueByDay.map((d) => [d.date, d.revenue, d.orders]) },
    { name: 'Top items', headers: ['Item', 'Qty', 'Revenue'], rows: r.topItems.map((i) => [nameOf(i.names), i.qty, i.revenue]) },
    { name: 'By zone', headers: ['Zone', 'Revenue', 'Orders'], rows: r.byZone.map((z) => [z.destinationType === 'room' ? 'Room' : nameOf(z.names ?? {}), z.revenue, z.orders]) },
  ];
}

export function eventsSheets(r: EventsReport): XlsxSheetSpec[] {
  return [{
    name: 'Events',
    headers: ['Event', 'Start', 'Booked', 'Revenue', 'Cancellation rate %'],
    rows: r.events.map((e) => [nameOf(e.titles), e.startAtLocal, e.booked, e.revenue, e.cancellationRatePct]),
  }];
}

export function totalsSheets(r: TotalsReport): XlsxSheetSpec[] {
  return [{
    name: 'Totals by day',
    headers: ['Date', 'Dining', 'Events', 'Total'],
    rows: r.byDay.map((d) => [d.date, d.dining, d.events, d.total]),
  }];
}

export function balancesSheets(r: BalancesReport): XlsxSheetSpec[] {
  return [{
    name: 'Balances',
    headers: ['Room', 'Guest', 'Checkout date', 'Total', 'Dining', 'Events'],
    rows: r.rows.map((row) => [row.roomNumber, row.guestName, row.checkOutDate, row.total, row.byKey.fnb, row.byKey.events]),
  }];
}

export function leakageSheets(r: LeakageReport): XlsxSheetSpec[] {
  return [{
    name: 'Leakage',
    headers: ['Room', 'Guest', 'Checked out', 'Type', 'Total'],
    rows: r.rows.map((row) => [row.roomNumber, row.guestName, row.checkedOutAt, row.checkoutType, row.total]),
  }];
}

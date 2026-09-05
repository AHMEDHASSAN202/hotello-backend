/**
 * Task B4c (Epic 22 — Reports & Analytics, Implementation Note 1) — times the
 * 9 report-service calls against the `qa-epic22-perf` hotel seeded by
 * `qa/epic-22-perf-seed.ts`, on a real NestJS DI graph (real repositories,
 * real query builders) but with NO HTTP layer and NO JWT — pure
 * service/query timing.
 *
 * Run TWICE per invocation (cold + warm pass) since Postgres query-plan
 * caching and connection-pool warmup mean the very first call in a process is
 * often slower than steady state; both numbers are printed so neither
 * over- nor under-states real performance.
 *
 * Run from `gxp-backend/` (same TS_NODE_PROJECT override the seed script
 * needs — see qa/epic-22-report.md "How to reproduce" for why):
 *   TS_NODE_PROJECT=tsconfig.json npx ts-node -r tsconfig-paths/register qa/epic-22-perf-measure.ts
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Hotel } from '../src/modules/hotels/hotel.entity';
import { Stay } from '../src/modules/tenant-stays/stay.entity';
import { ReportPeriodDto } from '../src/modules/reports/dto/report-period.dto';
import { ReportsBalancesService } from '../src/modules/reports/reports-balances.service';
import { ReportsOperationalService } from '../src/modules/reports/reports-operational.service';
import { ReportsOverviewService } from '../src/modules/reports/reports-overview.service';
import { ReportsRevenueService } from '../src/modules/reports/reports-revenue.service';

const HOTEL_SLUG = 'qa-epic22-perf';
const BUDGET_MS = 500;

interface TimedResult {
  name: string;
  ms: number;
  dataVolume: number | string;
}

function nowMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

async function timeIt<T>(name: string, fn: () => Promise<T>, volumeOf: (r: T) => number | string): Promise<TimedResult> {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = nowMs(start);
  return { name, ms: Math.round(ms * 100) / 100, dataVolume: volumeOf(result) };
}

async function runPass(
  label: string,
  hotelId: string,
  dto: ReportPeriodDto,
  balances: ReportsBalancesService,
  operational: ReportsOperationalService,
  revenue: ReportsRevenueService,
  overview: ReportsOverviewService,
): Promise<TimedResult[]> {
  const results: TimedResult[] = [];

  results.push(await timeIt('balances', () => balances.balances(hotelId), (r) => r.rows.length));
  results.push(await timeIt('leakage', () => balances.leakage(hotelId, dto), (r) => r.rows.length));
  results.push(await timeIt('guests', () => operational.guests(hotelId, dto), (r) => r.occupancyTrend.length));
  results.push(await timeIt('requests', () => operational.requests(hotelId, dto), (r) => r.volumeByDay.length + r.byCategory.length));
  results.push(await timeIt('housekeeping', () => operational.housekeeping(hotelId, dto), (r) => r.cleanedByDay.length + r.attendants.length));
  results.push(await timeIt('dining', () => revenue.dining(hotelId, dto), (r) => r.revenueByDay.length + r.topItems.length));
  results.push(await timeIt('events', () => revenue.events(hotelId, dto), (r) => r.events.length));
  results.push(await timeIt('totals', () => revenue.totals(hotelId, dto), (r) => r.byDay.length));
  results.push(await timeIt('overview (incl. revenue)', () => overview.overview(hotelId, dto, true), () => 1));

  console.log(`\n--- ${label} pass ---`);
  console.log('Report'.padEnd(26) + 'ms'.padStart(10) + '  Data volume  Budget');
  for (const r of results) {
    const withinBudget = r.ms <= BUDGET_MS ? 'OK' : 'EXCEEDS 500ms';
    console.log(r.name.padEnd(26) + r.ms.toFixed(2).padStart(10) + `  ${String(r.dataVolume).padEnd(11)}  ${withinBudget}`);
  }
  return results;
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const hotelsRepo = app.get<Repository<Hotel>>(getRepositoryToken(Hotel));
    const staysRepo = app.get<Repository<Stay>>(getRepositoryToken(Stay));

    const hotel = await hotelsRepo.findOne({ where: { slug: HOTEL_SLUG } });
    if (!hotel) {
      throw new Error(
        `No hotel with slug "${HOTEL_SLUG}" found — run qa/epic-22-perf-seed.ts first.`,
      );
    }

    // Pick from/to from the ACTUAL seeded stay date range, not a hardcoded
    // window, so this script gives correct results regardless of what day it
    // runs on.
    const stays = await staysRepo.find({ where: { hotelId: hotel.id } });
    if (stays.length === 0) {
      throw new Error(`Hotel ${hotel.id} has no stays — re-run qa/epic-22-perf-seed.ts.`);
    }
    const earliestCheckIn = stays.map((s) => s.checkInDate).sort()[0];
    const latestCheckOut = stays.map((s) => s.checkOutDate).sort().reverse()[0];
    const todayLocal = new Date().toISOString().slice(0, 10);
    const to = latestCheckOut > todayLocal ? todayLocal : latestCheckOut;

    const dto: ReportPeriodDto = { preset: 'custom', from: earliestCheckIn, to };

    console.log(`Hotel: ${HOTEL_SLUG} (${hotel.id})`);
    console.log(`Seeded stays: ${stays.length}`);
    console.log(`Custom report period: ${dto.from} .. ${dto.to}`);

    const balances = app.get(ReportsBalancesService);
    const operational = app.get(ReportsOperationalService);
    const revenue = app.get(ReportsRevenueService);
    const overview = app.get(ReportsOverviewService);

    const cold = await runPass('COLD', hotel.id, dto, balances, operational, revenue, overview);
    const warm = await runPass('WARM', hotel.id, dto, balances, operational, revenue, overview);

    console.log('\n=== Summary (cold vs warm) ===');
    console.log('Report'.padEnd(26) + 'Cold (ms)'.padStart(12) + 'Warm (ms)'.padStart(12) + '  Within budget (warm)?');
    let anyOverBudget = false;
    for (let i = 0; i < warm.length; i++) {
      const c = cold[i];
      const w = warm[i];
      const ok = w.ms <= BUDGET_MS;
      if (!ok) anyOverBudget = true;
      console.log(
        w.name.padEnd(26) + c.ms.toFixed(2).padStart(12) + w.ms.toFixed(2).padStart(12) + `  ${ok ? '✅' : '❌ EXCEEDS 500ms'}`,
      );
    }
    console.log(anyOverBudget ? '\nRESULT: one or more calls exceeded the 500ms budget (warm).' : '\nRESULT: all 9 calls are within the 500ms budget (warm).');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

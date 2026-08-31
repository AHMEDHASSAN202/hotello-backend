import { defineConfig } from '@playwright/test';
import path from 'node:path';

const API_URL = process.env.GXP_API_URL ?? 'http://localhost:4000/api/v1';

/**
 * GXP E2E QA suites.
 *
 * Prereqs (the normal dev stack):
 *   ./dev.sh backend tenant          (Postgres + API :4000 + tenant app :3001)
 * Environment overrides:
 *   GXP_API_URL / GXP_TENANT_URL / GXP_ADMIN_EMAIL / GXP_ADMIN_PASSWORD
 *   GXP_DB_CONTAINER (used for audit-log verification + test-data cleanup)
 */
export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  globalSetup: path.join(__dirname, 'helpers', 'global-setup.ts'),
  globalTeardown: path.join(__dirname, 'helpers', 'global-teardown.ts'),
  // Each worker seeds its OWN hotel (worker fixture) so suites never touch
  // each other's data; parallelism stays deterministic.
  workers: 3,
  fullyParallel: true,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: path.join(__dirname, 'results', 'report.json') }]],
  use: {
    // Server root only — request paths are built by the helpers (the API
    // lives under /api/v1).
    baseURL: new URL(API_URL).origin,
    trace: 'retain-on-failure',
    extraHTTPHeaders: { 'x-qa-suite': 'gxp-e2e' },
  },
});

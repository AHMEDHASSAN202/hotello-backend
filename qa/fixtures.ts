/**
 * Hotel fixtures: each Playwright worker provisions ONE hotel (owner session
 * + admin token + seeded room type) through the real onboarding flow, and all
 * tests in that worker share it. Slugs are unique per run, so re-runs never
 * collide; global teardown deletes every `qa-*` hotel.
 *
 * Worker fixtures cannot depend on the test-scoped `request` fixture, so each
 * worker creates its own long-lived APIRequestContext here.
 */
import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import {
  adminLogin,
  apiGetRetry,
  provisionHotel,
  type ProvisionedHotel,
  type RoomType,
} from './helpers/gxp-api';

/** Worker-scoped fixtures — one per worker process. */
interface WorkerFixtures {
  api: APIRequestContext;
  hotel: ProvisionedHotel;
  adminToken: string;
  standardType: RoomType;
}

export const test = base.extend<{}, WorkerFixtures>({
  api: [
    async ({}, use) => {
      const ctx = await playwrightRequest.newContext();
      await use(ctx);
      await ctx.dispose();
    },
    { scope: 'worker' },
  ],
  hotel: [
    async ({ api }, use, workerInfo) => {
      const hotel = await provisionHotel(api, {
        epic: 'e11',
        tag: `w${workerInfo.workerIndex}`,
      });
      await use(hotel);
    },
    { scope: 'worker' },
  ],
  adminToken: [
    async ({ api }, use) => {
      await use(await adminLogin(api));
    },
    { scope: 'worker' },
  ],
  standardType: [
    async ({ api, hotel }, use) => {
      const types = (await apiGetRetry<{ data: RoomType[] }>(api, '/tenant/room-types', hotel.ownerToken)).body.data;
      const standard = types.find((t) => t.nameEn === 'Standard');
      expect(standard, 'seeded default room types (11.1 AC2)').toBeTruthy();
      await use(standard!);
    },
    { scope: 'worker' },
  ],
});

export { expect };
export { apiGet, apiPost } from './helpers/gxp-api';

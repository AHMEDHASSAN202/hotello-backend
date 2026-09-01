/**
 * Tenant-dashboard UI helpers shared by the suites.
 */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { TENANT_URL } from './gxp-api';

/**
 * Establish a tenant session exactly the way the app's `lib/auth.ts` does:
 * the middleware cookie flag BEFORE the first navigation, then localStorage
 * tokens via init script. `awaitNav` waits for one nav link (pass null for
 * permission-limited users whose nav differs).
 */
export async function uiSession(
  page: Page,
  slug: string,
  accessToken: string,
  refreshToken: string,
  awaitNav: string | null = 'Rooms',
) {
  await page.context().addCookies([
    { name: 'gxp_tenant_auth', value: '1', url: TENANT_URL, sameSite: 'Lax' },
  ]);
  await page.addInitScript(
    ([access, refresh]) => {
      window.localStorage.setItem('gxp_tenant_access_token', access!);
      window.localStorage.setItem('gxp_tenant_refresh_token', refresh!);
    },
    [accessToken, refreshToken] as const,
  );
  await page.goto(`${TENANT_URL}/t/${slug}`);
  if (awaitNav) {
    await expect(page.getByRole('link', { name: awaitNav })).toBeVisible();
  }
}

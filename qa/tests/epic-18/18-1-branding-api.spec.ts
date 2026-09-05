/**
 * Epic 18 — Story 18.1 API contract: the three knobs (accent, cover,
 * welcome), contrast enforcement, cover lifecycle + renditions (with the
 * 18.2 AC4 immutable cache), and `branding.updated` audit diffs.
 * Tenant-UI behavior lives in 18-3; the guest profile in 18-2.
 */
import { expect, test } from '../../fixtures';
import { apiGetRaw } from '../../helpers/gxp-api';
import { auditCount, lastAuditMeta } from '../../helpers/db';
import {
  accentAllowed,
  brandHotel,
  deleteCover,
  getBranding,
  nearestSafeAccentMirror,
  patchBranding,
  solidPng,
  uploadCover,
  type BrandingView,
} from './helpers';

// Provisioning + the shared login pacer need headroom.
test.setTimeout(420_000);

test('18.1 AC1/AC3 — accent knob: set, reflected in the view, audited with a diff; no-op writes audit nothing; empty string resets', async ({
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, 'ac');
  expect(await auditCount('branding.updated', hotel.hotelId)).toBe(0);

  const set = await patchBranding(request, hotel.ownerToken, { brandAccentColor: '#7A3B8F' });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  expect(set.body.brandAccentColor).toBe('#7A3B8F');

  // The change is audited with an exact from→to diff.
  expect(await auditCount('branding.updated', hotel.hotelId)).toBe(1);
  const meta = JSON.parse((await lastAuditMeta('branding.updated', hotel.hotelId)) ?? '{}');
  expect(meta.diff).toMatchObject({ brandAccentColor: { from: null, to: '#7A3B8F' } });

  // Idempotent re-send: 200, but no second audit row.
  const noop = await patchBranding(request, hotel.ownerToken, { brandAccentColor: '#7A3B8F' });
  expect(noop.status).toBe(200);
  expect(await auditCount('branding.updated', hotel.hotelId)).toBe(1);

  // Empty string = reset to the GXP default (null), audited as a diff.
  const reset = await patchBranding(request, hotel.ownerToken, { brandAccentColor: '' });
  expect(reset.status).toBe(200);
  expect(reset.body.brandAccentColor).toBeNull();
  const meta2 = JSON.parse((await lastAuditMeta('branding.updated', hotel.hotelId)) ?? '{}');
  expect(meta2.diff).toMatchObject({ brandAccentColor: { from: '#7A3B8F', to: null } });
});

test('18.1 AC1 — contrast safety is enforced server-side: unreadable accent blocked with a passing, hue-preserving suggestion; malformed hex rejected by the DTO', async ({
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, `ct`);

  // Pure yellow is unreadable on white → blocked with a code + suggestion.
  const blocked = await patchBranding(request, hotel.ownerToken, { brandAccentColor: '#FFFF00' });
  expect(blocked.status).toBe(400);
  expect(blocked.body.code).toBe('BRANDING_ACCENT_CONTRAST');
  const suggestion = blocked.body.suggestion ?? '';
  // The suggestion must actually pass 3:1 — verified with our own WCAG math.
  expect(suggestion).toMatch(/^#[0-9a-fA-F]{6}$/);
  expect(accentAllowed(suggestion), `suggestion ${suggestion} must pass 3:1`).toBe(true);
  // Hue-preserving darkening: yellow stays yellow (r == g, b == 0) and matches
  // the documented 2%-step algorithm exactly.
  const r = parseInt(suggestion.slice(1, 3), 16);
  const g = parseInt(suggestion.slice(3, 5), 16);
  const b = parseInt(suggestion.slice(5, 7), 16);
  expect(r).toBe(g);
  expect(b).toBe(0);
  expect(suggestion.toUpperCase()).toBe(nearestSafeAccentMirror('#FFFF00').toUpperCase());

  // The rejected value must not have been stored.
  const after = await getBranding(request, hotel.ownerToken);
  expect(after.body.brandAccentColor).toBeNull();

  // Malformed hex: DTO validation, not the contrast rule.
  const malformed = await patchBranding(request, hotel.ownerToken, { brandAccentColor: 'blue' });
  expect(malformed.status).toBe(400);
  expect(JSON.stringify(malformed.body)).toContain('RRGGBB');
  const short = await patchBranding(request, hotel.ownerToken, { brandAccentColor: '#7A3' });
  expect(short.status).toBe(400);

  // A passing accent still saves fine after the rejections.
  const ok = await patchBranding(request, hotel.ownerToken, { brandAccentColor: '#7A3B8F' });
  expect(ok.status).toBe(200);
  expect(ok.body.brandAccentColor).toBe('#7A3B8F');
});

test('18.1 AC1/AC3 — welcome message: AR+EN required, five optional languages merge, 80-char cap, per-language clear, all-empty clears, exact audit diff', async ({
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, `wm`);

  // Either required language alone → rejected.
  const enOnly = await patchBranding(request, hotel.ownerToken, {
    welcomeEn: 'Welcome to the heart of Hurghada',
  });
  expect(enOnly.status).toBe(400);
  expect(enOnly.body.code).toBe('BRANDING_WELCOME_REQUIRED');
  const arOnly = await patchBranding(request, hotel.ownerToken, { welcomeAr: 'أهلاً بكم في قلب الغردقة' });
  expect(arOnly.status).toBe(400);
  expect(arOnly.body.code).toBe('BRANDING_WELCOME_REQUIRED');

  // AR + EN together is the minimum.
  const base = await patchBranding(request, hotel.ownerToken, {
    welcomeAr: 'أهلاً بكم في قلب الغردقة',
    welcomeEn: 'Welcome to the heart of Hurghada',
  });
  expect(base.status, JSON.stringify(base.body)).toBe(200);
  expect(base.body.welcomeMessage).toMatchObject({
    ar: 'أهلاً بكم في قلب الغردقة',
    en: 'Welcome to the heart of Hurghada',
  });

  // Optional languages merge in without touching AR/EN.
  const ru = await patchBranding(request, hotel.ownerToken, { welcomeRu: 'Добро пожаловать' });
  expect(ru.status).toBe(200);
  expect(ru.body.welcomeMessage).toMatchObject({
    ar: 'أهلاً بكم في قلب الغردقة',
    en: 'Welcome to the heart of Hurghada',
    ru: 'Добро пожаловать',
  });

  // 80 is the cap: 81 chars → DTO 400, 80 chars → 200.
  const tooLong = await patchBranding(request, hotel.ownerToken, { welcomeEn: 'x'.repeat(81) });
  expect(tooLong.status).toBe(400);
  const atCap = await patchBranding(request, hotel.ownerToken, { welcomeEn: 'x'.repeat(80) });
  expect(atCap.status, JSON.stringify(atCap.body)).toBe(200);
  expect(atCap.body.welcomeMessage?.en).toBe('x'.repeat(80));

  // The welcome diff is audited (from the empty start to the merged map).
  const meta = JSON.parse((await lastAuditMeta('branding.updated', hotel.hotelId)) ?? '{}');
  expect(meta.diff.welcomeMessage).toBeTruthy();
  expect(meta.diff.welcomeMessage.to).toMatchObject({ ru: 'Добро пожаловать', en: 'x'.repeat(80) });

  // Empty string clears just that language (replace semantics).
  const clearRu = await patchBranding(request, hotel.ownerToken, { welcomeRu: '' });
  expect(clearRu.status).toBe(200);
  expect(clearRu.body.welcomeMessage?.ru).toBeUndefined();
  expect(clearRu.body.welcomeMessage?.en).toBeDefined();

  // All seven empty → the message is gone entirely (no REQUIRED error).
  const clearAll = await patchBranding(request, hotel.ownerToken, {
    welcomeAr: '',
    welcomeEn: '',
    welcomeRu: '',
    welcomeFr: '',
    welcomeIt: '',
    welcomeEs: '',
    welcomeDe: '',
  });
  expect(clearAll.status).toBe(200);
  expect(clearAll.body.welcomeMessage).toBeNull();
});

test('18.1 AC1/AC3 + 18.2 AC4 — cover lifecycle: validation, two renditions under branding/ served immutably, replace gets fresh keys, remove + idempotent remove audited', async ({
  request,
  adminToken,
}) => {
  const hotel = await brandHotel(request, adminToken, `cv`);

  // Validation branches first.
  const noFile = await uploadCover(request, hotel.ownerToken, null);
  expect(noFile.status).toBe(400);
  expect((noFile.body as { code?: string }).code).toBe('BRANDING_COVER_REQUIRED');
  const badMime = await uploadCover(request, hotel.ownerToken, {
    name: 'cover.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });
  expect(badMime.status).toBe(400);
  expect((badMime.body as { code?: string }).code).toBe('BRANDING_COVER_INVALID');
  const corrupt = await uploadCover(request, hotel.ownerToken, {
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not-an-image-but-png-typed'),
  });
  expect(corrupt.status).toBe(400);
  expect((corrupt.body as { code?: string }).code).toBe('BRANDING_COVER_INVALID');

  // Happy path: one upload → two wide renditions (thumb 640×360, detail 1440×810).
  const up = await uploadCover(request, hotel.ownerToken, {
    name: 'cover.png',
    mimeType: 'image/png',
    buffer: solidPng(),
  });
  expect(up.status, JSON.stringify(up.body)).toBe(200);
  const view1 = up.body as unknown as BrandingView;
  expect(view1.coverThumbUrl).toMatch(new RegExp(`^files/branding/${hotel.hotelId}/.+\\.webp$`));
  expect(view1.coverDetailUrl).toMatch(new RegExp(`^files/branding/${hotel.hotelId}/.+\\.webp$`));
  expect(view1.coverThumbUrl).not.toBe(view1.coverDetailUrl);

  // Both renditions are publicly served as webp with the immutable year cache.
  const thumb = await apiGetRaw(request, `/${view1.coverThumbUrl!}`);
  expect(thumb.status).toBe(200);
  expect(thumb.contentType).toBe('image/webp');
  expect(thumb.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  const detail = await apiGetRaw(request, `/${view1.coverDetailUrl!}`);
  expect(detail.status).toBe(200);
  expect(detail.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(detail.body.length).toBeGreaterThan(thumb.body.length);

  // Replace → fresh uuid keys (immutable-cache safe), old pair dropped from the view.
  const up2 = await uploadCover(request, hotel.ownerToken, {
    name: 'cover2.png',
    mimeType: 'image/png',
    buffer: solidPng(160, 90, [30, 120, 200]),
  });
  expect(up2.status).toBe(200);
  const view2 = up2.body as unknown as BrandingView;
  expect(view2.coverThumbUrl).not.toBe(view1.coverThumbUrl);
  expect(view2.coverDetailUrl).not.toBe(view1.coverDetailUrl);

  // Remove → nulls; a second remove is a silent no-op (no audit).
  const del = await deleteCover(request, hotel.ownerToken);
  expect(del.status).toBe(200);
  const afterDelete = (await getBranding(request, hotel.ownerToken)).body;
  expect(afterDelete.coverThumbUrl).toBeNull();
  expect(afterDelete.coverDetailUrl).toBeNull();

  // Audit trail: one `changed` per upload, one `removed` for the delete.
  expect(await auditCount('branding.updated', hotel.hotelId)).toBe(3);
  const changed = JSON.parse((await lastAuditMeta('branding.updated', hotel.hotelId)) ?? '{}');
  expect(changed.diff).toMatchObject({ coverImage: { removed: true } });
});

import { randomInt } from 'crypto';

// Unambiguous alphabets (no O/0, I/l/1) so a spoken/copied temp password is
// easy to relay to on-ground staff.
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL = LOWER + UPPER + DIGITS;

const pick = (alphabet: string): string =>
  alphabet[randomInt(0, alphabet.length)];

/**
 * A temporary password that always satisfies the standard policy (≥ 8 chars,
 * at least one letter and one number — mirrors the class-validator rule used
 * across setup/change-password). Used for direct staff creation (Story 9.7)
 * and manager resets (Story 9.8); shown to the manager exactly once, never
 * stored raw.
 */
export function generateTempPassword(length = 12): string {
  const size = Math.max(8, length);
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < size) chars.push(pick(ALL));
  // Fisher–Yates so the guaranteed positions aren't predictable.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

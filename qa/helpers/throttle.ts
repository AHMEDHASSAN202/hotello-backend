/**
 * Cross-process login pacer.
 *
 * The product rate-limits logins to 5/min per IP (SA-AUTH), and every
 * Playwright worker (and every run) shares the same IP. This pacer keeps a
 * shared ring-buffer of login timestamps in a temp file so ALL processes pace
 * together: at most LOGIN_BURST logins per LOGIN_WINDOW_MS, deterministically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const BUCKET_FILE = path.join(tmpdir(), 'gxp-qa-login-throttle.json');
const LOCK_FILE = path.join(tmpdir(), 'gxp-qa-login-throttle.lock');
const LOGIN_BURST = 4;
const LOGIN_WINDOW_MS = 62_000;
const LOCK_TIMEOUT_MS = 120_000;

interface Ring {
  ts: number[];
}

function readRing(): Ring {
  try {
    const raw = JSON.parse(fs.readFileSync(BUCKET_FILE, 'utf8')) as Ring;
    return { ts: Array.isArray(raw.ts) ? raw.ts : [] };
  } catch {
    return { ts: [] };
  }
}

function writeRing(ring: Ring): void {
  fs.writeFileSync(BUCKET_FILE, JSON.stringify(ring));
}

/** mkdir-based lock: atomic on POSIX, retried until acquired. */
function withLock<T>(fn: () => T): T {
  const start = Date.now();
  let locked = false;
  while (true) {
    try {
      fs.mkdirSync(LOCK_FILE);
      locked = true;
      break;
    } catch {
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        // Stale lock from a killed run — steal it.
        try {
          fs.rmdirSync(LOCK_FILE);
        } catch {
          /* ignore */
        }
        continue;
      }
      const wait = 50 + Math.floor(Math.random() * 100);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
  try {
    return fn();
  } finally {
    if (locked) {
      try {
        fs.rmdirSync(LOCK_FILE);
      } catch {
        /* ignore */
      }
    }
  }
}

const sleeps: Array<() => void> = [];

/** Reserve one login slot, sleeping (synchronously) if the window is full. */
export function reserveLoginSlot(): void {
  withLock(() => {
    const now = Date.now();
    const ring = readRing();
    ring.ts = ring.ts.filter((t) => now - t < LOGIN_WINDOW_MS);
    if (ring.ts.length >= LOGIN_BURST) {
      const waitMs = LOGIN_WINDOW_MS - (now - ring.ts[0]) + 500;
      // Busy-wait is fine at this scale; must stay synchronous inside the lock.
      const release = now + waitMs;
      while (Date.now() < release) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      }
      const fresh = readRing();
      const now2 = Date.now();
      fresh.ts = fresh.ts.filter((t) => now2 - t < LOGIN_WINDOW_MS);
      fresh.ts.push(now2);
      writeRing(fresh);
      return;
    }
    ring.ts.push(now);
    writeRing(ring);
  });
}

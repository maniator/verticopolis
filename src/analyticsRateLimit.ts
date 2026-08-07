/**
 * The per-IP rate limiter the analytics ingest routes share, split out of
 * `analyticsIngest.ts` so that module keeps room under the file-size guard. Pure
 * and dependency-free (no DOM, no platform, no clock of its own: the caller
 * passes `now`), so it compiles into the Vercel function alongside the route
 * core and stays unit-testable on its own.
 *
 * `analyticsIngest.ts` re-exports every name here, so the routes' importers and
 * tests keep one entry point.
 */

/** Requests allowed per IP per fixed window before a 429. A play session emits
 *  on the order of a few dozen events over minutes, so this is generous for
 *  legitimate use while capping a hostile burst. */
export const RATE_LIMIT_MAX = 100;
/** The fixed rate-limit window, in ms. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Hard ceiling on tracked IPs. The map never exceeds this: once full, the
 *  oldest entry is evicted on each new key, so a stream of unique IPs cannot grow
 *  memory without bound and each request stays O(1). */
export const RATE_LIMIT_MAX_KEYS = 10_000;

/**
 * A per-instance fixed-window rate limiter with a hard key ceiling. Best-effort
 * by design: serverless instances are ephemeral and requests spread across
 * several, so this caps abuse per instance rather than enforcing a global quota.
 * It holds only a count and a window start per IP, never the request content.
 * Memory is bounded: at the ceiling, inserting a new key evicts the oldest, so a
 * flood of unique keys cannot grow the map, and every operation is O(1).
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly max: number = RATE_LIMIT_MAX,
    private readonly windowMs: number = RATE_LIMIT_WINDOW_MS,
    private readonly maxKeys: number = RATE_LIMIT_MAX_KEYS,
  ) {}

  /** Record a hit for `key` at `now`; return false once the window is full. */
  allow(key: string, now: number): boolean {
    const rec = this.hits.get(key);
    if (rec && now - rec.windowStart < this.windowMs) {
      // Touch the key so any active key (hot or currently blocked) moves to the
      // newest position: `Map` insertion order does not update on `get`, so
      // without this a frequently-hit key could be the oldest and get evicted
      // below, resetting its window. Eviction then only ever removes idle keys.
      this.hits.delete(key);
      this.hits.set(key, rec);
      if (rec.count >= this.max) return false;
      rec.count += 1;
      return true;
    }
    // Start a fresh window for this key. At the ceiling, evict the oldest (least
    // recently touched) entry first, so a flood of unique keys cannot grow the
    // map and an active key is never the one dropped.
    this.hits.delete(key);
    if (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    this.hits.set(key, { count: 1, windowStart: now });
    return true;
  }
}

/** The process-wide limiter the real handlers fall back to when `deps` injects
 *  none. One per module instance, which is one per deployed function, so the two
 *  ingest routes hold separate budgets in production. */
export const defaultRateLimiter = new RateLimiter();

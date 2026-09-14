/**
 * The per-session flood guard the analytics paths that can fire in a loop share:
 * a hard cap on how many events one page sends, plus per-fingerprint dedup so a
 * repeating identical incident counts once rather than once per occurrence.
 *
 * It exists because a page can fail in a loop. A WebGL context loss that keeps
 * re-losing re-shows the crash screen in place with no reload, and an error
 * thrown from the frame loop throws again on the next frame; both would emit one
 * event per occurrence for as long as the page lives. One such session sent
 * 8,269 `crash` events in a day, which does more damage than the lost fidelity:
 * the ingest route rate-limits per IP per minute, so a flooding session gets its
 * OTHER events (the session summaries, the fps percentiles) dropped with a 429,
 * and the data loss lands exactly on the sessions worth studying.
 *
 * The guard was first written inline in `analyticsErrors.ts` for the
 * `$exception` path, which is why that path came through the same incident
 * having sent 11 events instead of thousands. It lives here so the crash path
 * uses the same implementation rather than a second copy of it.
 *
 * Each caller holds its OWN instance, so one path's flood cannot spend another
 * path's budget: a crash loop still leaves the error reporter its full cap.
 */

/**
 * A per-session cap-and-dedup latch. Pure bookkeeping: it decides whether an
 * event may be sent and never sends anything itself, so it stays trivially
 * testable and carries no transport or gate concerns.
 */
export interface SessionThrottle {
  /** True if an event with this fingerprint may be sent: the cap still has room
   *  AND this fingerprint has not been seen. A true answer consumes a slot. */
  allow(fingerprint: string): boolean;
  /** How many events this throttle has let through (for tests and diagnostics). */
  readonly count: number;
  /** True once the cap is spent, so a caller on a hot failure path can skip the
   *  work of building a fingerprint it already knows will be refused. */
  readonly exhausted: boolean;
  /** Re-open the cap and drop the fingerprints, for a fresh measurement window
   *  (a consent epoch) or a test. */
  reset(): void;
}

/**
 * Build a throttle that lets at most `max` distinct fingerprints through per
 * session. Distinct incidents past the cap are dropped too, which is the safe
 * direction: the point is a bounded number of requests, and the ingest route's
 * own per-IP rate limit is the outer backstop.
 */
export function createSessionThrottle(max: number): SessionThrottle {
  const seen = new Set<string>();
  let sent = 0;
  return {
    get count(): number {
      return sent;
    },
    get exhausted(): boolean {
      return sent >= max;
    },
    allow(fingerprint: string): boolean {
      if (sent >= max) return false;
      if (seen.has(fingerprint)) return false;
      seen.add(fingerprint);
      sent++;
      return true;
    },
    reset(): void {
      seen.clear();
      sent = 0;
    },
  };
}

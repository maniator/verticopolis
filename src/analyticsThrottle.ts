/**
 * The flood guard the analytics paths that can fire in a loop share: a hard cap
 * on how many events one PAGE LIFE sends, plus per-fingerprint dedup so a
 * repeating identical incident counts once rather than once per occurrence.
 *
 * Not per analytics SESSION, despite what a reader might assume. The budget is
 * this module instance's, so it re-opens on a reload, while the session id lives
 * in `sessionStorage` and deliberately survives one: a single `distinct_id` can
 * therefore carry more than one budget's worth. Intended, and tracked as its own
 * design question (backlog #844) rather than an oversight.
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
 * A cap-and-dedup latch. Pure bookkeeping: it decides whether an event may be
 * sent and never sends anything itself, so it stays trivially testable and
 * carries no transport or gate concerns.
 */
export interface EventThrottle {
  /** True if an event with this fingerprint may be sent: the cap still has room
   *  AND this fingerprint has not been seen. A true answer consumes a slot. */
  allow(fingerprint: string): boolean;
  /** How many events this throttle has let through (for tests and diagnostics). */
  readonly count: number;
  /** True once the cap is spent, so a caller on a hot failure path can skip the
   *  work of building a fingerprint it already knows will be refused. */
  readonly exhausted: boolean;
  /** Re-open the cap and drop the fingerprints.
   *
   *  When a caller does this is the CALLER's choice, and the invariant worth
   *  keeping is that a slot stays spent if and only if its event actually went
   *  out. The two callers reach that the same way by different routes, because
   *  they latch on opposite sides of the telemetry gate:
   *
   *  - `$exception` (`analyticsErrors.ts`) latches AFTER the gate, and never
   *    enters the first-run held queue, so an un-sendable error never spends a
   *    slot and there is nothing to hand back. It resets only in its test hook.
   *  - `crash` (`analyticsCrash.ts`) latches BEFORE `trackEvent`, which is where
   *    its gate and the hold both live, so a slot can be spent on an event whose
   *    fate is still open. `analytics.ts` hands those back on a consent answer
   *    that means the held crashes are about to be dropped, and keeps them on one
   *    that means they are about to be sent.
   *
   *  The asymmetry is deliberate. An earlier note here called it undesigned and
   *  cited a backlog row; the row's premise was wrong and it closed (#842). */
  reset(): void;
}

/**
 * Build a throttle that lets at most `max` distinct fingerprints through per
 * PAGE LIFE, not per analytics session: the budget belongs to this instance in
 * module memory, so a reload opens a fresh one while the session id survives.
 * Distinct incidents past the cap are dropped too, which is the safe
 * direction: the point is a bounded number of requests, and the ingest route's
 * own per-IP rate limit is the outer backstop.
 */
export function createEventThrottle(max: number): EventThrottle {
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

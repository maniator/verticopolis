/**
 * The 2.0 "Ground floor" recognition: a thank-you to players who were here
 * before 2.0. Party-ratified (2026-07-23): status over stuff, no cash, no nag.
 *
 * The Founder STATUS itself lives IN THE SAVE (`sim.founder`, detected once at
 * load from the pre-2.0 appVersion and then persisted): it travels with the tower
 * across re-saves, exports, and devices, and only towers that actually predate
 * 2.0 carry it (a brand-new 2.0 tower does not). This module holds only the
 * one-time WELCOME moment, which is a per-browser-profile UX event, not tower
 * state, so it is latched in localStorage. Best-effort: storage-blocked is a
 * silent no-op (the badge still shows from the save; only the toast is skipped).
 */

/** Latched once the Founder has been greeted on this browser profile, so the
 *  welcome toast fires at most once even across many boots and many towers. */
const WELCOMED_FLAG = "vc-founder-welcomed";

/**
 * True at most once per browser profile: the first time a Founder should be
 * greeted. Sets the latch as a side effect, so a second call returns false. The
 * caller gates this on the loaded tower actually being a Founder (`sim.founder`),
 * so a non-founder never trips it.
 */
export function shouldWelcomeFounder(): boolean {
  try {
    if (localStorage.getItem(WELCOMED_FLAG) === "1") return false;
    localStorage.setItem(WELCOMED_FLAG, "1");
    return true;
  } catch {
    return false; // storage blocked: skip the toast, never crash
  }
}

/** Test-only: clear the welcome latch so a suite starts from a clean slate. */
export function __resetFounderForTest(): void {
  try {
    localStorage.removeItem(WELCOMED_FLAG);
  } catch {
    /* ignore */
  }
}

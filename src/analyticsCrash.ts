import { trackEvent, type GameplayEvents } from "./analyticsCore";
import { createEventThrottle } from "./analyticsThrottle";

/**
 * The `crash` signal: the crash-screen report, plus the cap and dedup that keep a
 * crash LOOP from drowning the stream.
 *
 * Its own module rather than a `GameplaySession` method because it holds no
 * session state: the throttle is module memory and the event carries everything
 * it needs. That puts it alongside `analyticsErrors.ts`, the `$exception` twin
 * that shares the same guard from `analyticsThrottle.ts`. `GameplaySession`
 * re-exposes both functions so the shell keeps its one analytics handle.
 */

export /** Hard cap on `crash` events one PAGE LIFE sends, named for what it bounds: the
 *  throttle is module memory, so a reload re-opens it, while the session id
 *  survives in `sessionStorage`, and one `distinct_id` can exceed ten across page
 *  lives. Intended, not an oversight. The flood this exists to stop needs no
 *  reload (the screen re-shows in place: 8,269 events in one page life), reloads
 *  are human-paced so they cannot threaten the per-IP budget, and a crash that
 *  survives one is a new incident worth seeing. Persisting it anyway is a tracked
 *  backlog decision. Its own literal, not shared with `analyticsErrors.ts`'s cap:
 *  they agree at 10 today but bound different streams. */
const MAX_CRASHES_PER_PAGE_LIFE = 10;

/** Cap and per-fingerprint dedup for `crash`. Module memory, so its budget is per
 *  PAGE LIFE: a reload re-opens it and the session id outlives that. The cap
 *  matches the `$exception` path's, whose identical guard is why the same incident
 *  produced 11 error reports rather than thousands. Deliberately does NOT follow
 *  the consent measurement window; see {@link releaseCrashThrottle}. */
const crashes = createEventThrottle(MAX_CRASHES_PER_PAGE_LIFE);

/**
 * Report a crash (crash-screen moment) with its flattened description, capped
 * and deduplicated per PAGE LIFE (see {@link MAX_CRASHES_PER_PAGE_LIFE}).
 *
 * The guard is not a nicety. The crash screen is re-shown IN PLACE on each
 * loss, with no reload, so a device whose WebGL context keeps dying re-enters
 * this call for as long as the tab lives: one session sent 8,269 `crash`
 * events in a day. Past the wrecked crash counts, that flood spends the ingest
 * route's per-IP minute budget, so the same session's `session_builds`,
 * `tool_session_uses`, `session_fps` and `session_end` come back 429 and are
 * lost, which puts the data loss precisely on the sessions worth studying.
 *
 * The fingerprint is every FLAG on the crash and none of the tower context, so
 * a loop settles onto one fingerprint and reports once. The whole flag set
 * rather than a chosen subset is the point: each marks a materially different
 * incident (a failed in-place recovery, a loss behind the splash, a save that
 * could not be flushed), and dropping one would silently merge two and report
 * only whichever came first. `repeat` matters most: it is the signal that a
 * loop happened at all, it flips on the second loss inside 90s, and without it
 * the dedup swallows the one event carrying it wherever nothing else changed.
 * So a loop emits the first loss, the first repeat, and nothing more.
 *
 * The four flags span 16 shapes per `kind`, MORE than the cap of 10, so the key
 * does not by itself guarantee every shape reports: past 10 the cap merges
 * whatever arrives later. What keeps that off a real device is REACHABILITY,
 * not the key's width. `recoverFromContextLoss` produces six of the sixteen,
 * `kind` has one value, and a real loop settles on two, so six sits inside ten
 * with room. The three constraints that get you from sixteen to six, because a
 * count you cannot reproduce is no use to the next editor: `behindSplash` leaves
 * `saveFlushed` at its `true` initializer and always takes the early return, so
 * it forbids `recoveryFailed` (two tuples); `recoveryFailed` is reachable only
 * PAST that early return, which needs `!repeat && !behindSplash && saveFlushed`
 * (one tuple); and that same early return is why such a loss never reports
 * `recoveryFailed: false`, since it goes to the recovery attempt instead and a
 * successful one shows no screen at all (three tuples, not four). Add a fifth
 * flag or a second `kind` and re-derive this before assuming it still holds.
 *
 * What is still lost, deliberately: HOW MANY times each shape recurred. A
 * two-loss blip and an 8,269-loss catastrophe now look identical, which the
 * cap's whole purpose makes unavoidable here and which is tracked as its own
 * backlog item rather than smuggled into this event.
 */
export function noteCrash(info: GameplayEvents["crash"]): void {
  const fingerprint = `${info.kind}|${info.repeat}|${info.recoveryFailed}|${info.behindSplash}|${info.saveFlushed}`;
  if (!crashes.allow(fingerprint)) return;
  trackEvent("crash", info);
}

/** Hand back the throttle's spent slots, for a caller that knows the events which
 *  spent them will never be transmitted.
 *
 *  Deliberately not tied to the consent measurement window: a slot should stay
 *  spent if and only if its event went out, and only the consent layer knows
 *  which. `setDesktopConsent` notifies watchers BEFORE it settles the held queue,
 *  so at watcher time a grant means the held crashes are about to flush (keep the
 *  slots, or an identical recurrence sends a duplicate) while any other answer
 *  means they are about to be dropped (release them, or a crash the player has
 *  since agreed to share stays silenced). `analytics.ts` makes that call.
 *
 *  One case stays imperfect on purpose: a crash raised DURING a declined window
 *  spends a slot that cannot transmit, and a later grant keeps it, because that
 *  same grant is flushing a queue whose slots must survive. It costs at most one
 *  of ten shapes and errs toward reporting less, the safe direction for a guard
 *  whose job is to stop a flood. */
export function releaseCrashThrottle(): void {
  crashes.reset();
}

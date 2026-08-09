/**
 * The desktop analytics consent state, the gate half it feeds, and the bounded
 * in-memory hold that keeps first-run events from being lost while the player
 * has not answered yet (issue #781, the client stage).
 *
 * ## Why desktop needs a consent state at all, and iOS does not
 *
 * The web build reports from a page we serve, with no cookie and no cross-visit
 * identifier, which is why it carries no banner. A packaged desktop build is an
 * installed binary that reaches out from the player's own machine to a site
 * across the internet, and the party ruling (2026-08-07) made three
 * compensating requirements non-negotiable in exchange for defaulting the
 * dataset on: a notice before anything leaves, a real opt-out, and copy that
 * describes the desktop posture honestly. This module owns the first two.
 *
 * The iOS Capacitor shell is NOT covered by any of this. It stays
 * unconditionally dark, which is a separate decision the ruling left alone:
 * {@link desktopAnalyticsAllowed} answers false for every mode except
 * `desktop`, so opening iOS would take a deliberate edit here rather than a
 * consent value someone set.
 *
 * ## Where the state lives, and why it is its own key
 *
 * A dedicated `localStorage` key beside `vc.prefs` rather than a field inside
 * it. There is no desktop-specific preference store in this repo: a desktop
 * build persists preferences exactly the way the browser build does, through
 * `Prefs` and localStorage, which on the shell is the app profile's own origin
 * storage. Folding the consent value into `Prefs` would put it inside the
 * object `audioPrefs` writes wholesale on a 200 ms debounce, so a slider
 * dragged after the notice resolved would write back a copy of the prefs that
 * predates the answer and silently revert it. Its own key cannot be clobbered
 * that way, and it keeps a privacy decision out of a presentation blob that
 * travels nowhere near it.
 *
 * The value is also memoized in module memory and the memo is authoritative for
 * reads, so flipping the Settings switch changes the gate's answer on the very
 * next call with no reload.
 *
 * ## What is NOT stored
 *
 * The pending hold below is memory only. Nothing about a held event reaches
 * localStorage, sessionStorage, or the shell's save store, and a send that
 * fails is dropped rather than retried or persisted. The ruling is explicit
 * about why: a disk queue would turn a session-scoped anonymous stream into
 * stored behavioral data, which is the line the privacy voice was defending
 * when it lost the default-off argument.
 */

/** The three answers a desktop player can be in. `pending` is first run, before
 *  the notice has resolved, and emits nothing. */
export type DesktopConsentState = "pending" | "granted" | "declined";

/**
 * True only in a `vite build --mode desktop` bundle. Vite statically replaces
 * `import.meta.env.MODE`, so this folds to a literal at build time and Rollup
 * drops the notice and the Settings row out of a web bundle entirely, the same
 * technique `IS_WRAPPED_BUILD` uses in the platform seam. A property check on a
 * resolved value would read the same to a human and fold nothing.
 */
export const IS_DESKTOP_BUILD = import.meta.env.MODE === "desktop";

/** The consent value's own localStorage key. See the module note on why it is
 *  not a `vc.prefs` field. */
const CONSENT_KEY = "vc.desktop-analytics";

/** Longest run of events held while the answer is outstanding. A first run
 *  emits a handful (the boot snapshot, a founding, the first placements), so 32
 *  covers the real window with room to spare while bounding what an unanswered
 *  notice can pin in memory. Past the cap the OLDEST is dropped, because the
 *  events nearest the answer describe the session that is actually underway. */
const PENDING_CAP = 32;

/** The live answer, memoized so the gate never re-reads storage per event and so
 *  a Settings flip is visible immediately. `undefined` means "not read yet". */
let consent: DesktopConsentState | undefined;

/** Events emitted while the answer was outstanding, oldest first. Thunks rather
 *  than payloads, so this module never learns the event vocabulary and can hold
 *  anything the caller can send. MEMORY ONLY; see the module note. */
let held: (() => void)[] = [];

/** Read the stored answer. Anything that is not one of the two resolved values
 *  (absent, corrupt, a blocked storage that throws) reads as `pending`, so the
 *  failure direction is always "ask again and send nothing". */
function loadConsent(): DesktopConsentState {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return raw === "granted" || raw === "declined" ? raw : "pending";
  } catch {
    return "pending";
  }
}

/** Best-effort persist. A throw (blocked storage) leaves the answer live for
 *  this session and re-asks next launch, which is the safe direction. */
function storeConsent(state: DesktopConsentState): void {
  try {
    localStorage.setItem(CONSENT_KEY, state);
  } catch {
    /* blocked storage: the answer holds for this session and is asked again */
  }
}

/** The live desktop consent state, seeded from storage on first read. Meaningful
 *  only on a desktop build; every other surface ignores it. */
export function desktopConsentState(): DesktopConsentState {
  consent ??= loadConsent();
  return consent;
}

/**
 * The desktop half of the telemetry gate: true only for a `desktop` build whose
 * player has granted. Every other mode is false whatever the stored value says,
 * which is what keeps the iOS shell dark and keeps a stray consent value on a
 * web profile from meaning anything.
 *
 * Ordered so a non-desktop mode never touches storage at all: the web build
 * reads no new key and mints none.
 */
export function desktopAnalyticsAllowed(mode: string): boolean {
  return mode === "desktop" && desktopConsentState() === "granted";
}

/**
 * Record the player's answer and settle whatever was held.
 *
 * A grant flushes the held events in the order they were emitted, so the boot
 * snapshot still leads the session. A decline discards them without sending,
 * and they were never anywhere but memory. Each flushed send is wrapped: one
 * failing event must not strand the rest of the queue.
 */
export function setDesktopConsent(state: DesktopConsentState): void {
  consent = state;
  storeConsent(state);
  if (state === "pending") return; // nothing has been answered, so nothing settles
  const queued = held;
  held = [];
  if (state !== "granted") return; // declined: discard, never send
  for (const send of queued) {
    try {
      send();
    } catch {
      /* best-effort telemetry; a bad held event must not strand the queue */
    }
  }
}

/**
 * Hold one event while the desktop answer is outstanding, or do nothing.
 *
 * The caller reaches here only when the telemetry gate said no, and this is a
 * no-op for every reason the gate says no EXCEPT a desktop build still waiting
 * on its notice: localhost, the e2e preview server, a look-alike host, the iOS
 * shell, and a desktop player who declined all fall straight through. That is
 * what keeps the web build's behavior identical to before this landed.
 *
 * `mode` is a parameter with the live build mode as its default so the hold is
 * testable: under vitest `import.meta.env.MODE` is always `"test"`, which would
 * make every assertion here compare a no-op to a no-op. The live read is pinned
 * separately against the source text.
 */
export function holdWhilePending(send: () => void, mode: string = import.meta.env.MODE): void {
  if (mode !== "desktop") return;
  if (desktopConsentState() !== "pending") return;
  // Drop the oldest rather than grow: the bound is the point, and the newest
  // events describe the session the player is in the middle of.
  if (held.length >= PENDING_CAP) held.shift();
  held.push(send);
}

/** How many events are held right now. Diagnostic, and the handle the cap and
 *  discard tests read; the queue itself is deliberately not exported. */
export function heldEventCount(): number {
  return held.length;
}

/** Flip the desktop consent between granted and declined, returning the new
 *  "on" state so the Settings switch can re-read the callback's return rather
 *  than trusting its own checkbox. A `pending` player who reaches the switch at
 *  all (they dismissed the notice some other way) reads as off and grants. */
export function toggleDesktopAnalytics(): boolean {
  const next = desktopConsentState() === "granted" ? "declined" : "granted";
  setDesktopConsent(next);
  return next === "granted";
}

/** Test seam: clear the memo, the held events, and the stored answer so each
 *  test starts from a genuine first run. */
export function resetDesktopConsentForTests(): void {
  consent = undefined;
  held = [];
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* nothing stored to clear */
  }
}

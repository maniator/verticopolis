/**
 * Pure parsing/sanitization for the incoming build's `version.json`. Split out of
 * pwa.ts (which is service-worker plumbing, excluded from unit coverage) so the
 * security-relevant bounds — how release notes are filtered, trimmed, clamped and
 * capped before they reach the update modal — can be unit-tested without a network
 * or a service worker. Escaping happens in the UI (blocks XSS); these caps bound
 * layout damage from a malformed or (if the origin is ever compromised) hostile
 * payload.
 */

export interface UpdateInfo {
  /** The incoming build's `package.json` version, e.g. "1.1.1". */
  version?: string;
  /** Short git SHA of the incoming build, e.g. "a1b2c3d". */
  sha?: string;
  /** Player-facing "what's new" lines (empty until the trailer harvest ships). */
  notes?: string[];
}

/** Per-line cap: one giant unbroken token must not be able to wreck the modal
 *  layout, so each note is truncated to this many characters. */
export const MAX_NOTE_LEN = 200;
/** At most this many "what's new" lines are surfaced in the update prompt. */
export const MAX_NOTES = 3;

/**
 * Sanitize a parsed `version.json` payload into an {@link UpdateInfo}, or `null`
 * if it isn't an object. Keeps only string notes — trimmed, non-empty, each
 * length-capped to {@link MAX_NOTE_LEN} and the list capped to {@link MAX_NOTES} —
 * and type-guards `version`/`sha` to strings (anything else becomes `undefined`).
 */
export function parseUpdateInfo(j: unknown): UpdateInfo | null {
  if (typeof j !== "object" || j === null) return null;
  const o = j as Record<string, unknown>;
  const notes = Array.isArray(o.notes)
    ? o.notes
        .filter((n): n is string => typeof n === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => (s.length > MAX_NOTE_LEN ? s.slice(0, MAX_NOTE_LEN) : s))
        .slice(0, MAX_NOTES)
    : [];
  return {
    version: typeof o.version === "string" ? o.version : undefined,
    sha: typeof o.sha === "string" ? o.sha : undefined,
    notes,
  };
}

/**
 * True when `info` (the freshly fetched `version.json` of the DEPLOYED build)
 * describes a build different from the one currently running. This is the
 * belt-and-suspenders update check: `version.json` is always network-fresh
 * (never precached), so it reveals a new deploy even when the service-worker
 * script update was missed (for example a stale-served `sw.js`).
 *
 * Compares the git sha first (it changes on every build, so it also catches an
 * internal-only rebuild that did not bump the version), then the version string.
 * A missing or empty field on either side is ignored, and the non-git placeholder
 * `"unknown"` (what `gitShortSha()` emits outside a checkout) is treated the same
 * as missing, matching how the update prompt drops it. So absent or placeholder
 * data never triggers a false "update available".
 */
export function isDifferentBuild(
  info: UpdateInfo | null,
  runningVersion: string,
  runningSha: string,
): boolean {
  if (!info) return false;
  const realSha = (s: string | undefined): string => (s && s !== "unknown" ? s : "");
  const deployedSha = realSha(info.sha);
  const localSha = realSha(runningSha);
  if (deployedSha && localSha && deployedSha !== localSha) return true;
  if (info.version && runningVersion && info.version !== runningVersion) return true;
  return false;
}

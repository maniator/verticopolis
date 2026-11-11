/**
 * Pure parsing/sanitization for the incoming build's `version.json`. Split out of
 * pwa.ts (which is service-worker plumbing, excluded from unit coverage) so the
 * security-relevant bounds — how release notes are filtered, trimmed, clamped and
 * capped before they reach the update modal — can be unit-tested without a network
 * or a service worker. Escaping happens in the UI (blocks XSS); these caps bound
 * layout damage from a malformed or (if the origin is ever compromised) hostile
 * payload.
 */

/**
 * What a build is made of, as two independent parts: the game shell (every
 * source file outside the engine, hashed at build time) and the engine (the
 * Rust crate version and package source hash). A running client compares its own fingerprint with the
 * incoming build's to say whether an update touches the game, the engine or
 * both. Any part may be absent (a dev build, or a package that did not report).
 */
export interface BuildFingerprint {
  shell: string;
  engine: { crate?: string; rust?: string };
}

/** Which part of the game an update changes. */
export type UpdateKind = "game" | "engine" | "both";

export interface UpdateInfo {
  /** The incoming build's `package.json` version, e.g. "2.3.4". */
  version?: string;
  /** Short git SHA of the incoming build, e.g. "a1b2c3d". */
  sha?: string;
  /** Player-facing "what's new" lines of the incoming version. */
  notes?: string[];
  /**
   * Recent versions' notes, newest first, as `version.json` `releases` carries
   * them. {@link notesSinceRunning} narrows this to the versions the player has
   * not run yet, so the prompt shows every version they skipped (#1897).
   */
  releases?: ReleaseNotes[];
  /** The version the shown notes start after (set by {@link notesSinceRunning}). */
  since?: string;
  /** True when the player skipped more versions than `releases` carries. */
  more?: boolean;
  /** The incoming build's parts (see {@link BuildFingerprint}). */
  fingerprint?: BuildFingerprint;
  /** What this update changes, set by {@link withUpdateKind} from the two fingerprints. */
  kind?: UpdateKind;
  /** A one-line engine summary, such as "Rust engine 0.24.0 → 0.25.0", set with `kind` when an engine changed. */
  engineLine?: string;
}

/** One version's player notes (see `recentReleaseNotes` in src/changelog.ts). */
export interface ReleaseNotes {
  version: string;
  notes: string[];
}

/** A fingerprint field is a short token (a version or a hex digest). */
const MAX_FINGERPRINT_LEN = 64;
const token = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_FINGERPRINT_LEN ? v : undefined;

function parseFingerprint(shell: unknown, engine: unknown): BuildFingerprint | undefined {
  const s = token(shell);
  if (!s || typeof engine !== "object" || engine === null) return undefined;
  const e = engine as Record<string, unknown>;
  return { shell: s, engine: { crate: token(e.crate), rust: token(e.rust) } };
}

const differs = (a: string | undefined, b: string | undefined): boolean => a !== undefined && b !== undefined && a !== b;

/**
 * Whether the incoming build changes the game shell, the engine, both or neither
 * (`null`, also when either fingerprint is missing, so an older build shows the
 * plain prompt). `engineLine` names the engine change for the player.
 */
export function classifyUpdate(
  incoming: BuildFingerprint | undefined,
  running: BuildFingerprint | undefined,
): { kind: UpdateKind; engineLine?: string } | null {
  if (!incoming || !running) return null;
  const game = differs(incoming.shell, running.shell);
  const a = running.engine;
  const b = incoming.engine;
  const crate = differs(a.crate, b.crate);
  const rust = crate || differs(a.rust, b.rust);
  if (!game && !rust) return null;
  const lines: string[] = [];
  if (crate) lines.push(`Rust engine ${a.crate} → ${b.crate}`);
  else if (rust) lines.push(`Rust engine${b.crate ? ` ${b.crate}` : ""} (new build)`);
  let kind: UpdateKind = "game";
  if (rust) kind = game ? "both" : "engine";
  return { kind, ...(lines.length > 0 ? { engineLine: lines.join(" · ") } : {}) };
}

/** `info` with its {@link UpdateKind} and engine line filled in from the running build's fingerprint. */
export function withUpdateKind(info: UpdateInfo | undefined, running: BuildFingerprint | undefined): UpdateInfo | undefined {
  if (!info) return info;
  const c = classifyUpdate(info.fingerprint, running);
  return c ? { ...info, ...c } : info;
}

/** Per-line cap: one giant unbroken token must not be able to wreck the modal
 *  layout, so each note is truncated to this many characters. */
export const MAX_NOTE_LEN = 200;
/** At most this many "what's new" lines are surfaced in the update prompt. */
export const MAX_NOTES = 3;
/** At most this many versions' notes travel in `version.json` `releases` and
 *  reach the prompt: enough to cover a player who skipped a season of updates,
 *  small enough to keep the file and the modal short. */
export const MAX_RELEASES = 10;

/** Trimmed, non-empty string notes, each clamped to {@link MAX_NOTE_LEN}, at most {@link MAX_NOTES}. */
function sanitizeNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is string => typeof n === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => (s.length > MAX_NOTE_LEN ? s.slice(0, MAX_NOTE_LEN) : s))
    .slice(0, MAX_NOTES);
}

/** `releases` entries with a short version token and at least one note, at most {@link MAX_RELEASES}. */
function sanitizeReleases(raw: unknown): ReleaseNotes[] {
  if (!Array.isArray(raw)) return [];
  const out: ReleaseNotes[] = [];
  for (const r of raw) {
    if (out.length >= MAX_RELEASES) break;
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const version = token(o.version);
    const notes = sanitizeNotes(o.notes);
    if (version && notes.length > 0) out.push({ version, notes });
  }
  return out;
}

/**
 * Sanitize a parsed `version.json` payload into an {@link UpdateInfo}, or `null`
 * if it isn't an object. Keeps only string notes — trimmed, non-empty, each
 * length-capped to {@link MAX_NOTE_LEN} and the list capped to {@link MAX_NOTES} —
 * and type-guards `version`/`sha` to strings (anything else becomes `undefined`).
 */
export function parseUpdateInfo(j: unknown): UpdateInfo | null {
  if (typeof j !== "object" || j === null) return null;
  const o = j as Record<string, unknown>;
  return {
    version: typeof o.version === "string" ? o.version : undefined,
    sha: typeof o.sha === "string" ? o.sha : undefined,
    notes: sanitizeNotes(o.notes),
    releases: sanitizeReleases(o.releases),
    fingerprint: parseFingerprint(o.shell, o.engine),
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

/** A plain `major.minor.patch` version as three numbers, or `null` for anything else ("dev", a prerelease). */
function versionParts(v: string | undefined): [number, number, number] | null {
  const m = v === undefined ? null : /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether version `a` is newer than version `b`; `false` when either is not a plain version. */
export function isNewerVersion(a: string | undefined, b: string | undefined): boolean {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

/** Sort order for releases: the newer version first. */
function newestFirst(a: ReleaseNotes, b: ReleaseNotes): number {
  if (isNewerVersion(a.version, b.version)) return -1;
  return isNewerVersion(b.version, a.version) ? 1 : 0;
}

/** localStorage key: the newest version whose notes the update prompt has
 *  shown, so a later prompt never repeats them (#1897). */
export const NOTES_SEEN_KEY = "vc-notes-seen-version";

/** The version whose notes the player last saw in the update prompt, or `undefined` (none yet, or no storage). */
export function readNotesSeen(): string | undefined {
  try {
    const v = localStorage.getItem(NOTES_SEEN_KEY) ?? undefined;
    return versionParts(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Record that the prompt showed the notes up to `version`; a version older than the one recorded is ignored. */
export function rememberNotesSeen(version: string | undefined): void {
  if (!versionParts(version)) return;
  try {
    const seen = localStorage.getItem(NOTES_SEEN_KEY) ?? undefined;
    if (!isNewerVersion(seen, version)) localStorage.setItem(NOTES_SEEN_KEY, version!);
  } catch {
    /* private mode or full storage: the next prompt may repeat notes, nothing else */
  }
}

/**
 * `info` as the prompt should show it (#1897): only the notes of versions the
 * player has not seen, so nothing is shown twice. The floor is the running
 * version, or `seenVersion` (the newest version an earlier prompt showed, see
 * {@link rememberNotesSeen}) when that is newer. `releases` keeps the versions
 * newer than the floor and no newer than the incoming one, newest first, and
 * `since` names the floor for the prompt's heading. When the incoming build's
 * own notes are not among them (a payload without `releases`), they lead as
 * the incoming entry, so an older server still shows what it showed before.
 * `more` says the player skipped more versions than the payload carries.
 *
 * An incoming version at or below the floor (a same-version rebuild, which
 * carries the notes of the version the player is already on, or a build whose
 * notes an earlier prompt already showed) shows no notes, only the build-id
 * line. When either version is not a plain version (a dev build), only the
 * incoming build's own notes are shown.
 */
export function notesSinceRunning(info: UpdateInfo, runningVersion: string, seenVersion?: string): UpdateInfo {
  const none = { ...info, notes: [], releases: [] };
  if (info.version === runningVersion) return none;
  const notes = info.notes ?? [];
  if (!versionParts(runningVersion) || !versionParts(info.version)) {
    return { ...info, releases: info.version && notes.length > 0 ? [{ version: info.version, notes }] : [] };
  }
  const floor = isNewerVersion(seenVersion, runningVersion) ? seenVersion! : runningVersion;
  if (!isNewerVersion(info.version, floor)) return none;
  const carried = info.releases ?? [];
  const unseen = carried.filter((r) => isNewerVersion(r.version, floor) && !isNewerVersion(r.version, info.version));
  const releases = unseen.some((r) => r.version === info.version) ? unseen : [{ version: info.version!, notes }, ...unseen];
  const shown = releases
    .filter((r) => r.notes.length > 0)
    .sort(newestFirst)
    .slice(0, MAX_RELEASES);
  const more = carried.length >= MAX_RELEASES && carried.every((r) => isNewerVersion(r.version, floor));
  return { ...info, notes, releases: shown, since: floor, ...(more ? { more } : {}) };
}

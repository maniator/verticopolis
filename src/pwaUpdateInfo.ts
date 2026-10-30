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
 * source file outside the engines, hashed at build time) and the engines (the
 * Rust crate version and package source hash, and the TypeScript engine's
 * source hash). A running client compares its own fingerprint with the
 * incoming build's to say whether an update touches the game, the engine or
 * both. Any part may be absent (a dev build, or a package that did not report).
 */
export interface BuildFingerprint {
  shell: string;
  engine: { crate?: string; rust?: string; ts?: string };
}

/** Which part of the game an update changes. */
export type UpdateKind = "game" | "engine" | "both";

export interface UpdateInfo {
  /** The incoming build's `package.json` version, e.g. "2.3.4". */
  version?: string;
  /** Short git SHA of the incoming build, e.g. "a1b2c3d". */
  sha?: string;
  /** Player-facing "what's new" lines (empty until the trailer harvest ships). */
  notes?: string[];
  /** The incoming build's parts (see {@link BuildFingerprint}). */
  fingerprint?: BuildFingerprint;
  /** What this update changes, set by {@link withUpdateKind} from the two fingerprints. */
  kind?: UpdateKind;
  /** A one-line engine summary, such as "Rust engine 0.24.0 → 0.25.0", set with `kind` when an engine changed. */
  engineLine?: string;
}

/** A fingerprint field is a short token (a version or a hex digest). */
const MAX_FINGERPRINT_LEN = 64;
const token = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_FINGERPRINT_LEN ? v : undefined;

function parseFingerprint(shell: unknown, engine: unknown): BuildFingerprint | undefined {
  const s = token(shell);
  if (!s || typeof engine !== "object" || engine === null) return undefined;
  const e = engine as Record<string, unknown>;
  return { shell: s, engine: { crate: token(e.crate), rust: token(e.rust), ts: token(e.ts) } };
}

const differs = (a: string | undefined, b: string | undefined): boolean => a !== undefined && b !== undefined && a !== b;

/**
 * Whether the incoming build changes the game shell, an engine, both or neither
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
  const ts = differs(a.ts, b.ts);
  if (!game && !rust && !ts) return null;
  const lines: string[] = [];
  if (crate) lines.push(`Rust engine ${a.crate} → ${b.crate}`);
  else if (rust) lines.push(`Rust engine${b.crate ? ` ${b.crate}` : ""} (new build)`);
  if (ts) lines.push("TypeScript engine (new build)");
  const engine = rust || ts;
  let kind: UpdateKind = "game";
  if (engine) kind = game ? "both" : "engine";
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

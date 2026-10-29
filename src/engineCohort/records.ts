/**
 * The cohort's records in `localStorage` (#1197). Each is a small versioned
 * JSON value, read and written inside `try`/`catch`, so a private window, a
 * full quota or blocked storage never takes boot down: the policy reads a
 * failure as "no usable storage" and keeps the browser on TypeScript.
 *
 * - `vc.engineCohort`: the bucket (0 to 99, drawn once) and the enrollment
 *   last applied (`stage`, `arm`, `sha`), so a stage change is seen once.
 * - `vc.engineSafety`: a latched safety suppression after a real Rust failure.
 * - `vc.engineBoot`: the crash-loop marker, one entry per page life that
 *   requested Rust, with a heartbeat while it is visible. An entry whose
 *   heartbeat went stale belongs to a page life that died while visible.
 *
 * The player's own choice stays in `vc.engine` (`engineChoice.ts`), which only
 * the Settings choice writes (`setPreference`).
 *
 * A record from a newer build (a `v` above `RECORD_VERSION`) is read for the
 * fields this build knows and never rewritten or removed by this build
 * (#1289 item 2): the cohort keeps its bucket, and a safety record keeps the
 * device on TypeScript as a fault until the player retries.
 */

/** The version this build writes. */
export const RECORD_VERSION = 1;

/** Whether a record was written by a newer build. */
export const fromNewerBuild = (r: { v: number }): boolean => r.v > RECORD_VERSION;

/** Whether `a` is a later app version than `b` (`major.minor.patch`); false
 *  when either does not parse. */
export function versionAfter(a: string, b: string): boolean {
  const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);
  const [x, y] = [parse(a), parse(b)];
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

export const COHORT_KEY = "vc.engineCohort";
export const SAFETY_KEY = "vc.engineSafety";
export const BOOT_MARKER_KEY = "vc.engineBoot";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type Arm = "wasm" | "ts";

/** The enrollment a boot applied; `version` is the app version that applied
 *  it, absent on records from before this field. */
export interface Enrollment {
  stage: number;
  arm: Arm;
  sha: string;
  version?: string;
}

export interface CohortRecord {
  v: number;
  bucket: number;
  /** The enrollment the last boot applied, absent before the first. */
  applied?: Enrollment;
  /** When the bucket was drawn again because the stored record did not parse
   *  (packet note A): kept locally, never sent. */
  redrawn?: number;
}

/** `fault`: Rust itself failed, kept until the player retries. `build`: the
 *  package did not load (a slow network, the deploy race), kept for this
 *  build only. */
export type SafetyScope = "fault" | "build";

export interface SafetyRecord {
  v: number;
  scope: SafetyScope;
  /** The fallback code that latched it (`FALLBACK_REASONS`, or `unclean-exit`). */
  reason: string;
  /** Where it failed (`FALLBACK_STAGES`, or `crash-loop`); decides the scope. */
  stage: string;
  /** The app build (`__APP_SHA__`) it latched on. */
  sha: string;
  /** The engine source hash (#963), when the binary reported one. */
  engine?: string;
  at: number;
}

/** One page life that requested Rust and has not exited cleanly. */
export interface MarkerEntry {
  /** A random key for the page life, so windows never touch each other's. */
  id: string;
  /** The app build (`__APP_SHA__`) it booted. */
  sha: string;
  /** When it last showed it was alive (epoch ms). */
  beat: number;
}

export interface BootMarker {
  v: 1;
  entries: MarkerEntry[];
}

/** A read that may fail: `missing` (no value), `corrupt` (a value that does not
 *  parse as the expected record), or `unavailable` (storage threw). */
export type Read<T> = { ok: true; value: T } | { ok: false; why: "missing" | "corrupt" | "unavailable" };

function readJson<T>(store: KeyValueStore | null, key: string, valid: (v: unknown) => v is T): Read<T> {
  if (!store) return { ok: false, why: "unavailable" };
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return { ok: false, why: "unavailable" };
  }
  if (raw === null) return { ok: false, why: "missing" };
  try {
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? { ok: true, value: parsed } : { ok: false, why: "corrupt" };
  } catch {
    return { ok: false, why: "corrupt" };
  }
}

/** Write a value and read it back. False when storage threw or did not keep it. */
export function writeChecked(store: KeyValueStore | null, key: string, value: unknown): boolean {
  if (!store) return false;
  const text = JSON.stringify(value);
  try {
    store.setItem(key, text);
    return store.getItem(key) === text;
  } catch {
    return false;
  }
}

export function remove(store: KeyValueStore | null, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // Nothing to do: the next read reports what storage holds.
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isArm = (v: unknown): v is Arm => v === "wasm" || v === "ts";

export function isBucket(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 99;
}

/** A version this build can read: its own or a newer build's. */
const readableVersion = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= RECORD_VERSION;

function isCohort(v: unknown): v is CohortRecord {
  return isObject(v) && readableVersion(v.v) && isBucket(v.bucket);
}

const isApplied = (a: unknown): a is Enrollment => isObject(a) && typeof a.stage === "number" && isArm(a.arm) && typeof a.sha === "string" && (a.version === undefined || typeof a.version === "string");

function isSafety(v: unknown): v is SafetyRecord {
  return (
    isObject(v) &&
    v.v === RECORD_VERSION &&
    (v.scope === "fault" || v.scope === "build") &&
    typeof v.reason === "string" &&
    typeof v.stage === "string" &&
    typeof v.sha === "string" &&
    (v.engine === undefined || typeof v.engine === "string") &&
    typeof v.at === "number"
  );
}

const isEntry = (v: unknown): v is MarkerEntry => isObject(v) && typeof v.id === "string" && typeof v.sha === "string" && typeof v.beat === "number";

function isMarker(v: unknown): v is BootMarker {
  return isObject(v) && v.v === 1 && Array.isArray(v.entries) && v.entries.every(isEntry);
}

/** The cohort record. A valid bucket is kept even when the enrollment beside
 *  it does not parse, so the randomized arm is never redrawn for that. */
export function readCohort(store: KeyValueStore | null): Read<CohortRecord> {
  const r = readJson(store, COHORT_KEY, isCohort);
  if (!r.ok || r.value.applied === undefined || isApplied(r.value.applied)) return r;
  return { ok: true, value: { v: r.value.v, bucket: r.value.bucket } };
}
/** The safety record. A newer build's record is read as a fault with the
 *  fields this build knows, whatever else it holds. */
export function readSafety(store: KeyValueStore | null): Read<SafetyRecord> {
  const newer = readJson(store, SAFETY_KEY, (v): v is Record<string, unknown> & { v: number } => isObject(v) && readableVersion(v.v) && v.v > RECORD_VERSION);
  if (!newer.ok) return readJson(store, SAFETY_KEY, isSafety);
  const r = newer.value;
  const text = (x: unknown, or: string) => (typeof x === "string" ? x : or);
  return { ok: true, value: { v: r.v, scope: "fault", reason: text(r.reason, "corrupt"), stage: text(r.stage, "none"), sha: text(r.sha, ""), at: typeof r.at === "number" ? r.at : 0 } };
}
export const readMarker = (store: KeyValueStore | null): Read<BootMarker> => readJson(store, BOOT_MARKER_KEY, isMarker);

/** The browser's `localStorage`, or null where reading the property throws. */
export function browserStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

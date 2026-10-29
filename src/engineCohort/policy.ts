import type { BootStage, FallbackStage } from "../wasmhost/engineBoot";
import type { EngineChoice } from "../wasmhost/engineChoice";
import { ENGINE_STORAGE_KEY } from "../wasmhost/engineChoice";
import type { CohortStage } from "./config";
import { clearMarker, crashLoopFound } from "./crashMarker";
import {
  COHORT_KEY,
  SAFETY_KEY,
  readCohort,
  readSafety,
  remove,
  writeChecked,
  type Arm,
  type KeyValueStore,
  type SafetyRecord,
  type SafetyScope,
} from "./records";

/**
 * The engine selection policy (#1197, `spec-wasm-staged-cohort.md`). Boot asks
 * it once, before the engine package loads, which engine to start. In order,
 * the first rule that applies decides:
 *
 * 1. the draw is off (tooling and wasm-only builds): today's behavior, the
 *    URL or the stored choice;
 * 2. `?engine=` in the URL, for this visit only;
 * 3. a latched safety suppression: TypeScript;
 * 4. the player's Settings choice;
 * 5. Automatic: the cohort arm, WASM when the bucket is below the stage's share;
 * 6. Automatic with no usable storage: TypeScript.
 *
 * The bucket is drawn once and the arm it gives is reported whatever rule
 * decided, so the randomized assignment survives every override. A safety
 * suppression is separate from the bucket: once Rust has really failed on this
 * device, later boots stay on TypeScript until the player retries, so a
 * player never goes WASM, then TypeScript on a fault, then WASM on reload.
 */

/** Which rule chose the engine (the proposed `selected_by` field). */
export const SELECTIONS = ["default", "cohort", "setting", "url", "safety"] as const;
export type SelectedBy = (typeof SELECTIONS)[number];

/** The randomized arm for this build's stage (the proposed `assigned_arm`):
 *  `unassigned` when storage cannot keep a bucket, `none` when the draw is off. */
export const ASSIGNED_ARMS = ["none", "wasm", "ts", "unassigned"] as const;
export type AssignedArm = (typeof ASSIGNED_ARMS)[number];

/** What the player picked in Settings: Automatic, or a stored engine. */
export type Preference = "auto" | EngineChoice;

/** A stage change seen at this boot: the Automatic arm moved into WASM
 *  (`enrolled`) or back (`withdrawn`). */
export type Transition = "none" | "enrolled" | "withdrawn";

export interface SelectionEnv {
  store: KeyValueStore | null;
  /** The raw `?engine=` value, or null. */
  url: string | null;
  /** Whether the cohort runs in this build. */
  drawOn: boolean;
  stage: CohortStage;
  /** The WASM arm's share at `stage`, 0 to 100. */
  share: number;
  /** This build's commit (`__APP_SHA__`). */
  sha: string;
  /** A random key for this page life (its crash-marker entry). */
  pageId: string;
  now: number;
  /** A uniform draw in [0, 1). */
  random: () => number;
  /** Whether the sticky safety path runs: the suppression and the crash
   *  marker. Off until the cohort's fields ship (`COHORT_TELEMETRY`), so a
   *  boot never moves to TypeScript where the reliability data could not say
   *  why; a stored Rust choice then boots Rust as it always has. */
  safetyOn: boolean;
  /** Rust boots only when the visit's URL asks for it (`?engine=wasm`): the
   *  Settings choice and the cohort's draw both get TypeScript. On while a trap
   *  stops the game instead of handing it to TypeScript (#1422). */
  rustOnlyByChoice: boolean;
}

export interface Selection {
  /** The engine boot loads. */
  boot: EngineChoice;
  /** The engine the rules chose before a safety suppression. */
  requested: EngineChoice;
  selectedBy: SelectedBy;
  assignedArm: AssignedArm;
  stage: CohortStage;
  preference: Preference;
  /** The suppression that put this boot on TypeScript, if any. */
  suppression: SafetyRecord | null;
  /** True when this boot found a crash loop and latched it. */
  crashLoop: boolean;
  transition: Transition;
  /** The stage change to tell the player about: only for an Automatic choice
   *  the cohort decided, so the engine this boot runs is the one that changed. */
  notice: Transition;
  /** Set when this page life added a crash-marker entry, which it must keep
   *  alive while visible and remove on a clean exit (`watchSurvival`). */
  markerId: string | null;
  /** Rust was wanted, but storage would not keep this page life's crash
   *  marker, so the boot runs TypeScript (a crash could not be counted). */
  markerBlocked?: true;
  /** An old measurement host was asked for, while only a choice or the
   *  cohort's draw boots Rust (`rustOnlyByChoice`), so the boot runs
   *  TypeScript. */
  heldForChoice?: true;
  /** Rust was chosen, but this tab's Rust engine crashed `CRASH_LOOP_PAGES`
   *  times on this build (`crashReload.ts`), so the boot runs TypeScript. */
  heldAfterCrashes?: true;
}

const CHOICES: readonly string[] = ["ts", "wasm", "wasm-frame", "wasm-worker"];
const isChoice = (v: string | null | undefined): v is EngineChoice => v != null && CHOICES.includes(v);

/** Where a latched failure happened: a boot or fallback stage, or the
 *  crash-loop check. */
export type SafetyStage = BootStage | FallbackStage | "crash-loop";

/** The scope follows the stage, since one code can come from either cause: a
 *  failure while the package loads (a timeout, a mismatch, a fetch that failed
 *  or could not be checked) is the network or a deploy and lasts for this build;
 *  anything once the engine runs is the engine itself and lasts until a retry. */
export function safetyScope(stage: SafetyStage): SafetyScope {
  return stage === "load" ? "build" : "fault";
}

/** Whether a stored suppression applies to this build: a fault always does, a
 *  build-scoped one only on the build it latched on. */
export function suppressionApplies(r: SafetyRecord, sha: string): boolean {
  return r.scope === "fault" || r.sha === sha;
}

export function readPreference(store: KeyValueStore | null): Preference {
  try {
    const v = store?.getItem(ENGINE_STORAGE_KEY);
    return isChoice(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

/** The suppression that applies to this build, clearing one that has expired.
 *  A record that does not parse counts as a fault suppression (fail safe), and
 *  is rewritten as one, so Settings shows it and its retry can clear it. */
function activeSuppression(store: KeyValueStore | null, sha: string, now: number): SafetyRecord | null {
  const r = readSafety(store);
  if (r.ok) {
    if (suppressionApplies(r.value, sha)) return r.value;
    remove(store, SAFETY_KEY);
    return null;
  }
  if (r.why === "corrupt") {
    const record: SafetyRecord = { v: 1, scope: "fault", reason: "corrupt", stage: "none", sha, at: now };
    writeChecked(store, SAFETY_KEY, record);
    return record;
  }
  return null;
}

/** The bucket, drawn and stored on first use, or null when storage cannot keep it. */
function bucketOf(env: SelectionEnv): { bucket: number; applied?: { stage: number; arm: Arm; sha: string } } | null {
  const r = readCohort(env.store);
  if (r.ok) return r.value;
  if (r.why === "unavailable") return null;
  const bucket = Math.min(99, Math.floor(env.random() * 100));
  return writeChecked(env.store, COHORT_KEY, { v: 1, bucket }) ? { bucket } : null;
}

/** Record this build's enrollment and report a change from the last one. A
 *  change storage did not keep is not reported, so the notice cannot repeat
 *  on every boot. */
function applyEnrollment(env: SelectionEnv, bucket: number, applied: { stage: number; arm: Arm; sha: string } | undefined, arm: Arm): Transition {
  const now = { stage: env.stage, arm, sha: env.sha };
  if (applied && applied.stage === now.stage && applied.arm === now.arm && applied.sha === now.sha) return "none";
  const kept = writeChecked(env.store, COHORT_KEY, { v: 1, bucket, applied: now });
  if (!kept || !applied || applied.arm === arm) return "none";
  return arm === "wasm" ? "enrolled" : "withdrawn";
}

/** The arm a bucket falls in at a share: WASM below it. */
export function armOf(bucket: number, share: number): Arm {
  return bucket < share ? "wasm" : "ts";
}

/** The player picked the Rust engine itself in Settings. That choice runs
 *  the crash marker and the sticky suppression even before the cohort's
 *  fields ship (owner, 2026-10-28), so a Rust tab that dies hard on load
 *  stops booting Rust, and Settings says why and offers the retry. */
export function playerChoseRust(s: Pick<Selection, "selectedBy" | "requested">): boolean {
  return s.selectedBy === "setting" && s.requested === "wasm";
}

/** Choose the engine for this boot. Reads and writes the cohort's records;
 *  never throws. */
export function selectEngine(env: SelectionEnv): Selection {
  // While only a choice or the draw boots Rust (`rustOnlyByChoice`):
  // `?engine=wasm` and the Settings choice of the Rust engine run it (owner,
  // 2026-10-28, once the crash reload shipped), the cohort's WASM arm runs it
  // from stage 1, and the old measurement hosts (`wasm-frame`, `wasm-worker`)
  // run TypeScript.
  const url = isChoice(env.url) ? env.url : null;
  const preference = readPreference(env.store);
  const base = { stage: env.stage, preference, suppression: null, crashLoop: false, transition: "none" as Transition, notice: "none" as Transition, markerId: null };
  const stored: EngineChoice | null = preference === "auto" ? null : preference;
  if (!env.drawOn) {
    // Today's behavior, reported as the default rule whatever picked it.
    const chosen = url ?? stored ?? "ts";
    if (chosen !== "ts" && chosen !== "wasm" && env.rustOnlyByChoice) return { ...base, boot: "ts", requested: chosen, selectedBy: "default", assignedArm: "none", heldForChoice: true };
    return { ...base, boot: chosen, requested: chosen, selectedBy: "default", assignedArm: "none" };
  }
  const drawn = bucketOf(env);
  const arm = drawn ? armOf(drawn.bucket, env.share) : null;
  const assignedArm: AssignedArm = arm ?? "unassigned";
  // A test visit leaves the enrollment alone, so the next ordinary boot still
  // sees a stage change and tells the player.
  if (url) {
    if (url !== "ts" && url !== "wasm" && env.rustOnlyByChoice) return { ...base, assignedArm, boot: "ts", requested: url, selectedBy: "url", heldForChoice: true };
    return { ...base, assignedArm, boot: url, requested: url, selectedBy: "url" };
  }
  const transition = drawn && arm ? applyEnrollment(env, drawn.bucket, drawn.applied, arm) : "none";
  const common = { ...base, assignedArm, transition };

  const requested: EngineChoice = stored ?? (arm === "wasm" ? "wasm" : "ts");
  let selectedBy: SelectedBy = "default";
  if (stored) selectedBy = "setting";
  else if (arm) selectedBy = "cohort";
  const notice = selectedBy === "cohort" ? transition : "none";
  if (requested === "ts") {
    // A TypeScript choice needs no suppression and reports its own rule. A
    // browser a suppression already kept on TypeScript sees no withdrawal
    // notice, since its engine did not change.
    const quiet = notice === "none" || (env.safetyOn && activeSuppression(env.store, env.sha, env.now) !== null);
    return { ...common, boot: "ts", requested, selectedBy, notice: quiet ? "none" : notice };
  }
  // Held on TypeScript, so the engine did not change and no notice is due.
  const ownChoice = playerChoseRust({ selectedBy, requested });
  const drawnRust = selectedBy === "cohort";
  if (env.rustOnlyByChoice && !ownChoice && !drawnRust) return { ...common, boot: "ts", requested, selectedBy, heldForChoice: true };
  if (!env.safetyOn && !ownChoice) return { ...common, boot: requested, requested, selectedBy, notice };
  const suppression = activeSuppression(env.store, env.sha, env.now);
  if (suppression) return { ...common, boot: "ts", requested, selectedBy: "safety", suppression };
  const marker = crashLoopFound(env.store, { id: env.pageId, sha: env.sha }, env.now);
  if (marker === "loop") {
    const latched = latchSafety(env.store, { reason: "unclean-exit", stage: "crash-loop", sha: env.sha, now: env.now });
    return { ...common, boot: "ts", requested, selectedBy: "safety", suppression: latched, crashLoop: true };
  }
  // Without a marker a crash could not be counted, so Rust is not started.
  if (marker === "unwritable") return { ...common, boot: "ts", requested, selectedBy, markerBlocked: true };
  return { ...common, boot: requested, requested, selectedBy, notice, markerId: env.pageId };
}

/** Latch a safety suppression after a real Rust failure on this device:
 *  a fault (kept until the player retries) or, for a package that did not
 *  load, this build only. A fault already latched stays, with its first
 *  reason, so a later build-scoped failure never shortens it. Returns the
 *  record in force, written or not. */
export function latchSafety(store: KeyValueStore | null, f: { reason: string; stage: SafetyStage; sha: string; engine?: string; now: number }): SafetyRecord {
  const held = readSafety(store);
  if (held.ok && held.value.scope === "fault") return held.value;
  const record: SafetyRecord = { v: 1, scope: safetyScope(f.stage), reason: f.reason, stage: f.stage, sha: f.sha, ...(f.engine ? { engine: f.engine } : {}), at: f.now };
  writeChecked(store, SAFETY_KEY, record);
  return record;
}

/** The player's "Try the Rust engine again": forget the suppression and the
 *  crash marker. Takes effect at the next start. */
export function clearSafety(store: KeyValueStore | null): void {
  remove(store, SAFETY_KEY);
  clearMarker(store);
}

/** Store the player's Settings choice; `auto` removes it. False when storage
 *  did not keep it. */
export function setPreference(store: KeyValueStore | null, p: Preference): boolean {
  if (p === "auto") {
    remove(store, ENGINE_STORAGE_KEY);
    return readPreference(store) === "auto";
  }
  try {
    store?.setItem(ENGINE_STORAGE_KEY, p);
    return store?.getItem(ENGINE_STORAGE_KEY) === p;
  } catch {
    return false;
  }
}

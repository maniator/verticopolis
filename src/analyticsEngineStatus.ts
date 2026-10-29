import { trackEvent, type GameplayEvents } from "./analyticsCore";
import { APP_VERSION } from "./appVersion";
import type { EngagedBy } from "./analyticsEngagement";
import { COHORT_TELEMETRY } from "./engineCohort/config";
import { cohortFields, type CohortFields } from "./engineCohort/fields";
import { FALLBACK_REASONS, type BootStage, type FallbackReason, type FallbackStage } from "./wasmhost/engineBoot";
import type { EngineChoice } from "./wasmhost/engineChoice";

/**
 * The reliability instrument (release plan 4.1, step A1; issue #1081): one
 * `engine_status` row per page life saying which engine runs, whether it fell
 * back and why, and whether the engine save writer turned itself off. The
 * Reliability row of #945 counts these rows through the governed definition in
 * `scripts/engine-reliability.mjs`; what each field means, why it is collected
 * and how long it is kept is in `docs/analytics-data-map.md`.
 *
 * Every value is a code from a closed list in our code. No row carries an error
 * message, a stack, a tower name or a path: an engine message can quote a
 * tower name, and a hand-edited save controls it. The messages stay on the
 * console and on `window.__vcEngineBoot`; this module is never handed one
 * (`EngineSettle.failure` takes the stage and the code only). A boot that
 * throws still reaches `$exception`, as any uncaught error does.
 *
 * When rows go out:
 * - `settle`, once per page life, after boot has picked its engine and the
 *   first tower is hosted or refused. A fallback before this point is in the
 *   boot state the settle row reads, so it is not sent on its own.
 * - `fallback`, on each later fallback (a tower the host refused at a load, a
 *   new game or an undo restore, or a running engine's fault, #874).
 * - `crash-reload`, when a running Rust engine traps and the page reloads
 *   from its last autosave (#1422). It names the engine that crashed: the
 *   reload, a new page life with its own settle row, says what runs next.
 * - `writer-latch`, when the engine save writer turns itself off.
 * - `summary`, at a hide, only when the cap below dropped a row since the last
 *   row went out, so the count it carries is the true one. It is outside the
 *   cap: at most one per hide, and only after a drop.
 *
 * The cap drops repeats only. The first row of a reason this page life has not
 * sent yet, and the latch-off row, always go out, so every reason reaches the
 * by-reason count and a page life sends at most the cap plus one row per code.
 *
 * The #841 lesson: a capped stream must not lose the size of a loop. Every row
 * carries `fallbacks`, the running count for this page life, and a page life
 * whose rows were capped reports its count at the next hide. A loop across
 * reloads is a new page life each time, with its own settle row, so the cap
 * never hides it.
 */

/** What the page life runs when a row is sent. `ts-fallback` is a switchable
 *  build back on TypeScript after asking for the engine; `none` is a wasm-only
 *  build that stopped, since it has no other engine. */
export const ENGINE_KINDS = ["ts", "wasm", "wasm-frame", "wasm-worker", "ts-fallback", "none"] as const;
export type EngineKind = (typeof ENGINE_KINDS)[number];

/** Why a row was sent; see the module comment. */
export const ENGINE_STATUS_TRIGGERS = ["attempt", "settle", "fallback", "crash-reload", "writer-latch", "summary", "engaged"] as const;
export type EngineStatusTrigger = (typeof ENGINE_STATUS_TRIGGERS)[number];

/** The bundle kind (see `src/build/engineBundle.ts`). */
export const ENGINE_BUILDS = ["switchable", "wasm-only"] as const;
export type EngineBuild = (typeof ENGINE_BUILDS)[number];

/** Every field an `engine_status` row carries, in the order the data map lists
 *  them. Checked against the event's type below, so the map's guard test reads
 *  the real field set. */
export const ENGINE_STATUS_FIELDS = [
  "trigger",
  "engine_requested",
  "engine",
  "build",
  "fallback_reason",
  "fallback_stage",
  "fallbacks",
  "writer_latched",
  "page_life",
  "version",
  "sha",
  "stage",
  "assigned_arm",
  "selected_by",
  "engaged_by",
  "size_gated",
] as const satisfies readonly (keyof GameplayEvents["engine_status"])[];
type MissingField = Exclude<keyof GameplayEvents["engine_status"], (typeof ENGINE_STATUS_FIELDS)[number]>;
const everyField: [MissingField] extends [never] ? true : MissingField = true;
void everyField;

/** Rows past `settle` one page life may send before repeats are dropped. A
 *  real fallback is human-paced (a load, a new game, an undo), but a runtime
 *  trap can repeat, and a flood would spend the ingest route's per-IP budget
 *  and lose the session's other events (the reason `crash` is capped). The
 *  count survives the cap through the `summary` row. */
export const MAX_ENGINE_STATUS_ROWS = 10;

/** `fallback_reason`'s codes: the fallbacks', `unclean-exit`, which only the
 *  crash-loop check raises, on the settle row of the boot that found it, and
 *  `marker-blocked`, on the settle row of a boot that kept a Rust request on
 *  TypeScript because it could not write its crash marker. */
export const ENGINE_STATUS_REASONS = [...FALLBACK_REASONS, "unclean-exit", "marker-blocked"] as const;
export type EngineStatusReason = (typeof ENGINE_STATUS_REASONS)[number];

/** What boot settled on, from its published state (`window.__vcEngineBoot`). */
export interface EngineSettle {
  build: EngineBuild;
  /** The engine the policy asked for, before any suppression or hold. */
  requested: EngineChoice;
  /** The engine boot started, when it differs from `requested`. */
  boot?: EngineChoice;
  failure: { stage: BootStage; reason: FallbackReason } | null;
  /** The cohort's fields for this page life. */
  cohort?: CohortFields;
  /** The boot found a crash loop and runs TypeScript (`unclean-exit`). */
  crashLoop?: boolean;
  /** The boot could not write its crash marker and runs TypeScript (`marker-blocked`). */
  markerBlocked?: boolean;
  /** The size gate held this page life's tower on TypeScript (#1197). */
  sizeGated?: boolean;
}

/** The boot stage of a failure, as analytics names it. A failure the settle
 *  row reads is at the load or the first tower. `host` (a later tower a
 *  wasm-only build lost) never reaches it, since the host reports that one
 *  itself, with `adopt` or `undo`; it is mapped only so the table is total. */
const STAGE_OF_BOOT: Record<BootStage, FallbackStage> = { load: "load", start: "start", host: "adopt" };

/** The engine a page life runs. */
export function engineKind(build: EngineBuild, requested: EngineChoice, failed: boolean): EngineKind {
  if (failed) return build === "wasm-only" ? "none" : "ts-fallback";
  return requested;
}

interface Status {
  build: EngineBuild;
  requested: EngineChoice;
  engine: EngineKind;
  reason: EngineStatusReason;
  stage: FallbackStage;
  fallbacks: number;
  cohort?: CohortFields;
  sizeGated?: true;
}

let status: Status | null = null;
/** A latch-off before boot settled; the settle row carries it. */
let writerLatched = false;
let rowsSent = 0;
/** The fallback reasons a row has carried this page life. */
const reasonsSent = new Set<EngineStatusReason>();
/** A row the cap dropped since the last row went out. */
let dropped = false;
let pageLife: string | undefined;
let attemptSent = false;
let engagedSent = false;

/** The page-life id: minted at the page life's first row, held in memory
 *  only, so a reload starts a new one while the relay's session id carries
 *  over. */
function pageLifeId(): string {
  if (pageLife !== undefined) return pageLife;
  try {
    pageLife = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : fallbackId();
  } catch {
    pageLife = fallbackId();
  }
  return pageLife;
}

function fallbackId(): string {
  return `p-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function send(s: Status, trigger: EngineStatusTrigger, engagedBy?: EngagedBy): void {
  trackEvent("engine_status", {
    ...(cohortRows.on ? (s.cohort ?? cohortFields(null)) : {}),
    ...(engagedBy ? { engaged_by: engagedBy } : {}),
    ...(s.sizeGated ? { size_gated: true } : {}),
    trigger,
    engine_requested: s.requested,
    engine: s.engine,
    build: s.build,
    fallback_reason: s.reason,
    fallback_stage: s.stage,
    fallbacks: s.fallbacks,
    writer_latched: writerLatched,
    page_life: pageLifeId(),
    version: APP_VERSION,
    sha: __APP_SHA__,
  });
}

/** Send a row after `settle`. Past the cap a repeat is dropped and
 *  remembered, so the next hide reports the count; a row that says something
 *  new (`novel`) still goes out. */
function sendCapped(s: Status, trigger: EngineStatusTrigger, novel: boolean): void {
  if (rowsSent >= MAX_ENGINE_STATUS_ROWS && !novel) {
    dropped = true;
    return;
  }
  rowsSent++;
  dropped = false;
  reasonsSent.add(s.reason);
  send(s, trigger);
}

/** Whether the cohort's rows (`attempt`, `engaged`) go out: with the
 *  cohort's fields, which the owner approved on 2026-10-29 and the fields PR
 *  switches on. Exported for the tests. */
export const cohortRows = { on: COHORT_TELEMETRY };

/** Boot has chosen the engine and the package has not loaded yet: send the
 *  page life's `attempt` row (#1090), so a tab that closes or crashes during
 *  the load is still counted. Once per page life, outside the cap. */
export function noteEngineAttempt(attempt: { build: EngineBuild; requested: EngineChoice; boot?: EngineChoice; cohort?: CohortFields; sizeGated?: boolean }): void {
  if (!cohortRows.on || attemptSent) return;
  attemptSent = true;
  const { build, requested, cohort } = attempt;
  send({ build, requested, engine: engineKind(build, attempt.boot ?? requested, false), reason: "none", stage: "none", fallbacks: 0, cohort, ...(attempt.sizeGated ? { sizeGated: true as const } : {}) }, "attempt");
}

/** The page life engaged (`analyticsEngagement.ts`): send its `engaged` row,
 *  with the engine running at that moment. Once per page life, outside the
 *  cap; before `settle` there is no engine to name, so it is ignored. */
export function noteEngineEngaged(by: EngagedBy): void {
  if (!cohortRows.on || !status || engagedSent) return;
  engagedSent = true;
  send(status, "engaged", by);
}

/** Why a boot without a failure did not start what it asked for, if it did not. */
function settleReason(settle: EngineSettle): EngineStatusReason {
  if (settle.crashLoop) return "unclean-exit";
  return settle.markerBlocked ? "marker-blocked" : "none";
}

/** Boot has picked its engine: send the page life's `settle` row. Once per
 *  page life; a second call is ignored. */
export function noteEngineSettled(settle: EngineSettle): void {
  if (status) return;
  const failed = settle.failure !== null;
  status = {
    build: settle.build,
    requested: settle.requested,
    engine: engineKind(settle.build, settle.boot ?? settle.requested, failed),
    reason: settle.failure?.reason ?? settleReason(settle),
    stage: settle.failure ? STAGE_OF_BOOT[settle.failure.stage] : "none",
    fallbacks: failed ? 1 : 0,
    cohort: settle.cohort,
    ...(settle.sizeGated ? { sizeGated: true as const } : {}),
  };
  reasonsSent.add(status.reason);
  send(status, "settle");
}

/** A fallback after boot settled: a tower the host would not take, or a
 *  running engine's fault (#874). Before `settle` it is ignored, because the
 *  boot state the settle row reads already holds it. */
export function noteEngineFallback(fallback: { reason: FallbackReason; stage: FallbackStage }): void {
  if (!status) return;
  status.fallbacks++;
  status.reason = fallback.reason;
  status.stage = fallback.stage;
  status.engine = engineKind(status.build, status.requested, true);
  sendCapped(status, "fallback", !reasonsSent.has(fallback.reason));
}

/** A running Rust engine trapped and the page reloads from its last autosave
 *  (#1422). The row keeps the engine that crashed, and goes out past the cap,
 *  since a page life reloads once. Before `settle` it is ignored, as a
 *  fallback is. */
export function noteEngineCrashReload(fault: { reason: FallbackReason; stage: FallbackStage }): void {
  if (!status) return;
  status.fallbacks++;
  status.reason = fault.reason;
  status.stage = fault.stage;
  sendCapped(status, "crash-reload", true);
}

/** The engine save writer turned itself off (`vctowerWriter.ts`). Reported
 *  once; before `settle` the settle row carries it. */
export function noteEngineWriterLatched(): void {
  if (writerLatched) return;
  writerLatched = true;
  if (status) sendCapped(status, "writer-latch", true);
}

/** At a tab hide or page hide: report the true count if the cap dropped a
 *  row since the last one went out. */
export function flushEngineStatus(): void {
  if (!status || !dropped) return;
  dropped = false;
  send(status, "summary");
}

/** Test hook: forget the page life. */
export function resetEngineStatus(): void {
  status = null;
  writerLatched = false;
  rowsSent = 0;
  reasonsSent.clear();
  dropped = false;
  pageLife = undefined;
  attemptSent = false;
  engagedSent = false;
}

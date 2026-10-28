import type { EngineChoice } from "../wasmhost/engineChoice";
import { COHORT_STAGE, COHORT_TELEMETRY, RUST_ONLY_BY_URL, STAGE_SHARE, type CohortStage } from "./config";
import { exitCleanly, stepAside } from "./crashMarker";
import { heldAfterCrashes, tabStore } from "./crashReload";
import { setCurrentSelection, currentSelection } from "./current";
import { latchSafety, selectEngine, suppressionApplies, type SafetyStage, type Selection } from "./policy";
import { browserStore, readSafety, type KeyValueStore } from "./records";
import { watchSurvival } from "./survival";

/**
 * The boot side of the staged cohort (#1197): asks the policy once which engine
 * this page life starts, keeps the crash marker alive while Rust runs, and
 * latches a safety suppression when Rust really fails. `bootstrap.ts` calls
 * these three and nothing else, so the policy stays testable on its own.
 *
 * Tooling builds (`VC_TOOLING=1`: e2e, screenshots, perf) and dev serves turn
 * the draw off and keep today's engine choice, unless a test sets the stage
 * through `vc.cohortTooling` (`{ "stage": 1 }`), a seam that production builds
 * compile away. A wasm-only build never asks: it has one engine. The sticky
 * safety path (the suppression and the crash marker) runs only once the
 * cohort's fields ship, so a stored Rust choice boots as it always has until
 * the reliability data can say why a boot moved to TypeScript.
 */

/** Tooling only: the stage a test runs the cohort at. */
export const TOOLING_STAGE_KEY = "vc.cohortTooling";

const KNOWN_STAGES: readonly CohortStage[] = [0, 1, 2, 3];

function toolingStage(store: KeyValueStore | null): CohortStage | null {
  try {
    const raw = store?.getItem(TOOLING_STAGE_KEY);
    const stage = raw ? (JSON.parse(raw) as { stage?: unknown }).stage : null;
    return KNOWN_STAGES.find((s) => s === stage) ?? null;
  } catch {
    return null;
  }
}

function randomUnit(): number {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0]! / 2 ** 32;
}

const pageKey = () => Math.floor(randomUnit() * 2 ** 32).toString(36) + Date.now().toString(36);

let stopWatch: (() => void) | null = null;
let store: KeyValueStore | null = null;
let safetyOn = false;

/** Whether the cohort's draw runs: off in tooling and dev serves unless a test
 *  set a stage through the seam. Exported for its test. */
export function drawRuns(tooling: boolean, testStage: CohortStage | null): boolean {
  return !tooling || testStage !== null;
}

/** Whether the sticky safety path runs: with the cohort's fields
 *  (`COHORT_TELEMETRY`), or where a test set a stage. Exported for its test. */
export function safetyRuns(telemetry: boolean, testStage: CohortStage | null): boolean {
  return telemetry || testStage !== null;
}

/** Choose this page life's engine, and start the crash watch when it is Rust.
 *  Never throws: anything unexpected boots the TypeScript engine. */
export function selectBootEngine(search: string = globalThis.location?.search ?? ""): EngineChoice {
  stopWatch?.();
  stopWatch = null;
  try {
    return chooseAndWatch(search);
  } catch (e) {
    console.error("[engine] could not choose the engine; running on the TypeScript engine:", e);
    setCurrentSelection(null);
    return "ts";
  }
}

function chooseAndWatch(search: string): EngineChoice {
  store = browserStore();
  const tooling = import.meta.env.DEV || __TOOLING_BUILD__;
  const testStage = tooling ? toolingStage(store) : null;
  const stage = testStage ?? COHORT_STAGE;
  safetyOn = safetyRuns(COHORT_TELEMETRY, testStage);
  let selection = selectEngine({
    store,
    url: new URLSearchParams(search).get("engine"),
    drawOn: drawRuns(tooling, testStage),
    stage,
    share: STAGE_SHARE[stage],
    sha: __APP_SHA__,
    pageId: pageKey(),
    now: Date.now(),
    random: randomUnit,
    safetyOn,
    rustOnlyByUrl: RUST_ONLY_BY_URL,
  });
  if (selection.boot !== "ts" && heldAfterCrashes(tabStore(), __APP_SHA__)) {
    // This tab's Rust engine crashed twice on this build (#1422): its boots
    // run TypeScript and say why, a `?engine=wasm` visit included.
    if (selection.markerId) stepAside(store, { id: selection.markerId, sha: __APP_SHA__ });
    selection = { ...selection, boot: "ts", markerId: null, notice: "none", heldAfterCrashes: true };
  }
  setCurrentSelection(selection);
  if (selection.markerId) stopWatch = watchSurvival(store, { id: selection.markerId, sha: __APP_SHA__ });
  return selection.boot;
}

/** This page life stopped running Rust: its crash-marker entry goes, so a
 *  later crash on TypeScript never counts against the Rust engine. */
function leftRust(sel: Selection): void {
  stopWatch?.();
  stopWatch = null;
  if (sel.markerId) exitCleanly(store, { id: sel.markerId, sha: __APP_SHA__ }, Date.now());
}

/** Rust failed on this device: a load failure (build scope) or a latched
 *  fault (until the player retries). Only where the cohort's draw ran and
 *  the boot was an ordinary one, so tooling keeps a known engine on every
 *  load and a `?engine=` test visit leaves the player's own records alone (as
 *  the crash marker does). A clean refusal is never passed here, since it
 *  only says one tower was not hosted. `engine` is the binary's source hash
 *  (#963) when it reported one. */
export function noteRustFailed(stage: SafetyStage, reason: string, engine?: string): void {
  try {
    const sel = currentSelection();
    if (!sel || !safetyOn || sel.assignedArm === "none" || sel.selectedBy === "url") return;
    // The page runs TypeScript now, so a pending "now runs on Rust" notice is untrue.
    setCurrentSelection({ ...sel, notice: "none" });
    latchSafety(store, { reason, stage, sha: __APP_SHA__, now: Date.now(), ...(engine ? { engine } : {}) });
    // Only a latch that storage kept lets the page life leave the crash
    // marker. Otherwise its entry stays and goes stale, so the crash check
    // still counts this failure and the next boots stay on TypeScript.
    const held = readSafety(store);
    if (held.ok && suppressionApplies(held.value, __APP_SHA__)) leftRust(sel);
    else {
      stopWatch?.();
      stopWatch = null;
    }
  } catch (e) {
    console.error("[engine] could not record the Rust engine's failure:", e);
  }
}

/** The running Rust engine crashed and this page reloads (#1422): the crash
 *  is counted in the tab (`crashReload.ts`), not as a stale page life, so the
 *  watch stops and this page life's marker entry goes. */
export function noteRustCrashed(): void {
  try {
    const sel = currentSelection();
    stopWatch?.();
    stopWatch = null;
    if (sel?.markerId) stepAside(store, { id: sel.markerId, sha: __APP_SHA__ });
  } catch (e) {
    console.error("[engine] could not record the Rust engine's crash:", e);
  }
}

/** The line for a boot held on TypeScript after this tab's crashes. */
export const CRASH_HOLD_NOTICE = "The Rust engine stopped twice, so this game is running on the TypeScript engine for now. You can change this in Settings.";

const NOTICES = {
  enrolled: "This game now runs on the new Rust engine as part of a test. You can change this in Settings.",
  withdrawn: "This game runs on the TypeScript engine again, since the Rust engine test changed. You can change this in Settings.",
} as const;

/** The once-only line for a stage change that moved this browser's engine, or
 *  null. The policy sets it only for an Automatic choice the cohort decided.
 *  A boot held on TypeScript after this tab's crashes says so on each boot. */
export function stageNotice(): string | null {
  if (currentSelection()?.heldAfterCrashes) return CRASH_HOLD_NOTICE;
  const notice = currentSelection()?.notice ?? "none";
  return notice === "none" ? null : NOTICES[notice];
}

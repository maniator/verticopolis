/**
 * The staged engine cohort's configuration (#1197, release plan 4.1 and the
 * owner's 2026-10-20 direction). One file, outside `src/wasmhost`, so a stage
 * change or a drop-back is a one-constant deploy and the freeze guard can
 * exempt it.
 *
 * Every value here is the owner's to change: a stage promotion, a drop-back,
 * the size gate's threshold and sending the cohort's new analytics fields
 * each ship only on his explicit approval. Stage 0 runs no cohort: the bucket
 * is drawn and kept, but every Automatic browser stays on TypeScript.
 */

export type CohortStage = 0 | 1 | 2 | 3;

/** The proposed `stage` field's closed list: the stage the build carries. */
export const STAGES = ["0", "1", "2", "3"] as const;

/** The stage this build carries. 0 until the owner approves stage 1. */
export const COHORT_STAGE: CohortStage = 0;

/** The WASM arm's share of buckets (0 to 99) at each stage, in percent. */
export const STAGE_SHARE: Readonly<Record<CohortStage, number>> = { 0: 0, 1: 10, 2: 25, 3: 50 };

/** The stages that run the size gate (plan 4.1: through stage 2, off at 3). */
export const SIZE_GATED_STAGES: readonly CohortStage[] = [1, 2];

/** The size above which a tower stays on TypeScript while the gate runs.
 *  `null` until the owner picks the gate's rule, unit and threshold. No gate
 *  runs in this build: `SIZE_GATE_BUILT` says when one does. */
export const SIZE_GATE_THRESHOLD: number | null = null;

/** Whether this build has the size gate (#1197). The PR that adds it flips this. */
export const SIZE_GATE_BUILT = false;

/** Whether a clean attach refusal keeps the rest of the page life on
 *  TypeScript under the cohort (#1258). The PR that fixes it flips this. */
export const REFUSAL_HOLDS_PAGE_LIFE = false;

/** Whether `engine_status` rows carry the cohort's fields. Off until the
 *  owner approves the exact additions; nothing new reaches production
 *  telemetry while it is false. The sticky safety path (the suppression and
 *  the crash marker) switches on with it, so no boot moves to TypeScript
 *  where the reliability data could not say why. */
export const COHORT_TELEMETRY = false;

/** True when a build would put browsers on Rust through the cohort before
 *  everything stage 1 needs is in it: the cohort's fields, #1258's page-life
 *  hold and, at a stage that runs the size gate, the gate with its threshold.
 *  `config.test.ts` fails CI where this holds, so a one-line promotion cannot
 *  ship ahead of them. */
export function shipsBlind(c: { share: number; telemetry: boolean; refusalHolds: boolean; gated: boolean; gateBuilt: boolean; threshold: number | null }): boolean {
  if (c.share <= 0) return false;
  return !c.telemetry || !c.refusalHolds || (c.gated && (!c.gateBuilt || c.threshold === null));
}

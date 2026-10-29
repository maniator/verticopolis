/**
 * The staged engine cohort's configuration (#1197, release plan 4.1 and the
 * owner's 2026-10-20 direction). One file, outside `src/wasmhost`, so a stage
 * change or a drop-back is a one-constant deploy and the freeze guard can
 * exempt it.
 *
 * Every value here is the owner's to change: a stage promotion, a drop-back,
 * the size gate's stages and threshold, and sending the cohort's new analytics fields
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

/** The stages that run the size gate. Stage 2 only: the owner decided stage 1
 *  runs with no size gate, so towers of every size get the Rust engine there
 *  ("Yes no gate", 2026-10-29 00:46 UTC, replacing plan 4.1's gate from stage
 *  1). Stage 2 keeps the gate until he decides otherwise, and `shipsBlind`
 *  requires it, with its threshold, before stage 2 can ship. */
export const SIZE_GATED_STAGES: readonly CohortStage[] = [2];

/** The size above which a tower stays on TypeScript while the gate runs.
 *  `null` until the owner picks stage 2's gate rule and threshold. No gate
 *  runs in this build: `SIZE_GATE_BUILT` says when one does. */
export const SIZE_GATE_THRESHOLD: number | null = null;

/** Whether this build has the size gate (#1197). The PR that adds it flips this. */
export const SIZE_GATE_BUILT = false;

/** Whether a clean attach refusal keeps the rest of the page life on
 *  TypeScript under the cohort (#1258). It does: the refusal hands the app the
 *  TypeScript port, every later Load, import and New goes through that port,
 *  and `rustPageLife.guard.test.ts` keeps the boot the only way into Rust. */
export const REFUSAL_HOLDS_PAGE_LIFE = true;

/** Whether `engine_status` rows carry the cohort's fields and #1090's
 *  `attempt` and `engaged` rows. On since the owner approved the analytics
 *  packet (rev 5, "A yes", 2026-10-29 00:46 UTC); any other new field still
 *  needs his approval. The sticky safety path (the suppression and
 *  the crash marker) switches on with it, so no boot moves to TypeScript
 *  where the reliability data could not say why. A Settings choice of the
 *  Rust engine runs it regardless (`playerChoseRust`, owner 2026-10-28). */
export const COHORT_TELEMETRY = true;

/** True while only a player's choice boots the Rust engine: a `?engine=wasm`
 *  link or the Settings choice of the Rust engine. The cohort's draw and the
 *  old measurement hosts (`wasm-frame`, `wasm-worker`) run TypeScript (owner's
 *  decisions, 2026-10-28). The Settings choice joined the link once a trap
 *  reloads the game rather than stopping it (#1422). A tooling build (VC_TOOLING=1, never
 *  shipped to players) keeps the stored choice, which the end-to-end lanes and
 *  the screenshot harness set to run every page they open on the Rust engine. */
export const RUST_ONLY_BY_CHOICE = !__TOOLING_BUILD__;

/** True when a build would put browsers on Rust through the cohort before
 *  everything stage 1 needs is in it: the cohort's fields, #1258's page-life
 *  hold and, at a stage that runs the size gate (stage 2 only), the gate with
 *  its threshold.
 *  `config.test.ts` fails CI where this holds, so a one-line promotion cannot
 *  ship ahead of them. */
export function shipsBlind(c: { share: number; telemetry: boolean; refusalHolds: boolean; gated: boolean; gateBuilt: boolean; threshold: number | null }): boolean {
  if (c.share <= 0) return false;
  return !c.telemetry || !c.refusalHolds || (c.gated && (!c.gateBuilt || c.threshold === null));
}

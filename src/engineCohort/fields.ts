import type { EngineChoice } from "../wasmhost/engineChoice";
import { COHORT_STAGE, STAGES } from "./config";
import { ASSIGNED_ARMS, type Selection } from "./policy";

/**
 * The cohort's fields on every `engine_status` row (A4, the analytics packet
 * rev 5, approved by Naftali on 2026-10-29): the stage the build carries, the
 * randomized arm, and which policy rule chose the engine. Codes only; the
 * bucket number, the enrollment history and the safety record's time or
 * engine hash are never sent.
 */

/** `selected_by` as the rows carry it: the policy's rule, with a safety
 *  suppression split by its scope (packet item 2). `safety-build` is a
 *  package that failed to load, timed out or did not match, and clears on the
 *  next build; `safety-device` is a fault, kept until the player retries. */
export const WIRE_SELECTIONS = ["default", "cohort", "setting", "url", "safety-build", "safety-device"] as const;
export type WireSelection = (typeof WIRE_SELECTIONS)[number];

export interface CohortFields {
  stage: (typeof STAGES)[number];
  assigned_arm: (typeof ASSIGNED_ARMS)[number];
  selected_by: WireSelection;
}

/** The fields for this page life's selection. With none (a wasm-only build,
 *  or a choice that threw and booted TypeScript) the draw did not run. */
export function cohortFields(sel: Pick<Selection, "stage" | "assignedArm" | "selectedBy" | "suppression"> | null): CohortFields {
  if (!sel) return { stage: `${COHORT_STAGE}`, assigned_arm: "none", selected_by: "default" };
  return { stage: `${sel.stage}`, assigned_arm: sel.assignedArm, selected_by: wireSelection(sel) };
}

function wireSelection(sel: Pick<Selection, "selectedBy" | "suppression">): WireSelection {
  if (sel.selectedBy !== "safety") return sel.selectedBy;
  return sel.suppression?.scope === "build" ? "safety-build" : "safety-device";
}

/** What a page life's rows say about its choice: the engine the policy asked
 *  for before any suppression or hold, the one boot started, the cohort's
 *  fields, whether the boot found a crash loop, and whether it could not write
 *  its crash marker. */
export function selectionFacts(boot: EngineChoice, sel: Selection | null) {
  return { requested: sel?.requested ?? boot, boot, cohort: cohortFields(sel), crashLoop: sel?.crashLoop === true, markerBlocked: sel?.markerBlocked === true };
}

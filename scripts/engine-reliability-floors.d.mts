// Type surface for scripts/engine-reliability-floors.mjs, which stays plain
// dependency-free JS; these signatures only describe what its test and
// engine-reliability.mjs use.
import type { CohortCount } from "./engine-reliability-cohorts.mjs";
import type { PageLife } from "./engine-reliability.mjs";

export declare const STAGE_FLOORS: Array<{ stage: string; floor: number }>;

export interface StageFloor {
  stage: string;
  floor: number;
  engaged: CohortCount;
  attempts: CohortCount;
  reached: boolean;
}

export function summarizeFloors(pageLives: PageLife[]): StageFloor[];
export function renderFloorsMarkdown(floors: StageFloor[]): string[];

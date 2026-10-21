// Type surface for scripts/engine-reliability-cohorts.mjs. The script stays
// plain dependency-free JS; these signatures only describe what
// the cohort tests and engine-reliability.mjs use.
import type { PageLife } from "./engine-reliability.mjs";

export declare const OVERRIDE_SELECTIONS: string[];
export declare const ELIGIBLE_STAGE: string;
export declare const ELIGIBLE_HOST: string;
export declare const ENGINE_RUNNING: string[];
export declare const COMPARED_ARMS: string[];

export interface CohortCount {
  n: number;
  faults: number;
  faultsOrLeft: number;
  latched: number;
  leftBeforeTower: number;
  overridden: number;
  overriddenFaults: number;
  byEngagement: { command: number; play: number; unknown: number; none: number };
  rate: number | null;
  upper95: number | null;
  upper95Pessimistic: number | null;
  byBuild: Array<{ build: string; sessions: number; faults: number; upper95: number | null }>;
}

export interface AttemptRow {
  arm: string;
  sessions: number;
  faults: number;
  faultsOrLeft: number;
  engaged: number;
  faultNotEngaged: number;
  leftBeforeTower: number;
  overrides: number;
  movedOff: number;
  movedOffNeverRan: number;
  latched: number;
}

export interface ArmRow {
  stage: string;
  arm: string;
  sessions: number;
  engaged: number;
  faults: number;
  crashes: number;
  sizeGatedOut?: number;
}

export interface Coverage {
  with: number;
  of: number;
}

export interface CohortsSummary {
  attempts: AttemptRow & { rate: number | null; upper95: number | null; upper95Pessimistic: number | null; byArm: AttemptRow[] };
  attemptsWithMovedOff: { n: number; faults: number; rate: number | null; upper95: number | null; upper95Pessimistic: number | null; latched: number; leftBeforeTower: number };
  uncountedHostSessions: number;
  uncountedHostFaults: number;
  comparisonEngagedRows: Record<string, Coverage>;
  eligibleAttempts: CohortCount;
  eligible: CohortCount;
  tailAttempts: CohortCount;
  tail: CohortCount;
  comparison: Array<{ stage: string; wasm: ArmRow; ts: ArmRow; crashDifference: [number, number] | null }>;
  changed: ArmRow;
  crashSessions: number;
  unrecognizedSessions: number;
  attemptRows: Coverage;
  engagedRows: Coverage;
  cohortFields: Coverage;
  stopSignals: string[];
}

export interface CohortOptions {
  hosts?: string[];
  eligibleShas?: string[];
  tailShas?: string[];
  crashSessions?: Set<string>;
}

export function isOverride(pl: PageLife): boolean;
export function isFault(pl: PageLife): boolean;
export function isSuppressed(pl: PageLife): boolean;
export function suppressedFault(pl: PageLife): boolean;
export function engineFault(pl: PageLife): boolean;
export function ranEngine(pl: PageLife): boolean;
export function isEligible(pl: PageLife, eligibleShas: string[], settledOrNot?: boolean): boolean;
export function engagedOnEngine(pl: PageLife): boolean;
export function differenceInterval(k1: number, n1: number, k2: number, n2: number): [number, number] | null;
export function summarizeCohorts(pageLives: PageLife[], opts?: CohortOptions): CohortsSummary;
export function cohortCaveats(c: CohortsSummary, meta: { eligibleShas: string[] }): string[];
export function renderCohortsMarkdown(c: CohortsSummary, meta: { eligibleShas: string[]; tailShas: string[] }): string[];

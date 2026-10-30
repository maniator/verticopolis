// Type surface for the helpers scripts/engine-reliability.mjs exports. The
// script itself stays plain dependency-free JS; these signatures only describe
// what src/engine-reliability.test.ts imports.

export declare const EVENT: "engine_status";
export declare const DEFAULT_HOSTS: string[];
export declare const REQUESTS: string[];
export declare const HOSTS: string[];
export declare const BUILDS: string[];
export declare const REASONS: string[];
export declare const EXCLUDED_ARMS: string[];
export declare const ROW_LIMIT: number;
export declare const ENGINE_KINDS_SENT: string[];
export declare const STAGES: string[];
export declare const ASSIGNED_ARMS: string[];
export declare const SELECTIONS: string[];
export declare const ENGAGED_BY: string[];
export function shaMatches(sha: string, shas: string[]): boolean;

/** One page life, normalized from the query's row. */
export interface PageLife {
  session: string;
  pageLife: string;
  version: string;
  sha: string;
  build: string;
  requested: string;
  /** `stage` (A4): `none` when absent. */
  stage: string;
  /** `assigned_arm` (A4): the randomized arm, never rewritten; `none` when absent. */
  assignedArm: string;
  /** `selected_by` (A4): which policy rule chose the engine; `default` when absent. */
  selectedBy: string;
  safetySuppressed: boolean;
  sizeGated: boolean;
  fallbacks: number;
  /** The `fallbacks` the settle row sent: above 0 when the first tower already fell back. */
  settleFallbacks: number;
  reasons: string[];
  writerLatched: boolean;
  /** Sent a `settle` row; a row from before the `attempt` row existed always settled. */
  settled: boolean;
  /** Sent an `attempt` row (proposed for #1090). */
  attempted: boolean;
  /** Sent an `engaged` row (proposed for #1090). */
  engaged: boolean;
  /** `engine` on the `engaged` row; `none` when absent. */
  engagedEngine: string;
  engagedBy: string;
  firstSeen: string;
}

export interface ReliabilityOptions {
  hosts?: string[];
  shas?: string[] | null;
  versions?: string[] | null;
  builds?: string[] | null;
  arms?: string[] | null;
}

export interface GroupRow {
  sessions: number;
  faults: number;
  pageLives: number;
  faultPageLives: number;
  upper95: number | null;
}

export interface ReliabilitySummary {
  n: number;
  faults: number;
  rate: number | null;
  upper95: number | null;
  mismatchSessions: number;
  latchedSessions: number;
  pageLives: number;
  faultPageLives: number;
  mismatchPageLives: number;
  mismatchNeverRan: number;
  latchedPageLives: number;
  sizeGatedPageLives: number;
  unsettledPageLives: number;
  safetySuppressedPageLives: number;
  crashLoopPageLives: number;
  unrecognizedPageLives: number;
  totalFallbacks: number;
  maxFallbacks: number;
  byBuild: Array<GroupRow & { build: string }>;
  byArm: Array<GroupRow & { arm: string }>;
  byStage: Array<GroupRow & { stage: string }>;
  byReason: Array<{ reason: string; pageLives: number }>;
}

export interface ReportMeta {
  windowLabel: string;
  until: string;
  hosts: string[];
  builds: string;
  arms: string;
  truncated: boolean;
}

export function buildPageLivesQuery(hours: number): string;
export function armOf(pl: PageLife): string;
export function recognized(pl: PageLife): boolean;
export function pageLivesFromRows(rows: Array<Record<string, unknown>>): PageLife[];
export function upperBound(k: number, n: number, confidence?: number): number | null;
export function summarizeReliability(pageLives: PageLife[], opts?: ReliabilityOptions): ReliabilitySummary;
export function renderReliabilityMarkdown(summary: ReliabilitySummary, meta: ReportMeta): string;
export function parseArgs(argv: string[]): {
  window: { hours: number; label: string };
  opts: { hosts: string[]; shas: string[] | null; versions: string[] | null; builds: string[] | null; arms: string[] | null };
};
export function responseRows(json: unknown): { rows: Array<Record<string, unknown>>; truncated: boolean };

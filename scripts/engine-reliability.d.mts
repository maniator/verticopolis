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

/** One page life, normalized from the query's row. */
export interface PageLife {
  session: string;
  pageLife: string;
  version: string;
  sha: string;
  build: string;
  requested: string;
  arm: string;
  sizeGated: boolean;
  fallbacks: number;
  /** The `fallbacks` the settle row sent: above 0 when the first tower already fell back. */
  settleFallbacks: number;
  reasons: string[];
  writerLatched: boolean;
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
  unrecognizedPageLives: number;
  totalFallbacks: number;
  maxFallbacks: number;
  byBuild: Array<GroupRow & { build: string }>;
  byArm: Array<GroupRow & { arm: string }>;
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
export function pageLivesFromRows(rows: Array<Record<string, unknown>>): PageLife[];
export function upperBound(k: number, n: number, confidence?: number): number | null;
export function summarizeReliability(pageLives: PageLife[], opts?: ReliabilityOptions): ReliabilitySummary;
export function renderReliabilityMarkdown(summary: ReliabilitySummary, meta: ReportMeta): string;
export function parseArgs(argv: string[]): {
  window: { hours: number; label: string };
  opts: { hosts: string[]; shas: string[] | null; versions: string[] | null; builds: string[] | null; arms: string[] | null };
};
export function responseRows(json: unknown): { rows: Array<Record<string, unknown>>; truncated: boolean };

// Type surface for the pure helpers scripts/posthog-report.mjs exports for unit
// testing. The script itself stays plain dependency-free JS; these signatures
// only describe the functions src/posthog-report.test.ts imports.

/** A tagged query result: `ok` plus either the raw PostHog JSON or a hint. */
export interface QueryResult {
  ok: boolean;
  status?: number;
  hint?: string;
  json?: unknown;
}

/** One depth row: exact percentiles for a numeric property, or a skip/empty flag. */
export interface DepthRow {
  skipped: boolean;
  empty?: boolean;
  hint?: string;
  n?: number;
  p50?: number;
  p90?: number;
  p95?: number;
  max?: number;
}

export function clampDays(v: unknown): number;
export function lit(s: unknown): string;
export function buildTotalsQuery(events: string[], days: number): string;
export function buildDepthQuery(event: string, prop: string, days: number): string;
export function buildBreakdownQuery(event: string, prop: string, days: number, limit?: number): string;
export function rowsToObjects(json: unknown): Array<Record<string, unknown>>;
export function totalsByEvent(res: QueryResult, events: string[]): Record<string, { events: number; sessions: number }>;
export function depthRow(res: QueryResult): DepthRow;
export function breakdownRows(res: QueryResult): Array<{ key: string; events: number; sessions: number }> | null;

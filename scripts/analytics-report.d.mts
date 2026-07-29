// Type surface for the pure helpers scripts/analytics-report.mjs exports for
// unit testing. The script itself stays plain dependency-free JS; these
// signatures only describe the functions src/analytics-report.test.ts imports.

/** An aggregate query result as the report normalizes it. */
export interface AggResult {
  ok: boolean;
  rows?: Array<{ key: string | number; count: number; visitors?: number }> | null;
  truncated?: boolean;
  hint?: string;
}

/** Weighted percentiles reconstructed from a value histogram. */
export interface Percentiles {
  samples: number;
  values: number[];
  max: number;
  truncated: boolean;
}

export function percentiles(res: AggResult, ps: number[]): Percentiles | null;
export function bucketSeconds(res: AggResult): Record<string, number> | null;
export function parseWindow(v: unknown): { hours: number; label: string };
export function extractRows(json: unknown): Array<{ key: string; count: number; visitors: number }> | null;
export function extractCount(json: unknown): number | null;

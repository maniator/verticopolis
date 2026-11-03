export function buildCoverageQuery(hours: number): string;
export function coverageFromRows(rows: Record<string, unknown>[]): { boots: number; engineSessions: number; engineNoEnd: number };
export function buildTrapCountQuery(hours: number): string;
export function buildTrapOutcomeQuery(hours: number): string;
export function classifyTrap(row: Record<string, unknown>): "recovered" | "stopped" | "reloaded" | "unknown";
export function summarizeTraps(trapped: unknown, outcomeRows: Record<string, unknown>[]): { trapped: number; recovered: number; stopped: number; reloaded: number; unknown: number };
export function renderCoverageMarkdown(
  input: { coverage: { boots: number; engineSessions: number; engineNoEnd: number }; traps: ReturnType<typeof summarizeTraps>; lives: { settled: boolean; attempted: boolean }[] },
  meta: { windowLabel: string; truncated: boolean },
): string;
export function coverageSection(hours: number, windowLabel: string, lives: { settled: boolean; attempted: boolean }[]): Promise<string>;

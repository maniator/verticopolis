// Type surface for scripts/persistence-failures.mjs, for src/persistence-failures.test.ts.

export declare const PERSISTENCE_FAILURE_SINCE: string;
export declare const EXPORT_FAILURE_SINCE: string;
export declare const ACTIONS: string[];
export declare const EXPORT_ACTIONS: string[];
export declare const ROW_LIMIT: number;
export declare const DETAILS: Record<string, string[]>;
export function buildPersistenceQuery(hours: number, since?: string, exportSince?: string): string;
export function buildPresenceQuery(hours: number, since?: string, exportSince?: string): string;
export function presenceFromRows(rows: Record<string, unknown>[]): PersistencePresence;
export function tallyRows(rows: Record<string, unknown>[]): Map<string, { events: number; sessions: number }>;
export interface PersistencePresence {
  liveEvents: number;
  exportLiveEvents: number;
  autosaveSessions: number;
}
export interface PersistenceRate {
  status: "insufficient" | "unavailable" | "not-measurable" | "bound" | "rate";
  text: string;
}
export function rateOf(failures: number, attempts: number): PersistenceRate;
export interface PersistenceMeasure {
  measure: string;
  failures: number | null;
  sessions: number | null;
  attempts: number | null;
  rate: PersistenceRate;
}
export function summarizePersistence(tally: Map<string, { events: number; sessions: number }>, presence: PersistencePresence): PersistenceMeasure[];
export function renderPersistenceMarkdown(measures: PersistenceMeasure[], meta: { windowLabel: string; truncated: boolean }): string;
export function persistenceSection(hours: number, windowLabel: string): Promise<string>;

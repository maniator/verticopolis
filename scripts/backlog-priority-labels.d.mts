// Type surface for the helpers scripts/backlog-priority-labels.mjs exports for
// unit testing. The script itself stays plain dependency-free JS; these
// signatures only describe what src/tests/backlogPriorityLabels.test.ts imports.

export type Priority = "P1" | "P2" | "P3";

export declare const PRIORITY_LABELS: readonly Priority[];
export declare const TRIAGE_LABEL: "needs-triage";

/** Issue number to the priority its backlog row records, plus any rows whose
 *  priority could not be read. */
export declare function parseBacklogPriorities(markdown: string): {
  priorities: Map<number, Priority>;
  errors: string[];
};

/** One issue's relabel: the P label to add (or null) and the labels to drop
 *  (other P labels, and `needs-triage`). The add runs before the removals. */
export interface LabelChange {
  issue: number;
  add: Priority | null;
  remove: string[];
}

export declare function planLabelChanges(
  priorities: ReadonlyMap<number, Priority>,
  openIssues: ReadonlyMap<number, readonly string[]>,
): LabelChange[];

export declare function citedButNotOpen(
  priorities: ReadonlyMap<number, Priority>,
  openIssues: ReadonlyMap<number, readonly string[]>,
): number[];

/** Runs the GitHub CLI with `args` and resolves to its stdout. A failed call
 *  rejects with a GhError. */
export type Gh = (args: string[]) => Promise<string>;

/** A failed gh call; `rateLimited` is true when GitHub refused it because of
 *  a rate limit. */
export interface GhError extends Error {
  rateLimited: boolean;
}

export declare function ghCli(): Gh;

export declare function run(options: {
  markdown: string;
  repo: string;
  gh: Gh;
  dryRun?: boolean;
  pauseMs?: number;
  limitWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): Promise<{
  ok: boolean;
  plan: LabelChange[];
  failures: number[];
  errors: string[];
}>;

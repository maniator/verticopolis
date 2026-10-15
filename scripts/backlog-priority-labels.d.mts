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

/** `request(method, path, body)` against the GitHub REST API. */
export type Request = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<unknown>;

/** Seconds GitHub asks a rate-limited caller to wait, or null. */
export declare function retryWaitSeconds(
  res: { headers: { get(name: string): string | null } },
  now?: number,
): number | null;

export declare function githubClient(
  token: string,
  options?: { sleep?: (ms: number) => Promise<void> },
): Request;

export declare function run(options: {
  markdown: string;
  repo: string;
  request: Request;
  dryRun?: boolean;
  pauseMs?: number;
  log?: (line: string) => void;
}): Promise<{
  ok: boolean;
  plan: LabelChange[];
  failures: number[];
  errors: string[];
}>;

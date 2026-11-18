// Type surface for the pure helpers scripts/posthog-dashboard.mjs exports for
// unit testing. The script itself stays plain dependency-free JS; these
// signatures only describe what src/posthog-dashboard.test.ts imports.

/** One insight definition from `buildInsights`. */
export interface InsightSpec {
  name: string;
  description?: string;
  query: unknown;
  /** True for a tile the run may add to the live dashboard. */
  overview?: boolean;
  /** The short id of the insight an earlier run added for this spec. */
  shortId?: string;
  /** Desktop grid rows the tile takes when added (default 5). */
  height?: number;
}

/** A desktop grid box. */
export interface GridBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A dashboard tile as the PostHog API returns it (only the fields read here). */
export interface DashboardTile {
  deleted?: boolean;
  insight?: { name?: string; deleted?: boolean } | null;
  layouts?: { sm?: GridBox };
}

export interface AdditionPlan {
  add: { spec: InsightSpec; layout: GridBox }[];
  added: string[];
  onDashboard: string[];
  elsewhere: string[];
}

export function planAdditions(
  specs: InsightSpec[],
  dashboardTiles: DashboardTile[],
  existingElsewhere: Set<string>,
): AdditionPlan;
/** What a run does once it has planned (see `runSteps` in the script). */
export interface RunSteps {
  tiles: boolean;
  action: boolean;
  view: boolean;
}

export function runSteps(plan: AdditionPlan, updateView: boolean): RunSteps;
export function bottomRow(tiles: DashboardTile[]): number;
export function buildInsights(ids: { newGame: number | null }): InsightSpec[];
export const DASHBOARD_NAME: string;

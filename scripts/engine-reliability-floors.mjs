// The stage floors of the governed reliability definition (#1268): the owner's
// direction of 2026-10-21 counts the stage 1 and stage 2 floors in engaged
// sessions at their own stage, which the engaged eligible cohort (stage 3
// only, `engine-reliability-cohorts.mjs`) cannot be. Pinned by
// `src/engine-reliability-floors.test.ts`.
import { ELIGIBLE_HOST, bySession, cohort, inStageCohort, suppressedFault } from "./engine-reliability-cohorts.mjs";
import { recognized, shaMatches } from "./engine-reliability.mjs";

/** Each early stage and the engaged sessions it needs before its GO. */
export const STAGE_FLOORS = [
  { stage: "1", floor: 30 },
  { stage: "2", floor: 100 },
];

/**
 * Per stage: the engaged cohort at that stage (`wasm`-arm sessions the cohort
 * drew, not suppressed, that engaged on the engine) beside the cohort's
 * attempts at the stage, engaged or not. Plan 4.1 counts only the builds that
 * carry every fix the stage needed, from the deploy of its latest needed fix:
 * `floorShas` names them, and with none named every commit at the stage
 * counts and the report says so. The rows also give each build. A session
 * with an override page life never counts, as in the cohorts; the safety
 * denominator (every attempt, suppressed and overridden ones included) is the
 * cohorts' all-attempts row.
 */
export function summarizeFloors(allLives, floorShas = []) {
  const sessions = bySession(allLives.filter(recognized));
  const named = (pl) => !floorShas.length || shaMatches(pl.sha, floorShas);
  return STAGE_FLOORS.map(({ stage, floor }) => {
    const engaged = (pl) => named(pl) && inStageCohort(pl, stage);
    const loading = (pl) => named(pl) && inStageCohort(pl, stage, true);
    // A same-session crash loop at this stage, charged to the session.
    const loop = (pl) => named(pl) && suppressedFault(pl) && (pl.requested === ELIGIBLE_HOST || pl.requested === "ts") && pl.stage === stage && pl.assignedArm === "wasm";
    const cohortRow = cohort(sessions, engaged, loading, loop);
    return { stage, floor, commitsNamed: floorShas.length > 0, engaged: cohortRow, attempts: cohort(sessions, loading, loading, loop, false), reached: cohortRow.n >= floor };
  });
}

const code = (v) => `\`${v}\``;

/** The floors' section of the report, as Markdown lines. */
export function renderFloorsMarkdown(floors) {
  const named = floors.some((f) => f.commitsNamed);
  return [
    "",
    "### Stage floors (engaged sessions at their own stage)",
    "",
    named
      ? "> Counted on the commits `--floor-shas` names, the builds that carry every fix their stage needed (plan 4.1). A floor is a count to read before a stage GO, never a reliability figure."
      : "> **No floor commits named** (`--floor-shas`), so every commit at the stage counts. Plan 4.1 counts only the builds that carry every fix the stage needed, from the deploy of its latest needed fix: name them before calling a floor met. A floor is a count to read before a stage GO, never a reliability figure.",
    "",
    "| Stage | Floor | Engaged sessions | Floor reached | Faults among them | Cohort attempts at the stage (engaged or not) | Faults in those attempts | Left before a tower |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...floors.map((f) => `| ${code(f.stage)} | ${f.floor} | ${f.engaged.n} | ${f.reached ? "yes" : "no"} | ${f.engaged.faults} | ${f.attempts.n} | ${f.attempts.faults} | ${f.attempts.leftBeforeTower} |`),
    "",
    "The attempts here are the cohort's: a session that only ran suppressed or overridden page lives at the stage is outside them, and every fault stays in the all-attempts safety denominator above.",
    ...floors.filter((f) => f.engaged.byBuild.length).map((f) => `Stage ${code(f.stage)} engaged sessions by build (where they engaged or faulted): ${f.engaged.byBuild.map((b) => `${code(b.build)} ${b.sessions}`).join(", ")}.`),
  ];
}

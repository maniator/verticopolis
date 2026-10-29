// The stage floors of the governed reliability definition (#1268): the owner's
// direction of 2026-10-21 counts the stage 1 and stage 2 floors in engaged
// sessions at their own stage, which the engaged eligible cohort (stage 3
// only, `engine-reliability-cohorts.mjs`) cannot be. Pinned by
// `src/engine-reliability-floors.test.ts`.
import {
  ELIGIBLE_HOST,
  bySession,
  cohort,
  inStageCohort,
  suppressedFault,
} from "./engine-reliability-cohorts.mjs";
import { recognized } from "./engine-reliability.mjs";

/** Each early stage and the engaged sessions it needs before its GO. */
export const STAGE_FLOORS = [
  { stage: "1", floor: 30 },
  { stage: "2", floor: 100 },
];

/**
 * Per stage: the engaged cohort at that stage (`wasm`-arm sessions the cohort
 * drew, not suppressed, that engaged on the engine) beside the stage's
 * attempts, engaged or not. Every commit at the stage counts: which commits
 * count for stages 1 and 2 is not decided, so the rows also give each build.
 * A session with an override page life never counts, as in the cohorts.
 */
export function summarizeFloors(allLives) {
  const sessions = bySession(allLives.filter(recognized));
  return STAGE_FLOORS.map(({ stage, floor }) => {
    const engaged = (pl) => inStageCohort(pl, stage);
    const loading = (pl) => inStageCohort(pl, stage, true);
    // A same-session crash loop at this stage, charged to the session.
    const loop = (pl) =>
      suppressedFault(pl) &&
      (pl.requested === ELIGIBLE_HOST || pl.requested === "ts") &&
      pl.stage === stage &&
      pl.assignedArm === "wasm";
    const cohortRow = cohort(sessions, engaged, loading, loop);
    return {
      stage,
      floor,
      engaged: cohortRow,
      attempts: cohort(sessions, loading, loading, loop, false),
      reached: cohortRow.n >= floor,
    };
  });
}

const code = (v) => `\`${v}\``;

/** The floors' section of the report, as Markdown lines. */
export function renderFloorsMarkdown(floors) {
  return [
    "",
    "### Stage floors (engaged sessions at their own stage)",
    "",
    "> Counted on every commit at the stage; which commits count for stages 1 and 2 is not decided (#1268), so check the builds before calling a floor met. A floor is a count to read before a stage GO, never a reliability figure.",
    "",
    "| Stage | Floor | Engaged sessions | Floor reached | Faults among them | Attempts at the stage (engaged or not) | Faults in the attempts | Left before a tower |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...floors.map(
      (f) =>
        `| ${code(f.stage)} | ${f.floor} | ${f.engaged.n} | ${f.reached ? "yes" : "no"} | ${f.engaged.faults} | ${f.attempts.n} | ${f.attempts.faults} | ${f.attempts.leftBeforeTower} |`,
    ),
    "",
    ...floors
      .filter((f) => f.engaged.byBuild.length)
      .map(
        (f) =>
          `Stage ${code(f.stage)} engaged sessions by build (where they engaged or faulted): ${f.engaged.byBuild.map((b) => `${code(b.build)} ${b.sessions}`).join(", ")}.`,
      ),
  ];
}

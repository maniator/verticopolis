import { describe, expect, it } from "vitest";
import { COHORT_STAGE, COHORT_TELEMETRY, REFUSAL_HOLDS_PAGE_LIFE, SIZE_GATE_BUILT, SIZE_GATE_THRESHOLD, SIZE_GATED_STAGES, STAGE_SHARE, shipsBlind } from "./config";

const ready = { share: 10, telemetry: true, refusalHolds: true, gated: true, gateBuilt: true, threshold: 500 };

describe("the cohort config", () => {
  it("never puts a browser on Rust through the cohort before stage 1's prerequisites are in the build", () => {
    const gated = SIZE_GATED_STAGES.includes(COHORT_STAGE);
    expect(shipsBlind({ share: STAGE_SHARE[COHORT_STAGE], telemetry: COHORT_TELEMETRY, refusalHolds: REFUSAL_HOLDS_PAGE_LIFE, gated, gateBuilt: SIZE_GATE_BUILT, threshold: SIZE_GATE_THRESHOLD })).toBe(false);
  });

  it("flags a share above 0 with any prerequisite missing", () => {
    expect(shipsBlind(ready)).toBe(false);
    expect(shipsBlind({ ...ready, telemetry: false })).toBe(true);
    expect(shipsBlind({ ...ready, refusalHolds: false })).toBe(true);
    expect(shipsBlind({ ...ready, gateBuilt: false })).toBe(true);
    expect(shipsBlind({ ...ready, threshold: null })).toBe(true);
    expect(shipsBlind({ ...ready, gated: false, gateBuilt: false, threshold: null })).toBe(false);
  });

  it("lets stage 0 through with nothing built", () => {
    expect(shipsBlind({ share: 0, telemetry: false, refusalHolds: false, gated: false, gateBuilt: false, threshold: null })).toBe(false);
  });

  it("flags every stage above 0 in today's build", () => {
    for (const stage of [1, 2, 3] as const) {
      expect(shipsBlind({ share: STAGE_SHARE[stage], telemetry: COHORT_TELEMETRY, refusalHolds: REFUSAL_HOLDS_PAGE_LIFE, gated: SIZE_GATED_STAGES.includes(stage), gateBuilt: SIZE_GATE_BUILT, threshold: SIZE_GATE_THRESHOLD })).toBe(true);
    }
  });
});

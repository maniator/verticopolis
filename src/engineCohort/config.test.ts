import { describe, expect, it } from "vitest";
import { COHORT_STAGE, COHORT_TELEMETRY, REFUSAL_HOLDS_PAGE_LIFE, SIZE_GATE_BUILT, SIZE_GATE_ON, SIZE_GATE_THRESHOLD, SIZE_GATED_STAGES, STAGE_SHARE, shipsBlind, sizeGateHolds } from "./config";

const ready = { share: 10, telemetry: true, refusalHolds: true, gated: true, gateBuilt: true, gateOn: true, threshold: 500 };

describe("the cohort config", () => {
  it("never puts a browser on Rust through the cohort before stage 1's prerequisites are in the build", () => {
    const gated = SIZE_GATED_STAGES.includes(COHORT_STAGE);
    expect(shipsBlind({ share: STAGE_SHARE[COHORT_STAGE], telemetry: COHORT_TELEMETRY, refusalHolds: REFUSAL_HOLDS_PAGE_LIFE, gated, gateBuilt: SIZE_GATE_BUILT, gateOn: SIZE_GATE_ON, threshold: SIZE_GATE_THRESHOLD })).toBe(false);
  });

  it("flags a share above 0 with any prerequisite missing", () => {
    expect(shipsBlind(ready)).toBe(false);
    expect(shipsBlind({ ...ready, telemetry: false })).toBe(true);
    expect(shipsBlind({ ...ready, refusalHolds: false })).toBe(true);
    expect(shipsBlind({ ...ready, gateBuilt: false })).toBe(true);
    expect(shipsBlind({ ...ready, threshold: null })).toBe(true);
    expect(shipsBlind({ ...ready, gateOn: false })).toBe(true);
    expect(shipsBlind({ ...ready, gated: false, gateBuilt: false, gateOn: false, threshold: null })).toBe(false);
  });

  it("runs no size gate at stages 1 and 2, as the owner decided on 2026-10-29", () => {
    expect(SIZE_GATED_STAGES).toEqual([]);
    const built = { telemetry: true, refusalHolds: true, gateBuilt: SIZE_GATE_BUILT, gateOn: SIZE_GATE_ON, threshold: SIZE_GATE_THRESHOLD };
    expect(shipsBlind({ ...built, share: STAGE_SHARE[1], gated: SIZE_GATED_STAGES.includes(1) })).toBe(false);
    expect(shipsBlind({ ...built, share: STAGE_SHARE[2], gated: SIZE_GATED_STAGES.includes(2) })).toBe(false);
    // Naming stage 2 again would hold it until the flag is on with a threshold.
    expect(shipsBlind({ ...built, share: STAGE_SHARE[2], gated: true })).toBe(true);
  });

  it("lets stage 0 through with nothing built", () => {
    expect(shipsBlind({ share: 0, telemetry: false, refusalHolds: false, gated: false, gateBuilt: false, gateOn: false, threshold: null })).toBe(false);
  });

  it("flags no stage in today's build", () => {
    const blind = ([1, 2, 3] as const).filter((stage) =>
      shipsBlind({ share: STAGE_SHARE[stage], telemetry: COHORT_TELEMETRY, refusalHolds: REFUSAL_HOLDS_PAGE_LIFE, gated: SIZE_GATED_STAGES.includes(stage), gateBuilt: SIZE_GATE_BUILT, gateOn: SIZE_GATE_ON, threshold: SIZE_GATE_THRESHOLD }));
    expect(blind).toEqual([]);
  });
});

describe("the size gate (#1197)", () => {
  const on = { on: true, gatedStages: [2] as const, stage: 2 as const, selectedBy: "cohort", saveChars: 501, threshold: 500 };
  it("holds a cohort-drawn tower above the threshold at a gated stage, and nothing else", () => {
    expect(sizeGateHolds(on)).toBe(true);
    expect(sizeGateHolds({ ...on, saveChars: 500 })).toBe(false);
    expect(sizeGateHolds({ ...on, on: false })).toBe(false);
    expect(sizeGateHolds({ ...on, threshold: null })).toBe(false);
    expect(sizeGateHolds({ ...on, stage: 1 })).toBe(false);
    expect(sizeGateHolds({ ...on, stage: 3 })).toBe(false);
    for (const selectedBy of ["setting", "url", "default", "safety-device", undefined]) expect(sizeGateHolds({ ...on, selectedBy })).toBe(false);
  });
  it("ships built and switched off, with the threshold the owner's", () => {
    expect(SIZE_GATE_BUILT).toBe(true);
    expect(SIZE_GATE_ON).toBe(false);
    expect(SIZE_GATE_THRESHOLD).toBeNull();
  });
});

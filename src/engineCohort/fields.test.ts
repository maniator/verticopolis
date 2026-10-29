import { describe, expect, it } from "vitest";
import { COHORT_STAGE } from "./config";
import { cohortFields, selectionFacts } from "./fields";
import type { Selection } from "./policy";
import type { SafetyRecord } from "./records";

const record = (scope: SafetyRecord["scope"]): SafetyRecord => ({ v: 1, scope, reason: "trap-tick", stage: "start", sha: "a", at: 0 });
const sel = (over: Partial<Selection> = {}) => ({ stage: 1, assignedArm: "wasm", selectedBy: "cohort", suppression: null, requested: "wasm", crashLoop: false, ...over }) as Selection;

describe("the cohort's fields (A4)", () => {
  it("carry the stage, the arm and the rule, as codes", () => {
    expect(cohortFields(sel())).toEqual({ stage: "1", assigned_arm: "wasm", selected_by: "cohort" });
    expect(cohortFields(sel({ selectedBy: "setting", assignedArm: "ts" }))).toEqual({ stage: "1", assigned_arm: "ts", selected_by: "setting" });
  });

  it("split a safety suppression by its scope", () => {
    expect(cohortFields(sel({ selectedBy: "safety", suppression: record("build") })).selected_by).toBe("safety-build");
    expect(cohortFields(sel({ selectedBy: "safety", suppression: record("fault") })).selected_by).toBe("safety-device");
  });

  it("read as no draw without a selection", () => {
    expect(cohortFields(null)).toEqual({ stage: `${COHORT_STAGE}`, assigned_arm: "none", selected_by: "default" });
  });

  it("keep the policy's request apart from the engine boot started", () => {
    expect(selectionFacts("ts", sel({ selectedBy: "safety", suppression: record("fault"), crashLoop: true }))).toMatchObject({ requested: "wasm", boot: "ts", crashLoop: true });
    expect(selectionFacts("wasm", null)).toMatchObject({ requested: "wasm", boot: "wasm", crashLoop: false });
  });
});

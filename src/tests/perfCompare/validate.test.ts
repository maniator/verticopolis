import { describe, expect, it } from "vitest";
import { config, processRun, step } from "./fixtures";
import type { NodeCheck } from "./nodeCheck";
import { validateResults } from "./validate";

const node = (match = true): NodeCheck => ({
  scenario: "small",
  steps: 10,
  dt: 2,
  start: { tsState: "a", wasmState: "a", tsCrowd: "c", wasmCrowd: "c" },
  end: { tsState: "b", wasmState: match ? "b" : "x", tsCrowd: "d", wasmCrowd: "d" },
  match,
  nodeTsMs: 1,
  nodeWasmMs: 1,
});

const good = () => [processRun(0, "ts"), processRun(0, "wasm"), processRun(1, "wasm"), processRun(1, "ts")];

describe("validateResults", () => {
  it("passes a complete, consistent set", () => {
    const v = validateResults(config(), good(), [node()]);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/only 2 repetition/);
  });

  it("names a WASM fallback as an error and never counts it", () => {
    const runs = good();
    runs[1].cold!.engineActive = "ts";
    const v = validateResults(config(), runs, [node()]);
    expect(v.ok).toBe(false);
    expect(v.errors).toContain("rep 0 wasm: cold start: the WASM engine did not initialize; the page fell back to TypeScript");
  });

  it("flags a simulation or frame sample that ran on the other engine", () => {
    const runs = good();
    runs[1].scenarios.small.hosted["1"].engineActive = "ts";
    runs[1].scenarios.small.frames["1"].engineActive = "ts";
    runs[0].warm!.engineActive = "wasm";
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(
      expect.arrayContaining([
        "rep 0 wasm: small hosted at 1x ran on ts, not wasm",
        "rep 0 wasm: small frames at 1x ran on ts, not wasm",
        "rep 0 ts: warm start: the TypeScript run reports the WASM engine active",
      ]),
    );
  });

  it("refuses samples that started or ended in different states", () => {
    const runs = good();
    runs[3].scenarios.small.raw["1"] = step("ts", { startDigest: "other", endDigest: "other-end", end: { minutes: 599, money: 1, star: 2, population: 10, people: 3 } });
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors.some((e) => e.startsWith("small: the samples did not start from one state"))).toBe(true);
    expect(v.errors.some((e) => e.startsWith("small: the samples did not end in one state"))).toBe(true);
    expect(v.errors).toContain("small: the samples ended at different clock minutes: 600, 599");
  });

  it("reports missing and failed runs, and missing samples, by name", () => {
    const runs = good().slice(0, 3);
    runs[2] = { ...runs[2], ok: false, error: "boom" };
    delete (runs[0].scenarios as Record<string, unknown>).small;
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(expect.arrayContaining(["rep 1 ts: no process run recorded", "rep 1 wasm: failed: boom", "rep 0 ts: scenario small missing"]));
  });

  it("reports duplicate runs, a missing phase and missing per-throttle samples", () => {
    const runs = [...good(), processRun(1, "ts")];
    runs[0].warm = null;
    delete runs[1].scenarios.small.raw["1"];
    delete runs[1].scenarios.small.frames["1"];
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(expect.arrayContaining(["rep 1 ts: 2 process runs recorded, expected one", "rep 0 ts: no warm start sample", "rep 0 wasm: small raw at 1x missing", "rep 0 wasm: small frames at 1x missing"]));
  });

  it("fails on a Node mismatch or a missing Node check", () => {
    expect(validateResults(config(), good(), [node(false)]).errors[0]).toMatch(/Node conformance check found the engines disagree/);
    expect(validateResults(config(), good(), []).errors).toContain("small: no Node conformance check ran");
  });

  it("fails when the configurations cannot be compared", () => {
    const runs = good();
    runs[2].browserVersion = "140.0";
    runs[3].page = { ...runs[3].page!, viewport: { width: 800, height: 600, dpr: 1 }, crossOriginIsolated: false, timerResolutionMs: 0.1 };
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(expect.arrayContaining(["the runs used different browser builds: 141.0, 140.0", "some runs were cross-origin isolated and some were not"]));
    expect(v.errors.some((e) => e.startsWith("the runs used different viewports"))).toBe(true);
    expect(v.warnings.some((w) => /coarser than 20 microseconds/.test(w))).toBe(true);
    const onlyTs = validateResults(config({ reps: 1 }), [processRun(0, "ts"), { ...processRun(0, "wasm"), ok: false, error: "x" }], [node()]);
    expect(onlyTs.errors).toContain("no successful wasm process: the configurations cannot be compared");
  });

  it("gives no repetition warning at ten or more", () => {
    const runs = Array.from({ length: 10 }, (_, rep) => [processRun(rep, "ts"), processRun(rep, "wasm")]).flat();
    expect(validateResults(config({ reps: 10 }), runs, [node()]).warnings).toEqual([]);
  });

  it("fails a sample whose clock did not move by its steps or whose state did not change", () => {
    const runs = good();
    runs[0].scenarios.small.hosted["1"] = step("ts", { startMinutes: 590 });
    runs[1].scenarios.small.raw["1"] = step("wasm", { endDigest: "a" });
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(
      expect.arrayContaining([
        "rep 0 ts: small hosted at 1x: the clock moved 10 minutes, expected 20",
        "rep 0 wasm: small raw at 1x: the end state equals the start state; the simulation did not advance",
      ]),
    );
  });

  it("fails when the browser runs and the Node check disagree on the state", () => {
    const n = node();
    n.end.tsState = "z";
    n.end.wasmState = "z";
    expect(validateResults(config(), good(), [n]).errors).toContain("small: the browser runs ended in b, not the Node check's z");
    const m = node();
    m.start.tsState = "y";
    m.start.wasmState = "y";
    expect(validateResults(config(), good(), [m]).errors).toContain("small: the browser runs started from a, not the Node check's y");
  });

  it("fails on host errors and engine page errors, and warns on other page errors", () => {
    const runs = good();
    runs[1].scenarios.small.hosted["1"].hostErrorsAdded = ["trap"];
    runs[1].scenarios.small.frames["1"].hostErrorsAdded = ["trap"];
    runs[1].pageErrors = ["console: [wasm] not hosting this tower"];
    runs[0].pageErrors = ["console: 404"];
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(expect.arrayContaining(["rep 0 wasm: small hosted at 1x: the host reported trap", "rep 0 wasm: small frames at 1x: the host reported trap"]));
    expect(v.errors.some((e) => e.startsWith("rep 0 wasm: engine or frame errors in the page"))).toBe(true);
    expect(v.warnings.some((w) => w.startsWith("rep 0 ts: 1 page error(s)"))).toBe(true);
  });

  it("checks the audio state of both frame passes and warns on clamped or few frames", () => {
    const runs = good();
    runs[0].scenarios.small.frames["1"].audioStarted = true;
    runs[1].scenarios.small.framesAudio["1"].audioStarted = false;
    runs[2].scenarios.small.frames["1"].clampedFrames = 3;
    runs[3].scenarios.small.frames["1"].frames = 40;
    delete runs[3].scenarios.small.framesAudio["1"];
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(
      expect.arrayContaining([
        "rep 0 ts: small frames at 1x ran with audio started; the audio-off rows are not audio-off",
        "rep 0 wasm: small frames with audio at 1x ran without audio",
        "rep 1 ts: small frames with audio at 1x missing",
      ]),
    );
    expect(v.warnings.some((w) => w.includes("3 of 120 frames ran over 200 ms"))).toBe(true);
    expect(v.warnings.some((w) => w.includes("only 40 frames in the window"))).toBe(true);
  });

  it("warns when audio or the service worker did not start, and does not need the audio rows then", () => {
    const runs = good();
    runs[0].audio = { started: false, muted: false, contexts: [] };
    runs[0].scenarios.small.framesAudio = {};
    runs[1].firstVisitWithServiceWorker = { served: [], swActive: false, offlineEngineActive: null, offlinePageErrors: [], error: null };
    runs[2].firstVisitWithServiceWorker = { served: [], swActive: false, offlineEngineActive: null, offlinePageErrors: [], error: "boom" };
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual(
      expect.arrayContaining([
        "rep 0 ts: audio did not start, so the audio-on rows have no sample from it",
        "rep 0 wasm: the service worker first visit never activated; its transfer and offline rows have no sample from it",
        "rep 1 wasm: the service worker first visit failed (boom); its transfer and offline rows have no sample from it",
      ]),
    );
  });

  it("names a fallback at the 4x cold start", () => {
    const runs = good();
    runs[1].cold4x = { ...runs[1].cold4x!, engineActive: "ts" };
    expect(validateResults(config(), runs, [node()]).errors).toContain("rep 0 wasm: 4x cold start: the WASM engine did not initialize; the page fell back to TypeScript");
  });
});

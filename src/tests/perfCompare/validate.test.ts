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

  it("fails a software renderer and warns on a quick run", () => {
    const soft = (runs: ReturnType<typeof good>) => runs.map((r) => ({ ...r, page: { ...r.page!, webgl: { renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", vendor: "Google Inc. (Google)" } }, rendererEnd: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" }));
    const v = validateResults(config(), soft(good()), [node()]);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/software rasterizer.*SwiftShader.*run it on the GPU/);
    const quick = validateResults({ ...config(), quick: true }, soft(good()), [node()]);
    expect(quick.errors).toEqual([]);
    expect(quick.warnings.join(" ")).toMatch(/software rasterizer/);
    const mixed = good().map((r, i) => (i === 0 ? { ...r, page: { ...r.page!, webgl: { renderer: "ANGLE (AMD, AMD Radeon RX 6800 Direct3D11, D3D11)", vendor: "AMD" } }, rendererEnd: "ANGLE (AMD, AMD Radeon RX 6800 Direct3D11, D3D11)" } : r));
    expect(validateResults(config(), mixed, [node()]).errors.join(" ")).toMatch(/different WebGL renderers/);
  });

  it("fails closed on a run with no renderer, an unnamed one, or none read after the frames", () => {
    const noGl = good().map((r) => ({ ...r, page: { ...r.page!, webgl: null } }));
    expect(validateResults(config(), noGl, [node()]).errors.join(" ")).toMatch(/recorded no WebGL renderer/);
    const nulls = good().map((r) => ({ ...r, page: { ...r.page!, webgl: { renderer: "null", vendor: "" } }, rendererEnd: "null" }));
    expect(validateResults(config(), nulls, [node()]).errors.join(" ")).toMatch(/does not name a hardware adapter/);
    const noEnd = good().map((r) => ({ ...r, rendererEnd: undefined }));
    expect(validateResults(config(), noEnd, [node()]).errors.join(" ")).toMatch(/no WebGL renderer read after the frames/);
    expect(validateResults({ ...config(), quick: true }, noGl, [node()]).errors.filter((e) => /renderer/i.test(e))).toEqual([]);
  });

  it("downgrades unverified renderers to warnings under a register exception, and not a changed one", () => {
    const noGl = good().map((r) => ({ ...r, page: { ...r.page!, webgl: null }, rendererEnd: null }));
    const v = validateResults(config(), noGl, [node()], "EX-9");
    expect(v.errors.filter((e) => /renderer/i.test(e))).toEqual([]);
    expect(v.warnings.join(" ")).toMatch(/exception EX-9/);
  });

  it("judges an A/A pass by the engine that ran", () => {
    const aa = (ran: "ts" | "wasm") =>
      [0, 1].flatMap((rep) => (["ts", "wasm"] as const).map((slot) => ({ ...processRun(rep, ran), engine: slot, ranEngine: ran })));
    for (const ran of ["ts", "wasm"] as const) {
      const v = validateResults({ ...config(), aa: ran }, aa(ran), [node()]);
      expect(v.errors).toEqual([]);
    }
    const wrong = validateResults({ ...config(), aa: "wasm" }, aa("ts"), [node()]);
    expect(wrong.errors).toContain("rep 0 ts: an A/A pass of wasm ran ts");
    const slotted = [processRun(0, "ts", { ranEngine: "wasm" }), processRun(0, "wasm")];
    expect(validateResults(config(), slotted, [node()]).errors).toContain("rep 0 ts: a comparison run launched wasm in the ts slot");
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
    runs[2].scenarios.small.hosted["1"] = step("wasm", { gcAvailable: false });
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(
      expect.arrayContaining([
        "rep 0 ts: small hosted at 1x: the clock moved 10 minutes, expected 20",
        "rep 0 wasm: small raw at 1x: the end state equals the start state; the simulation did not advance",
        "rep 1 wasm: small hosted at 1x: gc() was missing (the browser ignored --js-flags=--expose-gc), so the loop did not start from a full collection",
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

  it("fails a repetition whose audio did not start, and warns when the service worker did not", () => {
    const runs = good();
    runs[0].audio = { started: false, muted: false, contexts: [] };
    runs[0].scenarios.small.framesAudio = {};
    runs[1].firstVisitWithServiceWorker = { served: [], swActive: false, onlineEngineActive: null, offlineEngineActive: null, onlinePageErrors: [], offlinePageErrors: [], error: null };
    runs[2].firstVisitWithServiceWorker = { served: [], swActive: false, onlineEngineActive: null, offlineEngineActive: null, onlinePageErrors: [], offlinePageErrors: [], error: "boom" };
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(["rep 0 ts: audio did not start (contexts: none), so the audio-on rows have no sample from it"]);
    expect(v.warnings).toEqual(
      expect.arrayContaining([
        "rep 0 wasm: the service worker first visit never activated; its transfer and offline rows have no sample from it",
        "rep 1 wasm: the service worker first visit failed (boom); its transfer and offline rows have no sample from it",
      ]),
    );
  });

  it("names a fallback at the throttled cold start, and needs none without a throttle", () => {
    const runs = good();
    runs[1].cold4x = { ...runs[1].cold4x!, engineActive: "ts" };
    for (const r of runs) r.cpuProbe = { unthrottledMs: 50, throttledMs: 200, rate: 4, timed: { "small:4": 200, "frames-off:4": 200, "frames-on:4": 200 } };
    expect(validateResults(config({ throttles: [1, 4] }), runs, [node()]).errors).toContain("rep 0 wasm: 4x cold start: the WASM engine did not initialize; the page fell back to TypeScript");
    const none = good().map((r) => ({ ...r, cold4x: null }));
    expect(validateResults(config({ throttles: [1] }), none, [node()]).errors).toEqual([]);
  });

  it("warns on a first visit that ran on the other engine or logged errors", () => {
    const runs = good();
    runs[1].firstVisitWithServiceWorker = { ...runs[1].firstVisitWithServiceWorker!, onlineEngineActive: "ts", onlinePageErrors: ["console: [wasm] the engine package did not load"] };
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual(expect.arrayContaining(["rep 0 wasm: the service worker first visit ran on ts; its bytes are left out", "rep 0 wasm: the service worker first visit logged 1 page error(s), first: console: [wasm] the engine package did not load"]));
  });

  it("fails a frame window where the simulation did not advance, and a late WASM host", () => {
    const runs = good();
    runs[0].scenarios.small.frames["1"].ticks = 0;
    runs[1].cold = { ...runs[1].cold!, engineHostedMs: 400 };
    runs[2].warm = { ...runs[2].warm!, engineHostedMs: null };
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(
      expect.arrayContaining(["rep 0 ts: small frames at 1x: the simulation did not advance during the window (0 ticks)", "rep 0 wasm: cold start: the engine was not hosted by the time the game was ready (hosted 400, ready 300)", "rep 1 wasm: warm start: the engine was not hosted by the time the game was ready (hosted never, ready 300)"]),
    );
  });

  it("fails audio-on frames without a running context, an attribution pass with no export call, and a throttle that did not hold", () => {
    const runs = good();
    runs[1].audio = { started: true, muted: false, contexts: ["suspended"] };
    runs[2].scenarios.small.hosted["1"].attribution = { engineTickMs: 1, engineExportMs: 0, hostJsMs: 1, wrappedTotalMs: 2, merges: 1, engineTicks: 10, exportCalls: 0, exportsWrapped: 40 };
    runs[0].cpuProbe = { unthrottledMs: 50, throttledMs: 60, rate: 4, timed: {} };
    const v = validateResults(config(), runs, [node()]);
    expect(v.errors).toEqual(expect.arrayContaining(["rep 0 wasm: audio-on frames ran with no running AudioContext (suspended)", "rep 1 wasm: small 1x: the attribution pass saw no export call, so its host JS share would include engine time"]));
    expect(v.errors.some((w) => w.startsWith("rep 0 ts: the CPU probe ran 60 ms under the 4x throttle against 50 ms without it; the throttled cold start"))).toBe(true);
    const throttled = good();
    throttled[1].cpuProbe = { unthrottledMs: 50, throttledMs: 200, rate: 4, timed: { "small:4": 70, "frames-off:4": 200 } };
    const t = validateResults(config({ throttles: [1, 4] }), throttled, [node()]);
    expect(t.errors.some((e) => e.startsWith("rep 0 wasm: the CPU probe ran 70 ms under the 4x throttle of small"))).toBe(true);
    expect(t.errors).toEqual(expect.arrayContaining(["rep 0 ts: no CPU probe confirms the 4x throttle of small", "rep 0 wasm: no CPU probe confirms the 4x throttle of frames-on"]));
  });
});

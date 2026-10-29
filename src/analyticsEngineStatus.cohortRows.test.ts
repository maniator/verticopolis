import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession } from "./analytics";
import { MAX_ENGINE_STATUS_ROWS, cohortRows, noteEngineAttempt, noteEngineEngaged, noteEngineFallback, noteEngineSettled } from "./analyticsEngineStatus";
import { COHORT_TELEMETRY } from "./engineCohort/config";

/** #1090's `attempt` and `engaged` rows: once each per page life, outside the
 *  cap, and only with the cohort's fields switched on. */

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

type Row = Record<string, unknown>;
const rows = (): Row[] =>
  vi
    .mocked(sendToRelay)
    .mock.calls.filter(([name]) => name === "engine_status")
    .map(([, props]) => props as Row);

const attempt = { build: "switchable", requested: "wasm" } as const;
const settle = { build: "switchable", requested: "wasm", failure: null } as const;

describe("the attempt and engaged rows", () => {
  beforeEach(() => {
    window.location.href = "https://verticopolis.com/";
    gameplaySession.reset();
    vi.mocked(sendToRelay).mockReset();
    cohortRows.on = true;
  });
  afterEach(() => {
    cohortRows.on = COHORT_TELEMETRY;
    window.location.href = "http://localhost:3000/";
  });

  it("follow the cohort's fields switch", () => {
    cohortRows.on = false;
    noteEngineAttempt(attempt);
    noteEngineSettled(settle);
    noteEngineEngaged("command");
    expect(rows().map((r) => r.trigger)).toEqual(["settle"]);
  });

  it("send one attempt row before settle, carrying the settle row's fields as they stand", () => {
    noteEngineAttempt(attempt);
    noteEngineAttempt(attempt);
    noteEngineSettled(settle);
    const [first, second] = rows();
    expect(rows()).toHaveLength(2);
    expect(first).toMatchObject({ trigger: "attempt", engine_requested: "wasm", engine: "wasm", build: "switchable", fallback_reason: "none", fallback_stage: "none", fallbacks: 0 });
    expect(first).not.toHaveProperty("engaged_by");
    expect(first.page_life).toBe(second.page_life);
  });

  it("send one engaged row after settle, naming the engine then and the branch", () => {
    noteEngineEngaged("play");
    expect(rows()).toHaveLength(0);
    noteEngineSettled(settle);
    noteEngineFallback({ reason: "trap-tick", stage: "start" });
    noteEngineEngaged("play");
    noteEngineEngaged("command");
    const engaged = rows().filter((r) => r.trigger === "engaged");
    expect(engaged).toHaveLength(1);
    expect(engaged[0]).toMatchObject({ engine: "ts-fallback", engaged_by: "play" });
    expect(rows().filter((r) => r.trigger !== "engaged").every((r) => !("engaged_by" in r))).toBe(true);
  });

  it("are never dropped by the cap", () => {
    noteEngineAttempt(attempt);
    noteEngineSettled(settle);
    for (let i = 0; i <= MAX_ENGINE_STATUS_ROWS + 2; i++) noteEngineFallback({ reason: "trap-tick", stage: "start" });
    noteEngineEngaged("command");
    expect(rows().filter((r) => r.trigger === "attempt")).toHaveLength(1);
    expect(rows().filter((r) => r.trigger === "engaged")).toHaveLength(1);
  });
});

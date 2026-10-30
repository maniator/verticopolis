import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../analyticsEngineStatus", () => ({ noteEngineEngaged: vi.fn() }));
import { noteEngineEngaged } from "../../analyticsEngineStatus";
import { PLAY_SECONDS } from "../../analyticsEngagement";
import { TsEngine } from "../../engine/port/tsEngine";
import type { Simulation } from "../../engine/Simulation";
import { startEngagementWatch } from "../../game/engagementWatch";
import type { EnginePort } from "../../simport/enginePort";
import { kind, lobbyCenter, subject, type MakeEngine } from "../../simport/engineSubject.fixture";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

/**
 * The engagement parity test (#1090, the analytics packet's section 6): one
 * detector above the host, so a scripted session engages the TypeScript and
 * the Rust engine at the same point, by the same branch.
 */

type RustEngine = EnginePort & { free(): void };
const made: RustEngine[] = [];

const engines: [string, MakeEngine][] = [["TypeScript", (sim: Simulation) => new TsEngine(sim)]];
if (hasWasmPackage())
  engines.push([
    "Rust",
    (sim: Simulation) => {
      const engine = wasm().Engine.fromSave(JSON.stringify(sim.serialize())) as unknown as RustEngine;
      made.push(engine);
      return engine;
    },
  ]);

describe.each(engines)("engagement on the %s engine", (_name, make) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(noteEngineEngaged).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const e of made.splice(0)) e.free();
  });

  it("engages on the first accepted gameplay command, not on a refused one or a rename", () => {
    const s = subject(make);
    startEngagementWatch(s.port, () => s.reader.header.minutes);
    expect(s.port.buildAt(kind("office"), 2, -50)[0]).toBe(0);
    s.port.nameTower("Parity");
    expect(noteEngineEngaged).not.toHaveBeenCalled();
    expect(s.port.buildAt(kind("office"), 2, lobbyCenter(s) - 4)[0]).toBe(1);
    expect(s.port.buildAt(kind("office"), 2, lobbyCenter(s) + 6)[0]).toBe(1);
    expect(vi.mocked(noteEngineEngaged).mock.calls).toEqual([["command"]]);
  });

  it("engages after 30 seconds of play with the clock moving, and not while it stands still", () => {
    const s = subject(make);
    startEngagementWatch(s.port, () => s.reader.header.minutes);
    vi.advanceTimersByTime(PLAY_SECONDS * 3 * 1000);
    expect(noteEngineEngaged).not.toHaveBeenCalled();
    for (let second = 0; second <= PLAY_SECONDS; second++) {
      s.port.tick(1);
      s.reader.update();
      vi.advanceTimersByTime(1000);
    }
    expect(vi.mocked(noteEngineEngaged).mock.calls).toEqual([["play"]]);
  });
});

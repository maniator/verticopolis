import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../analyticsEngineStatus", () => ({ noteEngineEngaged: vi.fn() }));
import { noteEngineEngaged } from "../../analyticsEngineStatus";
import { PLAY_SECONDS } from "../../analyticsEngagement";
import { startEngagementWatch } from "../../game/engagementWatch";
import type { EnginePort } from "../../simport/enginePort";
import { kind, lobbyCenter, subject, type MakeEngine } from "../../simport/engineSubject.fixture";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { releaseDrafts } from "../portKit/drafts";

/**
 * The engagement test (#1090, the analytics packet's section 6): one detector
 * above the host, so a scripted session on the engine engages at the point
 * and by the branch the packet names.
 */
if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type RustEngine = EnginePort & { free(): void };
const made: RustEngine[] = [];

const make: MakeEngine = (save) => {
  const engine = wasm().Engine.fromSave(save) as unknown as RustEngine;
  made.push(engine);
  return engine;
};

describe.skipIf(!hasWasmPackage())("engagement on the engine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(noteEngineEngaged).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const e of made.splice(0)) e.free();
    releaseDrafts();
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

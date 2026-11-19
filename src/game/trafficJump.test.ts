import { describe, it, expect, vi, beforeEach } from "vitest";
import { JUMP_ZOOM, jumpFrame, jumpToTraffic, lineSpan, wireTrafficJump } from "./trafficHud";
import { trafficSpotlightFloor } from "@verticopolis/components/render/excalibur/trafficSpotlight";
import type { TransportView } from "@verticopolis/components/port/view";
import type { GameApp } from "../main";

const track = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ trackAppAction: track }));
const spot = vi.hoisted(() => vi.fn());
vi.mock("@verticopolis/components/render/excalibur/trafficSpotlight", async (real) => {
  const mod = await real<typeof import("@verticopolis/components/render/excalibur/trafficSpotlight")>();
  return { ...mod, spotlightTraffic: vi.fn((...a: Parameters<typeof mod.spotlightTraffic>) => (spot(...a), mod.spotlightTraffic(...a))) };
});

/**
 * Unit coverage for a tap on the Traffic readout (`jumpToTraffic`, owner's
 * report 2026-11-17: the old tap "highlighted the whole floor, not where the
 * jam is"). The renderer's queue projection and the port's `queueLine` are
 * spies answering the lines and their stretches, the camera a spy over a tower
 * with two elevators; the tests assert what the code reads and what it does
 * with the answers: it goes to the worst line, and marks that one line only.
 */

const elevator = (id: number, x: number) => ({ id, kind: "elevatorStandard", x, width: 4, bottom: -6, top: 30 }) as unknown as TransportView;
const ELEVATORS = [elevator(7, 40), elevator(9, 60)];
const SHAFTS = new Map(ELEVATORS.map((t) => [t.id, t]));

type Row = [shaft: number, floor: number, count: number, tier: 0 | 1 | 2];

/** `stretches` answers `queueLine` per "shaft:floor"; any other landing has
 *  an empty line. */
function fakeApp(tier: number, rows: Row[], stretches: Record<string, [number, number]> = {}) {
  const landings = new Map<number, Map<number, { count: number; tier: 0 | 1 | 2 }>>();
  for (const [shaft, floor, count, t] of rows) {
    if (!landings.has(shaft)) landings.set(shaft, new Map());
    landings.get(shaft)!.set(floor, { count, tier: t });
  }
  const queueView = vi.fn(() => ({ landings, boarded: new Map() }));
  const applyView = vi.fn();
  const engine = {
    sim: { tower: { getTransport: (id: number) => SHAFTS.get(id), transports: ELEVATORS }, crowd: { people: [], queueView } },
    viewWidth: 1280,
    applyView,
  };
  const queueLine = vi.fn((shaft: number, floor: number) => new Float64Array(stretches[`${shaft}:${floor}`] ?? []));
  const app = { lastTrafficTier: tier, engine, enginePort: { queueLine } };
  return { app: app as unknown as GameApp, queueView, queueLine, applyView, engine };
}

beforeEach(() => {
  track.mockClear();
  spot.mockClear();
  document.body.innerHTML = `<span id="traffic" role="button" tabindex="0"></span>`;
});

describe("jumpToTraffic", () => {
  it("goes to the worst line and marks that landing only, not the floor or the other shafts", () => {
    // 288 fed up at B4 for elevator 9; a short line at 25F for elevator 7.
    const f = fakeApp(3, [
      [7, 25, 6, 2],
      [9, -4, 288, 2],
    ], { "9:-4": [64, 70.2], "7:25": [44, 45] });
    expect(jumpToTraffic(f.app)).toBe(true);
    // The engine's stretch of that one line is asked for, not the floor's.
    expect(f.queueLine).toHaveBeenCalledWith(9, -4);
    expect(f.queueLine).toHaveBeenCalledTimes(1);
    // The band runs from elevator 9's left face (60) to the end of the last rider (72),
    // half a floor down so B4's row (-4) sits in the middle, zoomed close.
    expect(f.applyView).toHaveBeenCalledWith({ tile: 66, floor: -4.5, zoom: JUMP_ZOOM });
    expect(spot).toHaveBeenCalledWith(f.engine, -4, { x: 60, width: 12 }, { x: 60, width: 4 });
    expect(trafficSpotlightFloor(f.engine as unknown as GameApp["engine"])).toBe(-4);
    expect(track).toHaveBeenCalledWith("traffic_jump", "gridlock");
  });

  it("does nothing while the readout says Smooth, or once the line has gone", () => {
    const smooth = fakeApp(0, [[7, 12, 40, 2]]);
    expect(jumpToTraffic(smooth.app)).toBe(false);
    expect(smooth.queueView).not.toHaveBeenCalled();
    const gone = fakeApp(2, [[7, 12, 40, 0]]);
    expect(jumpToTraffic(gone.app)).toBe(false);
    const unknown = fakeApp(2, [[5, 12, 40, 2]]);
    expect(jumpToTraffic(unknown.app)).toBe(false);
    // The step's projection still lists the line, but everyone has boarded
    // since: the engine's stretch is empty, so nothing moves or is counted.
    const boarded = fakeApp(2, [[7, 12, 40, 2]]);
    expect(jumpToTraffic(boarded.app)).toBe(false);
    expect(boarded.queueLine).toHaveBeenCalledWith(7, 12);
    for (const f of [smooth, gone, unknown, boarded]) expect(f.applyView).not.toHaveBeenCalled();
    expect(spot).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("answers a click, Enter and Space on the readout", () => {
    const f = fakeApp(2, [[7, 3, 25, 2]], { "7:3": [44, 70] });
    wireTrafficJump(f.app);
    const el = document.getElementById("traffic")!;
    el.click();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(f.applyView).toHaveBeenCalledTimes(3);
  });
});

describe("lineSpan", () => {
  it("follows the engine's line across the elevator beside it, in a bank of shafts", () => {
    // Elevator 7 (x 40 to 43) lines up to the right past elevator 9's spot:
    // the band is the line, not the shaft alone or the nearest-shaft guess.
    expect(lineSpan(SHAFTS.get(7)!, new Float64Array([44, 66.1]))).toEqual({ x: 40, width: 28 });
  });

  it("covers a line that runs left from the shaft's left face", () => {
    expect(lineSpan(SHAFTS.get(9)!, new Float64Array([47.3, 60]))).toEqual({ x: 47, width: 17 });
  });

  it("is the shaft alone when its line has emptied", () => {
    expect(lineSpan(SHAFTS.get(9)!, new Float64Array([]))).toEqual({ x: 60, width: 4 });
  });
});

describe("jumpFrame", () => {
  it("comes in close on a short line and only as close as shows a long one", () => {
    // A 4-tile shaft plus 4 tiles a side fits 1280 pixels well past JUMP_ZOOM.
    expect(jumpFrame({ x: 4, width: 4 }, 1280)).toEqual({ tile: 6, zoom: JUMP_ZOOM });
    // A 300-tile stretch plus 8 margin tiles is 3080 pixels at zoom 1.
    expect(jumpFrame({ x: 4, width: 300 }, 1280)).toEqual({ tile: 154, zoom: 1280 / 3080 });
  });
});

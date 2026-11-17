import { describe, it, expect, vi, beforeEach } from "vitest";
import { JUMP_ZOOM, jumpFrame, jumpToTraffic, wireTrafficJump } from "./trafficHud";
import { trafficSpotlightFloor } from "../render/excalibur/trafficSpotlight";
import { mockPort } from "../tests/portKit/mockPort";
import { PortCodes } from "../simport/portCodes";
import type { GameApp } from "../main";

const track = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ trackAppAction: track }));

/**
 * Unit coverage for a tap on the Traffic readout (`jumpToTraffic`): the engine
 * port is a set of `vi.fn` spies answering the hotspot and its cause, the
 * renderer a spy camera over a tower with two shafts. The tests assert what
 * the code asks the port and what it does with the answers.
 */

const SHAFTS = new Map([
  [7, { id: 7, x: 40, width: 4, bottom: -6, top: 30 }],
  [9, { id: 9, x: 60, width: 4, bottom: -6, top: 30 }],
]);

function fakeApp(tier: number, floor: number, cause: number[]) {
  const hotspot = vi.fn(() => Float64Array.of(1.09, floor));
  const congestionCause = vi.fn(() => Float64Array.from(cause));
  const applyView = vi.fn();
  const engine = {
    sim: { tower: { getTransport: (id: number) => SHAFTS.get(id) } },
    viewState: () => ({ tile: 123, floor: 5, zoom: 0.5 }),
    viewWidth: 1280,
    applyView,
  };
  const app = {
    enginePort: { hotspot, congestionCause },
    portCodes: new PortCodes(mockPort()),
    lastTrafficTier: tier,
    engine,
  };
  return { app: app as unknown as GameApp, hotspot, congestionCause, applyView, engine };
}

beforeEach(() => {
  track.mockClear();
  document.body.innerHTML = `<span id="traffic" role="button" tabindex="0"></span>`;
});

describe("jumpToTraffic", () => {
  it("centers and zooms in on the named floor across its cause and lights them up", () => {
    const f = fakeApp(2, -1, [7, 9]);
    expect(jumpToTraffic(f.app)).toBe(true);
    expect(f.congestionCause).toHaveBeenCalledWith(-1);
    // Between the left edge of shaft 7 (40) and the right edge of shaft 9
    // (64), and half a floor down so B2's row sits in the middle. The two
    // shafts and their margins (24 + 16 tiles) fit 1280 pixels at 3.2, so
    // the jump comes in to its own close zoom.
    expect(f.applyView).toHaveBeenCalledWith({ tile: 52, floor: -1.5, zoom: JUMP_ZOOM });
    expect(trafficSpotlightFloor(f.engine as unknown as GameApp["engine"])).toBe(-1);
    expect(track).toHaveBeenCalledWith("traffic_jump", "shafts");
  });

  it("keeps the camera's column when the engine names no cause", () => {
    const f = fakeApp(1, 44, []);
    expect(jumpToTraffic(f.app)).toBe(true);
    expect(f.applyView).toHaveBeenCalledWith({ tile: 123, floor: 43.5, zoom: JUMP_ZOOM });
    expect(track).toHaveBeenCalledWith("traffic_jump", "none");
  });

  it("does nothing while the readout says Smooth, or with no hotspot", () => {
    const smooth = fakeApp(0, 12, [7]);
    expect(jumpToTraffic(smooth.app)).toBe(false);
    expect(smooth.hotspot).not.toHaveBeenCalled();
    const none = fakeApp(2, NaN, [7]);
    expect(jumpToTraffic(none.app)).toBe(false);
    expect(none.congestionCause).not.toHaveBeenCalled();
    expect(none.applyView).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("zooms only as far in as still shows every transport behind the reading", () => {
    // Two elevators at the lot's two ends: 4..304 plus 8 tiles a side is 316
    // tiles, 3160 pixels, so a 1280-pixel view fits them at 1280 / 3160.
    const wide = [
      { x: 4, width: 4, bottom: 1, top: 30 },
      { x: 300, width: 4, bottom: 1, top: 30 },
    ];
    expect(jumpFrame(wide, 0, 1280)).toEqual({ tile: 154, zoom: 1280 / 3160 });
    // One narrow shaft never goes past the jump's close zoom.
    expect(jumpFrame([wide[0]], 0, 1280)).toEqual({ tile: 6, zoom: JUMP_ZOOM });
    // No transport: the camera's own column, zoomed in.
    expect(jumpFrame([], 77, 1280)).toEqual({ tile: 77, zoom: JUMP_ZOOM });
  });

  it("answers a click, Enter and Space on the readout", () => {
    const f = fakeApp(2, 3, [7]);
    wireTrafficJump(f.app);
    const el = document.getElementById("traffic")!;
    el.click();
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(f.applyView).toHaveBeenCalledTimes(3);
  });
});

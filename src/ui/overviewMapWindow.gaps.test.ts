import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeRigs, rig, silent2d } from "./overviewMapWindow.fixture";

beforeEach(() => vi.restoreAllMocks());
afterEach(() => disposeRigs());

describe("overview map window: gaps between buildings", () => {
  it("clears the open air between two towers at least four CSS pixels wide, at any pixel ratio", () => {
    const ctx = Object.assign(silent2d(), { fillRect: vi.fn(), clearRect: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const r = rig();
    // Two towers on floor 1 with two tiles of open ground between them: under
    // a pixel of map at this scale.
    r.source.view = {
      ...r.source.view,
      structure: [
        { kind: "lobby", floor: 1, x: 100, width: 1, count: 50 },
        { kind: "lobby", floor: 1, x: 152, width: 1, count: 50 },
      ],
    };
    const gapWidths = () => ctx.clearRect.mock.calls.filter(([x]) => x > 0).map(([, , w]) => w as number);
    ctx.clearRect.mockClear();
    r.win.frame();
    expect(gapWidths()).toEqual([4]);
    vi.spyOn(window, "devicePixelRatio", "get").mockReturnValue(2);
    ctx.clearRect.mockClear();
    r.win.frame();
    expect(gapWidths()).toEqual([8]);
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { MAP_TAP_SLOP_CSS, MAP_TOUCH_TARGET_CSS } from "@verticopolis/components/windows/overviewMapInput";
import type { MapTap } from "./overviewMapDeps";
import { CROP, disposeRigs, mapX, mapY, pointer, rig, viewCanvas } from "./overviewMapWindow.fixture";

beforeEach(() => vi.restoreAllMocks());
afterEach(() => disposeRigs());

describe("overview map window: a tap opens a card", () => {
  it("tells the game where a click landed, after moving the view there", () => {
    const order: string[] = [];
    const taps: MapTap[] = [];
    const r = rig({
      tapped: (tap) => {
        order.push(`tap after ${r.moves.length} move`);
        taps.push(tap);
      },
    });
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26)));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300) + 2, mapY(26)));
    expect(order).toEqual(["tap after 1 move"]);
    expect(taps[0].x).toBeCloseTo(mapX(300) + 2);
    expect(taps[0].y).toBeCloseTo(mapY(26));
    expect(taps[0].layout.extent).toEqual(CROP);
    expect(taps[0].reach).toBe(MAP_TAP_SLOP_CSS);
  });

  it("gives a finger half a touch target of reach", () => {
    const taps: MapTap[] = [];
    rig({ tapped: (tap) => taps.push(tap) });
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch"));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "touch"));
    expect(taps.map((t) => t.reach)).toEqual([MAP_TOUCH_TARGET_CSS / 2]);
  });

  it("says nothing for a drag, a cancel or a right click", () => {
    const tapped = vi.fn();
    rig({ tapped });
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26)));
    viewCanvas().dispatchEvent(pointer("pointermove", mapX(300) + 20, mapY(26)));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300) + 20, mapY(26)));
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "touch", 2));
    viewCanvas().dispatchEvent(pointer("pointercancel", mapX(300), mapY(26), "touch", 2));
    viewCanvas().dispatchEvent(pointer("pointerdown", mapX(300), mapY(26), "mouse", 3, 2));
    viewCanvas().dispatchEvent(pointer("pointerup", mapX(300), mapY(26), "mouse", 3, 2));
    expect(tapped).not.toHaveBeenCalled();
  });
});

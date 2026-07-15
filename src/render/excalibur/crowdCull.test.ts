import { describe, it, expect } from "vitest";
import { crowdCullNext, CROWD_CULL_ZOOM, CROWD_SHOW_ZOOM } from "./crowdCull";

/**
 * The zoom-cull hysteresis step (CAP-1 of the mobile render-perf spec,
 * `_bmad-output/specs/spec-render-perf-mobile-zoom/`). Pure math: the wiring
 * (skipping updateMotion/reconcileCrowd, hiding the moving layer, re-asserting
 * after a structural rebuild) stays on the Playwright tier because it bakes
 * canvases.
 */

describe("crowdCullNext hysteresis", () => {
  it("hides below the cull threshold and shows above the re-show threshold", () => {
    expect(crowdCullNext(CROWD_CULL_ZOOM - 0.01, false)).toBe(true);
    expect(crowdCullNext(CROWD_SHOW_ZOOM + 0.01, true)).toBe(false);
  });

  it("keeps the visible state inside the hysteresis band (no strobing)", () => {
    const mid = (CROWD_CULL_ZOOM + CROWD_SHOW_ZOOM) / 2;
    expect(crowdCullNext(mid, false)).toBe(false); // visible stays visible
    expect(crowdCullNext(mid, true)).toBe(true); // culled stays culled
  });

  it("at the exact thresholds: a visible layer stays visible, a culled one re-shows", () => {
    expect(crowdCullNext(CROWD_CULL_ZOOM, false)).toBe(false); // hide only strictly below
    expect(crowdCullNext(CROWD_SHOW_ZOOM, true)).toBe(false); // re-show from the threshold up
  });

  it("the re-show threshold sits strictly above the hide threshold", () => {
    // The hysteresis only exists if the band is real; a maintainer collapsing
    // the two constants would silently reintroduce boundary strobing.
    expect(CROWD_SHOW_ZOOM).toBeGreaterThan(CROWD_CULL_ZOOM);
  });

  it("a full pinch sweep across the band flips exactly twice", () => {
    const sweep = [0.2, 0.17, 0.15, 0.13, 0.12, 0.11, 0.12, 0.13, 0.15, 0.17, 0.2];
    let culled = false;
    const flips: number[] = [];
    for (const z of sweep) {
      const next = crowdCullNext(z, culled);
      if (next !== culled) flips.push(z);
      culled = next;
    }
    expect(flips).toEqual([0.12, 0.17]); // one hide on the way out, one show on the way back
  });
});

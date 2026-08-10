import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebugHud, emptyReading, type HudSource } from "./debugHud";
import { beginSimTick, endSimTick, setSimTimingEnabled } from "./simTimer";
import type { FrameStatsLike } from "./debugMetrics";

/** A controllable stand-in for the two engines the panel reads. The structural
 *  port is the whole point: no Excalibur, no WebGL, no TowerEngine here. */
function makeSource(overrides: Partial<HudSource> = {}): HudSource & { fire(): void; subscribers: number } {
  const handlers: (() => void)[] = [];
  const stats: FrameStatsLike = {
    fps: 60,
    duration: { update: 3, draw: 5, total: 8 },
    graphics: { drawCalls: 42, drawnImages: 900, rendererSwaps: 4 },
    actors: { alive: 100, total: 105 },
    systemDuration: { "draw:GraphicsSystem.update": 4.5, "update:MotionSystem.update": 0.8 },
  };
  const base: HudSource = {
    onFrame(handler) {
      handlers.push(handler);
      return () => {
        const i = handlers.indexOf(handler);
        if (i >= 0) handlers.splice(i, 1);
      };
    },
    frameStats: () => stats,
    fpsPercentiles: () => ({ p50: 58, p5: 31, samples: 400 }),
    zoom: () => 0.25,
    crowdCulled: () => false,
    drawOn: () => false,
  };
  const source = { ...base, ...overrides };
  return {
    ...source,
    fire: () => handlers.slice().forEach((h) => h()),
    get subscribers() {
      return handlers.length;
    },
  };
}

const hudText = (): string => document.getElementById("debug-hud")?.textContent ?? "";
const hudHost = (): HTMLElement | null => document.getElementById("debug-hud-host");

describe("createDebugHud", () => {
  let clock: number;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clock = 10_000;
    nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    setSimTimingEnabled(false);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    setSimTimingEnabled(false);
    document.body.innerHTML = "";
  });

  it("starts hidden and mounts nothing until shown", () => {
    const hud = createDebugHud(makeSource());
    expect(hud.visible()).toBe(false);
    expect(hudHost()).toBeNull();
    hud.dispose();
  });

  it("mounts into its own child of body, not into the stage", () => {
    // A fixed-position panel inside #stage would be captured by any transformed
    // ancestor, so the host must be a direct child of body.
    document.body.innerHTML = `<div id="stage"></div>`;
    const hud = createDebugHud(makeSource());
    hud.setVisible(true);
    expect(hudHost()?.parentElement).toBe(document.body);
    expect(document.getElementById("stage")?.contains(hudHost())).toBe(false);
    hud.dispose();
  });

  it("paints immediately on show rather than waiting for a frame", () => {
    const hud = createDebugHud(makeSource());
    hud.setVisible(true);
    expect(hudText()).toContain("fps");
    hud.dispose();
  });

  it("renders the frame numbers, the percentiles, and the top systems", () => {
    const hud = createDebugHud(makeSource());
    hud.setVisible(true);
    const text = hudText();
    expect(text).toContain("60"); // instantaneous fps
    expect(text).toContain("p50 58");
    expect(text).toContain("p5 31");
    expect(text).toContain("42 calls");
    expect(text).toContain("900 imgs");
    expect(text).toContain("4 swaps");
    expect(text).toContain("100 alive / 105 total");
    expect(text).toContain("draw:GraphicsSystem");
    hud.dispose();
  });

  it("shows placeholders for percentiles before enough frames are sampled", () => {
    const hud = createDebugHud(makeSource({ fpsPercentiles: () => null }));
    hud.setVisible(true);
    expect(hudText()).toContain("p50 —");
    hud.dispose();
  });

  it("throttles repaints to the refresh period", () => {
    const source = makeSource();
    const hud = createDebugHud(source);
    hud.setVisible(true);
    const first = hud.reading();
    clock += 10; // a frame later, well inside the throttle
    source.fire();
    expect(hud.reading()).toBe(first); // no new reading taken
    clock += 300; // past the refresh period
    source.fire();
    expect(hud.reading()).not.toBe(first);
    hud.dispose();
  });

  it("takes no readings at all while hidden", () => {
    const stats = vi.fn(() => undefined);
    const source = makeSource({ frameStats: stats });
    const hud = createDebugHud(source);
    clock += 5_000;
    source.fire();
    expect(stats).not.toHaveBeenCalled();
    hud.dispose();
  });

  it("removes the panel when hidden and restores it when shown again", () => {
    const hud = createDebugHud(makeSource());
    hud.setVisible(true);
    expect(hudHost()).not.toBeNull();
    hud.setVisible(false);
    expect(hudHost()).toBeNull();
    hud.setVisible(true);
    expect(hudHost()).not.toBeNull();
    hud.dispose();
  });

  it("flags inflated counters while geometry draw is on", () => {
    // Debug draw goes through the graphics context, so it adds to the very
    // drawCalls/rendererSwaps numbers shown above it. Say so rather than
    // letting the reader trust them.
    const hud = createDebugHud(makeSource({ drawOn: () => true }));
    hud.setVisible(true);
    expect(hudText()).toContain("inflated");
    hud.dispose();
  });

  it("says when the crowd layer is zoom-culled", () => {
    const hud = createDebugHud(makeSource({ crowdCulled: () => true, zoom: () => 0.1 }));
    hud.setVisible(true);
    expect(hudText()).toContain("crowd CULLED");
    expect(hudText()).toContain("0.100");
    hud.dispose();
  });

  it("samples on demand regardless of the throttle", () => {
    const hud = createDebugHud(makeSource());
    const reading = hud.sample();
    expect(reading.frame.drawCalls).toBe(42);
    expect(hud.visible()).toBe(false); // sampling does not mount anything
    hud.dispose();
  });

  it("does not let an on-demand sample steal the panel's sim peak", () => {
    // Regression: `sample()` used to consume the peak, so calling
    // `vcdebug.stats()` while the panel ran zeroed whichever asked second.
    setSimTimingEnabled(true);
    const start = beginSimTick();
    clock += 12;
    endSimTick(start);
    const hud = createDebugHud(makeSource());
    expect(hud.sample().simPeakMs).toBe(12);
    expect(hud.sample().simPeakMs).toBe(12);
    hud.setVisible(true); // the panel's own refresh window DOES clear it
    expect(hud.reading().simPeakMs).toBe(12);
    expect(hud.sample().simPeakMs).toBe(0);
    hud.dispose();
  });

  it("does not retain Excalibur's reused stats instance", () => {
    const stats: FrameStatsLike = { fps: 60, graphics: { drawCalls: 1 } };
    const hud = createDebugHud(makeSource({ frameStats: () => stats }));
    const reading = hud.sample();
    stats.graphics!.drawCalls = 999; // the engine reuses and overwrites it
    expect(reading.frame.drawCalls).toBe(1);
    hud.dispose();
  });

  it("unsubscribes and removes itself on dispose", () => {
    const source = makeSource();
    const hud = createDebugHud(source);
    hud.setVisible(true);
    expect(source.subscribers).toBe(1);
    hud.dispose();
    expect(source.subscribers).toBe(0);
    expect(hudHost()).toBeNull();
    expect(hud.visible()).toBe(false);
  });

  it("survives an engine that reports no stats yet", () => {
    const hud = createDebugHud(makeSource({ frameStats: () => undefined }));
    hud.setVisible(true);
    // Zeroes rather than NaN or "undefined" on the panel.
    expect(hudText()).toContain("0 calls");
    hud.dispose();
  });

  it("re-mounts on the next refresh if something removed its host", () => {
    const source = makeSource();
    const hud = createDebugHud(source);
    hud.setVisible(true);
    hudHost()!.remove(); // e.g. a devtools delete, or a stray innerHTML wipe
    expect(hudHost()).toBeNull();
    clock += 300; // past the refresh period
    source.fire();
    expect(hudHost()).not.toBeNull();
    expect(hudText()).toContain("42 calls");
    hud.dispose();
  });
});

describe("emptyReading", () => {
  it("is all zeroes with no percentiles", () => {
    const r = emptyReading();
    expect(r.frame.fps).toBe(0);
    expect(r.fps).toBeNull();
    expect(r.crowdCulled).toBe(false);
  });
});

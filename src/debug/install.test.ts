import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installDebug, type DebugTarget } from "./index";
import { DEBUG_SECTIONS, noDebugFlags, parseDebugTokens, writeStoredSpec } from "./debugFlags";
import { isSimTimingEnabled } from "./simTimer";
import type { DebugConsole } from "./debugConsole";

/** A stand-in for `GameApp` + `TowerEngine` + `ex.Engine`, shaped exactly like
 *  the structural port. No WebGL, no Excalibur. */
function target(): DebugTarget & {
  fire(): void;
  handlers: number;
  debugOn: boolean;
  sections: Record<string, { showAll: boolean }>;
} {
  const handlers: (() => void)[] = [];
  const sections = Object.fromEntries(DEBUG_SECTIONS.map((s) => [s, { showAll: false }]));
  const t = {
    debugOn: false,
    sections,
    engine: {
      engine: {
        on: (_e: "postframe", h: () => void) => void handlers.push(h),
        off: (_e: "postframe", h: () => void) => {
          const i = handlers.indexOf(h);
          if (i >= 0) handlers.splice(i, 1);
        },
        stats: { currFrame: { fps: 60, systemDuration: { "draw:GraphicsSystem.update": 3 } } },
        debug: { filter: { useFilter: false, nameQuery: "", ids: [] }, ...sections },
        showDebug: (on: boolean) => {
          t.debugOn = on;
        },
      },
      cam: { zoom: 0.5 },
      crowdCulled: false,
    },
    sim: { money: 1000 },
    setSpeed: vi.fn(),
    fire: () => handlers.slice().forEach((h) => h()),
    get handlers() {
      return handlers.length;
    },
  };
  return t as unknown as DebugTarget & {
    fire(): void;
    handlers: number;
    debugOn: boolean;
    sections: Record<string, { showAll: boolean }>;
  };
}

const vcdebug = (): DebugConsole | undefined => (globalThis as Record<string, unknown>).vcdebug as DebugConsole | undefined;

/** A controllable requestAnimationFrame. The HUD schedules the next frame from
 *  inside its own callback, so a real rAF would either never fire under
 *  happy-dom or spin; this lets a test step exactly one frame. */
const rafCallbacks = new Map<number, FrameRequestCallback>();
let rafId = 0;
let clock = 0;

/** Run every callback queued right now, once. Callbacks that re-queue land in
 *  the next batch rather than this one, so this cannot loop forever. */
function runRafFrame(): void {
  const due = [...rafCallbacks.entries()];
  for (const [id, cb] of due) {
    rafCallbacks.delete(id);
    cb(clock);
  }
}

let nowSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    rafCallbacks.set(++rafId, cb);
    return rafId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number): void => void rafCallbacks.delete(id));
  // The HUD throttles on performance.now(), not on the rAF timestamp, so the
  // fake clock has to drive both or a test can never step past the refresh
  // period however many frames it runs.
  nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
});

afterAll(() => {
  nowSpy.mockRestore();
  vi.unstubAllGlobals();
});

afterEach(() => {
  rafCallbacks.clear();
  delete (globalThis as Record<string, unknown>).vcdebug;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("installDebug", () => {
  it("publishes window.vcdebug and turns on sim timing", () => {
    const t = target();
    const surface = installDebug(t, noDebugFlags());
    expect(vcdebug()).toBe(surface.console);
    expect(isSimTimingEnabled()).toBe(true);
    surface.dispose();
  });

  it("shows the HUD when the flags asked for it, and not otherwise", () => {
    const t = target();
    const off = installDebug(t, noDebugFlags());
    expect(off.hud.visible()).toBe(false);
    off.dispose();

    const on = installDebug(t, parseDebugTokens("fps"));
    expect(on.hud.visible()).toBe(true);
    expect(document.getElementById("debug-hud")).not.toBeNull();
    on.dispose();
  });

  it("applies launch draw sections to the engine and flips the master switch", () => {
    const t = target();
    const surface = installDebug(t, parseDebugTokens("draw:collider"));
    expect(t.engine.engine.debug.collider.showAll).toBe(true);
    expect(t.engine.engine.debug.motion.showAll).toBe(false);
    expect(t.debugOn).toBe(true);
    surface.dispose();
  });

  it("sets every section on each apply, so turning one off really turns it off", () => {
    const t = target();
    const surface = installDebug(t, parseDebugTokens("draw"));
    expect(t.engine.engine.debug.motion.showAll).toBe(true);
    surface.console.draw("collider");
    // Without the explicit clear, motion would stay latched from the first call.
    expect(t.engine.engine.debug.motion.showAll).toBe(false);
    expect(t.engine.engine.debug.collider.showAll).toBe(true);
    surface.dispose();
  });

  it("leaves debug draw off when no section was requested", () => {
    const t = target();
    const surface = installDebug(t, parseDebugTokens("fps"));
    expect(t.debugOn).toBe(false);
    surface.dispose();
  });

  it("applies a launch filter", () => {
    const t = target();
    const surface = installDebug(t, parseDebugTokens("draw,filter:person"));
    expect(t.engine.engine.debug.filter.useFilter).toBe(true);
    expect(t.engine.engine.debug.filter.nameQuery).toBe("person");
    surface.console.filter(false);
    expect(t.engine.engine.debug.filter.useFilter).toBe(false);
    surface.dispose();
  });

  it("warns about unknown launch tokens rather than ignoring them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const surface = installDebug(target(), parseDebugTokens("fps,wat"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("wat"));
    surface.dispose();
    warn.mockRestore();
  });

  it("drives the HUD from requestAnimationFrame, not the engine's event", () => {
    // Deliberately NOT `postframe`: that subscription belongs to one engine
    // instance, and a WebGL context-loss rebuild replaces it (see the swap test
    // below). rAF belongs to the page and survives.
    const t = target();
    const surface = installDebug(t, parseDebugTokens("fps"));
    expect(t.handlers).toBe(0); // nothing subscribed to the engine
    expect(rafCallbacks.size).toBe(1);
    runRafFrame();
    expect(document.getElementById("debug-hud")?.textContent).toContain("fps");
    surface.dispose();
    expect(rafCallbacks.size).toBe(0); // and the loop is cancelled
  });

  it("stops the frame loop even when disposed from inside a frame", () => {
    // Without the `stopped` latch the tick schedules its successor AFTER the
    // handler ran, so a dispose from within the handler leaks a frame the
    // already-returned unsubscribe can never cancel.
    const t = target();
    const surface = installDebug(t, parseDebugTokens("fps"));
    // Dispose from a value the frame handler actually reads, so the call really
    // lands mid-frame (patching the returned hud object would not: the handler
    // closes over its own internal sample).
    Object.defineProperty(t.engine, "crowdCulled", {
      configurable: true,
      get() {
        surface.dispose();
        return false;
      },
    });
    clock += 300;
    runRafFrame();
    expect(rafCallbacks.size).toBe(0);
  });

  it("survives a throw inside the frame handler instead of dying silently", () => {
    // One bad frame must not end all future updates: that failure would be
    // indistinguishable from the staleness bug the rAF loop exists to prevent.
    const t = target();
    const surface = installDebug(t, parseDebugTokens("fps"));
    let thrown = false;
    Object.defineProperty(t.engine, "crowdCulled", {
      configurable: true,
      get() {
        if (!thrown) {
          thrown = true;
          throw new Error("one bad frame");
        }
        return false;
      },
    });
    clock += 300;
    expect(() => runRafFrame()).toThrow("one bad frame");
    expect(rafCallbacks.size).toBe(1); // the loop rescheduled itself
    clock += 300;
    runRafFrame();
    expect(document.getElementById("debug-hud")?.textContent).toContain("fps");
    surface.dispose();
  });

  it("keeps working after the engine is rebuilt underneath it", () => {
    // The WebGL context-loss path does `app.engine = new TowerEngine(...)`.
    // Anything captured at install time would go silently stale: the panel
    // would freeze on its last pre-loss frame and `draw()` would report success
    // while setting flags on a discarded engine.
    const t = target();
    const surface = installDebug(t, parseDebugTokens("fps"));
    const rebuilt = target();
    rebuilt.engine.engine.stats.currFrame.graphics = { drawCalls: 777, drawnImages: 0, rendererSwaps: 0 };
    t.engine = rebuilt.engine; // the swap
    clock += 300;
    runRafFrame();
    expect(document.getElementById("debug-hud")?.textContent).toContain("777 calls");
    // And the console writes reach the NEW engine, not the discarded one.
    surface.console.draw("collider");
    expect(rebuilt.engine.engine.debug.collider.showAll).toBe(true);
    expect(rebuilt.debugOn).toBe(true);
    surface.dispose();
  });

  it("tells the HUD when geometry draw is on, so it can flag its own counters", () => {
    const t = target();
    const surface = installDebug(t, parseDebugTokens("fps"));
    expect(document.getElementById("debug-hud")?.textContent).not.toContain("inflated");
    surface.console.draw(true);
    surface.hud.setVisible(false);
    surface.hud.setVisible(true); // force a repaint
    expect(document.getElementById("debug-hud")?.textContent).toContain("inflated");
    surface.dispose();
  });

  it("reads its flags from the URL and storage when none are passed", () => {
    writeStoredSpec("draw:camera");
    const t = target();
    const surface = installDebug(t);
    expect(t.engine.engine.debug.camera.showAll).toBe(true);
    surface.dispose();
  });

  it("restores the engine and unpublishes on dispose", () => {
    const t = target();
    const surface = installDebug(t, parseDebugTokens("all,filter:person"));
    surface.dispose();
    expect(t.debugOn).toBe(false);
    expect(t.engine.engine.debug.camera.showAll).toBe(false);
    expect(t.engine.engine.debug.filter.useFilter).toBe(false);
    expect(isSimTimingEnabled()).toBe(false);
    expect(vcdebug()).toBeUndefined();
    expect(document.getElementById("debug-hud")).toBeNull();
  });

  it("does not mutate the caller's flag object", () => {
    const flags = parseDebugTokens("draw:motion");
    const surface = installDebug(target(), flags);
    surface.console.draw("camera");
    expect(flags.draw).toEqual(["motion"]);
    surface.dispose();
  });

  it("exposes the unsafe mutators in a dev build", () => {
    // Vitest runs with import.meta.env.DEV true; the production drop is asserted
    // on the built artifact by scripts/verify-game-handle.ts.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = target();
    const surface = installDebug(t, noDebugFlags());
    surface.console.unsafe!.money(777);
    expect(t.sim.money).toBe(777);
    surface.dispose();
  });
});

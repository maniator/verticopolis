import { createDebugConsole, type DebugConsole } from "./debugConsole";
import { createDebugHud, type DebugHud, type HudSource } from "./debugHud";
import { DEBUG_SECTIONS, loadDebugFlags, type DebugFlags, type DebugSection } from "./debugFlags";
import { setSimTimingEnabled } from "./simTimer";
import type { FrameStatsLike } from "./debugMetrics";
import { gameplaySession } from "../analytics";

/**
 * Entry point for the debug surface. Everything under `src/debug/` except
 * `simTimer.ts` (which the frame loop reads on every frame) is behind a dynamic
 * `import()` from `runBootFlow`, guarded by `debugRequested()`, so a session
 * that asked for no debug never fetches this chunk at all.
 *
 * `installDebug` is the one place that knows about the real engines. It adapts
 * them to the narrow ports the HUD and the console declare, which is what keeps
 * those two testable without WebGL.
 */

/** Excalibur's `DebugConfig`, narrowed to the parts used here. Structural, so
 *  this module does not import Excalibur (and neither does the chunk).
 *
 *  Every section in {@link DEBUG_SECTIONS} is required, which makes the section
 *  loop below index-safe with no runtime guard: if a future Excalibur renames or
 *  drops one, `typecheck` fails at the seam instead of the toggle quietly
 *  skipping that section forever. */
type DebugConfigLike = {
  filter: { useFilter: boolean; nameQuery: string; ids: number[] };
} & Record<DebugSection, { showAll: boolean }>;

/** The game, as narrowly as the debug surface needs it. Structural rather than
 *  an import of `GameApp`, so nothing here can drift into depending on the
 *  controller's internals. */
export interface DebugTarget {
  engine: {
    engine: {
      on(event: "postframe", handler: () => void): void;
      off(event: "postframe", handler: () => void): void;
      readonly stats: { currFrame: FrameStatsLike };
      readonly debug: DebugConfigLike;
      showDebug(toggle: boolean): void;
    };
    readonly cam: { zoom: number };
    readonly crowdCulled: boolean;
  };
  sim: { money: number };
  setSpeed(speed: number): void;
}

export interface DebugSurface {
  hud: DebugHud;
  console: DebugConsole;
  flags: DebugFlags;
  dispose(): void;
}

/**
 * Bring up the debug surface for this session: resolve the flags, build the
 * HUD, publish `window.vcdebug`, and apply whatever the launch flags asked for.
 *
 * Returns the surface so a test (or a future teardown path) can dispose it;
 * the boot call site fires and forgets, which is right for a developer tool
 * that must never be able to take boot down with it.
 */
export function installDebug(app: DebugTarget, flags: DebugFlags = loadDebugFlags()): DebugSurface {
  // The Excalibur engine is re-read through `app` on EVERY access, never
  // captured. A WebGL context loss rebuilds it wholesale
  // (`rebuildEngine` in engineWiring.ts does `app.engine = new TowerEngine(...)`),
  // and a captured reference would leave the panel writing to, and reading
  // from, a discarded engine: frozen numbers and a `draw()` that reports
  // success while setting flags nobody renders. That is the exact
  // "quietly does nothing" failure this surface exists to avoid.
  const ex = (): DebugTarget["engine"]["engine"] => app.engine.engine;

  // Sim-tick timing is on for the whole session once debug is installed. It is
  // two clock reads per frame, and it is the only way to tell sim cost from
  // render cost (see simTimer.ts), so paying for it unconditionally here is
  // simpler than trying to follow the HUD's visibility.
  setSimTimingEnabled(true);

  /** Push a set of geometry-draw sections to Excalibur. Every section is set
   *  explicitly, not just the requested ones, so turning a section off actually
   *  turns it off rather than leaving the last request latched. */
  const applyDraw = (sections: DebugSection[]): void => {
    const on = new Set(sections);
    const debug = ex().debug;
    for (const section of DEBUG_SECTIONS) debug[section].showAll = on.has(section);
    // `isDebug` is the master switch; DebugSystem early-outs on it, so this is
    // what makes the whole overlay free when nothing is selected.
    ex().showDebug(sections.length > 0);
  };

  const applyFilter = (query: string | null): void => {
    const filter = ex().debug.filter;
    filter.useFilter = query !== null;
    filter.nameQuery = query ?? "";
  };

  // The console mutates this object in place, so `persist()` and the HUD's
  // "draw is on" warning both read the live state rather than the boot state.
  const live: DebugFlags = { ...flags, draw: [...flags.draw] };

  const source: HudSource = {
    // Driven by requestAnimationFrame rather than the engine's `postframe`
    // event, deliberately. A `postframe` subscription belongs to ONE engine
    // instance, and a WebGL context-loss rebuild throws that instance away: the
    // panel would go silently and permanently stale with no signal left to
    // notice it by, because the very event that would have told us is the one
    // that stopped. rAF belongs to the page, so it survives the swap.
    //
    // Reading `currFrame` off the rAF tick instead of `postframe` is safe:
    // Excalibur resets and repopulates it entirely within its own single rAF
    // callback, so an observer in the same queue sees either frame N complete
    // or frame N-1 complete, never a half-written mix. The panel refreshes at
    // 4Hz, so which of the two it caught does not matter.
    onFrame(handler) {
      let stopped = false;
      let raf = requestAnimationFrame(function tick() {
        // `finally`, so a throw inside the panel does not kill the loop
        // permanently. The error still propagates to the page's error handler
        // (and so to error tracking) rather than being swallowed; what is
        // avoided is one bad frame silently ending all future updates, which
        // would look exactly like the staleness bug this rAF loop exists to
        // prevent.
        try {
          handler();
        } finally {
          // `stopped` guards the case where the handler itself disposed the
          // surface: without it this line schedules a frame that the already
          // returned unsubscribe can never cancel, leaking the loop.
          if (!stopped) raf = requestAnimationFrame(tick);
        }
      });
      return () => {
        stopped = true;
        cancelAnimationFrame(raf);
      };
    },
    frameStats: () => ex().stats.currFrame,
    fpsPercentiles: () => gameplaySession.fpsPercentiles(),
    zoom: () => app.engine.cam.zoom,
    crowdCulled: () => app.engine.crowdCulled,
    drawOn: () => live.draw.length > 0,
  };

  const hud = createDebugHud(source);

  const api = createDebugConsole({
    hud,
    flags: live,
    applyDraw,
    applyFilter,
    frameStats: () => ex().stats.currFrame,
    // The mutators are stripped from a production bundle by the gate inside
    // createDebugConsole; passing the app here is harmless either way, because
    // that gate is what decides whether anything is built from it.
    app,
  });

  publish(api);

  // Apply whatever the launch flags asked for.
  if (live.hud) hud.setVisible(true);
  applyDraw(live.draw);
  applyFilter(live.filter);
  if (live.unknown.length > 0) {
    console.warn(`vcdebug: ignored unknown debug token(s): ${live.unknown.join(", ")}. Try vcdebug.help().`);
  }

  return {
    hud,
    console: api,
    flags: live,
    dispose(): void {
      hud.dispose();
      applyDraw([]);
      applyFilter(null);
      setSimTimingEnabled(false);
      unpublish();
    },
  };
}

const GLOBAL_KEY = "vcdebug";

function publish(api: DebugConsole): void {
  try {
    (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = api;
  } catch {
    /* a frozen global is not worth failing boot over */
  }
}

function unpublish(): void {
  try {
    delete (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY];
  } catch {
    /* as above */
  }
}

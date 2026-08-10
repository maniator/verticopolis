import {
  DEBUG_SECTIONS,
  clearStoredSpec,
  isDebugSection,
  serializeDebugFlags,
  writeStoredSpec,
  type DebugFlags,
  type DebugSection,
} from "./debugFlags";
import { topSystems } from "./debugMetrics";
import type { DebugHud, HudReading } from "./debugHud";
import { ACTOR_NAMES } from "../render/excalibur/actorNames";

/**
 * `window.vcdebug`: the console half of the debug surface, so everything the
 * `?debug=` launch flags can do is also reachable mid-session without a reload.
 *
 * The namespace is split in two on purpose. The READ-ONLY half ships in every
 * build, production included, because being able to ask a deployed build or a
 * preview deploy what its frame cost looks like is worth far more than the
 * couple of kilobytes it costs in a chunk nobody fetches by accident. The
 * MUTATOR half (`vcdebug.unsafe`) sits behind the same
 * `import.meta.env.DEV || __TOOLING_BUILD__` gate that guards `window.game` in
 * bootstrap.ts, so a production bundle carries none of it: `game.sim.star = 5`
 * was a one-line cheat and this must not reopen that door.
 */

/** What the console needs in order to drive the rest of the debug surface. The
 *  installer supplies these; a test supplies fakes. */
export interface ConsoleDeps {
  hud: DebugHud;
  /** The live flag object. The setters below mutate it so `persist()` always
   *  writes what is actually on, not what was on at boot. */
  flags: DebugFlags;
  /** Push geometry-draw sections to the engine (empty turns debug draw off). */
  applyDraw(sections: DebugSection[]): void;
  /** Push the entity name filter to the engine (null clears it). */
  applyFilter(query: string | null): void;
  /** The live frame statistics, for `systems(n)`. Same source the HUD reads. */
  frameStats(): { systemDuration?: Record<string, number> } | undefined;
  /** The game instance, for the unsafe half. Passed ONLY by a dev or tooling
   *  build; production leaves it undefined. */
  app?: UnsafeApp;
}

/** The narrow slice of `GameApp` the mutators touch. Structural, so this module
 *  imports no game code and stays testable. */
export interface UnsafeApp {
  sim: { money: number };
  setSpeed(speed: number): void;
}

/** The read-only console API, present in every build. */
export interface DebugConsole {
  help(): void;
  fps(on?: boolean): boolean;
  draw(what?: boolean | string | string[]): DebugSection[];
  filter(query?: string | false | null): string | null;
  stats(): HudReading;
  systems(n?: number): void;
  persist(on?: boolean): string | null;
  /** Present only in a dev or tooling build (see the module comment). */
  unsafe?: UnsafeConsole;
}

export interface UnsafeConsole {
  app: UnsafeApp;
  money(amount: number): number;
  speed(index: number): number;
}

/** Emitted once when the mutator half installs. It is a real warning (these
 *  writes change the game under you), and `scripts/verify-game-handle.ts` greps
 *  the built bundles for this exact literal to prove a production build dropped
 *  the block. Minifiers rewrite identifiers but preserve string contents, so a
 *  literal is the honest thing to assert against. */
export const UNSAFE_MARKER = "[vcdebug] unsafe mutators enabled: dev/tooling build only";

export function createDebugConsole(deps: ConsoleDeps): DebugConsole {
  const { hud, flags } = deps;

  const api: DebugConsole = {
    help(): void {
      // One console.log rather than a table: this is prose, and a table of
      // one-line descriptions is harder to read than the lines themselves.
      console.log(
        [
          "vcdebug: Verticopolis debug surface (see DEBUGGING.md)",
          "",
          "  vcdebug.fps()            toggle the metrics panel",
          "  vcdebug.fps(true|false)  set it explicitly",
          "  vcdebug.draw()           toggle geometry draw (all sections)",
          "  vcdebug.draw('collider') draw one section",
          "  vcdebug.draw([...])      several sections at once",
          "  vcdebug.filter('person') scope geometry draw by actor name",
          "  vcdebug.filter(false)    clear the filter",
          "  vcdebug.stats()          a snapshot of the latest frame",
          "  vcdebug.systems(10)      the costliest ECS systems, as a table",
          "  vcdebug.persist(true)    keep these flags across reloads",
          "",
          ...wrapNames("  sections:    ", DEBUG_SECTIONS),
          "",
          // Derived from the renderer's own vocabulary rather than restated, so
          // a new or renamed actor cannot leave this list quietly wrong.
          ...wrapNames("  actor names: ", Object.values(ACTOR_NAMES)),
          "",
          "  launch flags: ?debug=fps  ?debug=draw:collider  ?debug=all  ?debug=off",
          "",
          "  note: geometry draw inflates the panel's draws/swaps counters,",
          "        because it renders through the same graphics context.",
          `  now: ${describe(flags)}`,
        ].join("\n"),
      );
    },

    fps(on?: boolean): boolean {
      const next = on ?? !hud.visible();
      hud.setVisible(next);
      flags.hud = next;
      return next;
    },

    draw(what?: boolean | string | string[]): DebugSection[] {
      const next = resolveDrawRequest(what, flags.draw);
      flags.draw = next;
      deps.applyDraw(next);
      return next;
    },

    filter(query?: string | false | null): string | null {
      // `undefined` reads the current value; `false`/`null`/`""` clears it.
      if (query === undefined) return flags.filter;
      const next = query === false || query === null || query === "" ? null : query;
      flags.filter = next;
      deps.applyFilter(next);
      return next;
    },

    stats(): HudReading {
      return hud.sample();
    },

    systems(n = 10): void {
      // Read the RAW stats rather than the HUD reading: the panel's snapshot is
      // capped at its own top-3, so going through it would silently make
      // `systems(10)` a `systems(3)`.
      const durations = deps.frameStats()?.systemDuration;
      const systems = topSystems(durations, n);
      if (systems.length === 0) {
        const reported = durations ? Object.keys(durations).length : 0;
        // "No frame has rendered" and "every reading was 0" look identical in
        // the output but have nothing to do with each other: the second is a
        // coarsened clock, and reporting it as the first sends you hunting a
        // bug that is not there.
        console.log(
          reported === 0
            ? "vcdebug: no system timings yet (has a frame rendered?)"
            : `vcdebug: all ${reported} systems measured 0 ms, so this browser's performance.now() is too coarse to time them ` +
                "(Firefox privacy.resistFingerprinting, or a context clamped to 1ms). The other panel rows are unaffected.",
        );
        return;
      }
      console.table(systems.map((s) => ({ system: s.label, ms: Number(s.ms.toFixed(3)) })));
    },

    persist(on = true): string | null {
      if (!on) {
        clearStoredSpec();
        return null;
      }
      const spec = serializeDebugFlags(flags);
      writeStoredSpec(spec);
      return spec === "" ? null : spec;
    },
  };

  // The mutator half. Vite statically replaces both operands in a build, so a
  // production bundle evaluates `if (false)` here and Rollup drops the whole
  // block, exactly as it drops the `window.game` publish in bootstrap.ts.
  if (import.meta.env.DEV || __TOOLING_BUILD__) {
    const app = deps.app;
    if (app) {
      console.warn(UNSAFE_MARKER);
      api.unsafe = {
        app,
        money(amount: number): number {
          app.sim.money = amount;
          return app.sim.money;
        },
        speed(index: number): number {
          app.setSpeed(index);
          return index;
        },
      };
    }
  }

  return api;
}

/** Resolve a `draw()` argument against what is currently on. No argument
 *  toggles: on when anything is drawing, off otherwise, which is the behavior a
 *  bare `vcdebug.draw()` should have. */
export function resolveDrawRequest(what: boolean | string | string[] | undefined, current: DebugSection[]): DebugSection[] {
  if (what === undefined) return current.length > 0 ? [] : [...DEBUG_SECTIONS];
  if (what === true) return [...DEBUG_SECTIONS];
  if (what === false) return [];
  const requested = (Array.isArray(what) ? what : [what]).map((s) => s.toLowerCase());
  const unknown = requested.filter((s) => !isDebugSection(s));
  if (unknown.length > 0) {
    // Naming the typo matters more here than anywhere: a debug toggle that
    // quietly does nothing is indistinguishable from the thing you are
    // measuring being fine.
    console.warn(`vcdebug: unknown draw section(s) ${unknown.join(", ")}; known: ${DEBUG_SECTIONS.join(", ")}`);
  }
  // Normalize to DEBUG_SECTIONS order, matching how the flag parser emits them,
  // so a spec serialized from here parses back to the same thing.
  const wanted = new Set(requested.filter(isDebugSection));
  return DEBUG_SECTIONS.filter((s) => wanted.has(s));
}

/** Lay `names` out under `label`, wrapped to a console-friendly width with
 *  continuation lines indented to the label. Keeps `help()` readable as the
 *  vocabulary grows, which a single joined line would not. */
function wrapNames(label: string, names: readonly string[], width = 74): string[] {
  const indent = " ".repeat(label.length);
  const lines: string[] = [];
  let line = label;
  for (const name of names) {
    if (line === label) {
      line += name;
      continue;
    }
    if (line.length + 2 + name.length > width) {
      // The comma stays on the line being closed, so the list still reads as
      // one continuous list across the break rather than two ragged ones.
      lines.push(line + ",");
      line = indent + name;
    } else {
      line += `, ${name}`;
    }
  }
  lines.push(line);
  return lines;
}

/** A one-line summary of what is currently on, for `help()`. */
function describe(flags: DebugFlags): string {
  const spec = serializeDebugFlags(flags);
  return spec === "" ? "nothing on" : spec;
}

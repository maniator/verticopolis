import { Simulation } from "../engine/Simulation";
import { towerStateSig } from "../engine/UndoHistory";
import { markFounderFromLoadedFile } from "../engine/sim/founderStatus";
import type { SerializedGame } from "../engine/types";
import { saveText, settleEngine, stepGate } from "../wasmhost/stepGate";
import type { SaveOptions, SimPort, TowerSource } from "./port";

/** How `TsSim` hands over a tower it built: the app's `adoptSim`, read when
 *  called so the WASM host's wrapper sees every swap. `keepHistory` is true
 *  for an undo or a redo step only. Without it the port cannot load. */
export interface TsSimOptions {
  adopt?(sim: Simulation, keepHistory: boolean): void;
}

export type TsLifecycle = Pick<SimPort, "generation" | "load" | "save" | "saveNow" | "undoSignature">;

/**
 * The TypeScript side of the port's lifecycle members (the slice 5 story,
 * AC 2). It builds, saves and fingerprints a `Simulation`, so like the panel
 * answers (`tsPanels.ts`) it imports the TypeScript engine at runtime, and it
 * goes when that engine retires.
 *
 * A load builds the tower and adopts it before the promise is returned, so a
 * synchronous reader sees the new tower at once, as with a command, and the
 * WASM host's undo wrappers still see the restore inside the call. A throw
 * rejects the promise. One from building the tower leaves the tower as it
 * was; one from `adopt` comes after the app began the swap (the WASM host
 * codes its own faults there and falls back).
 *
 * `generation` is a number per instance, given the first time the port sees
 * it, so a swap made outside the port (the WASM host's recovery) moves it too.
 */
export function createTsLifecycle(getSim: () => Simulation, opts: TsSimOptions): TsLifecycle {
  const generations = new WeakMap<Simulation, number>();
  let issued = 0;
  return {
    get generation() {
      const sim = getSim();
      let generation = generations.get(sim);
      if (generation === undefined) generations.set(sim, (generation = ++issued));
      return generation;
    },
    load(source) {
      try {
        if (!opts.adopt) throw new Error("This port cannot load a tower.");
        const [sim, keepHistory] = build(source, getSim());
        opts.adopt(sim, keepHistory);
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    },
    save(saveOpts) {
      try {
        const sim = getSim();
        // A host that steps in the background (the experimental worker and
        // coalesced hosts) registers a step gate; without one the save is
        // taken now, so it holds exactly what was issued before it.
        if (!stepGate(sim)) return Promise.resolve(write(sim, saveOpts));
        return settledSave(getSim, saveOpts);
      } catch (e) {
        return Promise.reject(e);
      }
    },
    saveNow: (saveOpts) => write(getSim(), saveOpts),
    undoSignature() {
      const sim = getSim();
      return towerStateSig(sim.tower, sim.money);
    },
  };
}

/** The tower a source describes, and whether the swap keeps the history. */
function build(source: TowerSource, live: Simulation): [Simulation, boolean] {
  switch (source.from) {
    case "history": {
      const sim = Simulation.deserialize(JSON.parse(source.text));
      // A setting, so an undo keeps the live one rather than the step's.
      sim.autoBridge = live.autoBridge;
      return [sim, true];
    }
    case "stored":
      return [firstLoadable(source.saves), false];
    case "legacy":
      return [Simulation.deserialize(source.save), false];
    case "found":
      return [Simulation.newGame(source.seed, source.mode, source.calendar, source.unbridged), false];
  }
}

/** The first save that loads, with the founder rule a stored tower takes.
 *  Throws the first error when none does. */
function firstLoadable(saves: readonly SerializedGame[]): Simulation {
  let first: unknown = null;
  for (const save of saves) {
    try {
      const sim = Simulation.deserialize(save);
      markFounderFromLoadedFile(sim, save);
      return sim;
    } catch (e) {
      first ??= e;
    }
  }
  throw first ?? new Error("There is no save to load.");
}

/** The save text: the camera stamped first when the caller passes one (the
 *  WASM host relays the stamp to its engine), and for a copy that stays in
 *  memory the host's own text when it offers one. */
function write(sim: Simulation, opts?: SaveOptions): string {
  const view = opts?.view?.();
  if (view) sim.view = view;
  const hosted = opts?.memory ? saveText(sim) : undefined;
  return hosted ? hosted() : JSON.stringify(sim.serialize());
}

/** The save of a host that steps in the background, once it has caught up
 *  (as `saveLoad.ts`'s autosave waits). A tower adopted during the wait is
 *  not the one asked for, so the wait starts again on the tower held now. */
async function settledSave(getSim: () => Simulation, opts?: SaveOptions): Promise<string> {
  for (;;) {
    const sim = getSim();
    await settleEngine(sim);
    if (getSim() === sim) return write(sim, opts);
  }
}

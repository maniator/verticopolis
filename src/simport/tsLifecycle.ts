import type { CalendarKind } from "../engine/calendar";
import { Simulation } from "../engine/Simulation";
import type { GameMode, SerializedGame, SerializedView } from "../engine/types";
import { towerStateSig } from "../engine/UndoHistory";
import { markFounderFromLoadedFile } from "../engine/sim/founderStatus";
import type { SaveOptions, SimPort, TowerSource } from "./port";

export interface TsSimAdopt {
  adopt(sim: Simulation, keepHistory?: boolean): void;
}

export interface TsLifecycle {
  readonly generation: number;
  load(source: TowerSource): Promise<void>;
  saveNow(opts?: SaveOptions): string;
  save(opts?: SaveOptions): Promise<string>;
  undoSignature(): string;
}

export function createTsLifecycle(getSim: () => Simulation, adopt?: TsSimAdopt["adopt"]): TsLifecycle {
  const generations = new WeakMap<Simulation, number>();
  let nextGeneration = 0;
  const generationOf = (sim: Simulation): number => {
    let generation = generations.get(sim);
    if (generation === undefined) {
      generation = ++nextGeneration;
      generations.set(sim, generation);
    }
    return generation;
  };
  const applyView = (sim: Simulation, view: SaveOptions["view"]) => {
    const nextView = view ? view() : undefined;
    if (nextView !== undefined) sim.view = nextView;
  };
  const saveText = (sim: Simulation, opts?: SaveOptions): string => {
    const view = opts?.view ? opts.view() : undefined;
    if (view !== undefined) sim.view = view;
    return JSON.stringify(sim.serialize());
  };

  const adoptSim = (sim: Simulation, keepHistory = false): void => {
    if (adopt) adopt(sim, keepHistory);
  };

  return {
    get generation() {
      return generationOf(getSim());
    },
    async load(source: TowerSource): Promise<void> {
      let next: Simulation;
      switch (source.from) {
        case "history": {
          const raw = JSON.parse(source.text) as SerializedGame;
          next = Simulation.deserialize(raw);
          next.autoBridge = getSim().autoBridge;
          adoptSim(next, true);
          return;
        }
        case "stored": {
          let firstError: unknown;
          for (const save of source.saves) {
            try {
              next = Simulation.deserialize(save);
              markFounderFromLoadedFile(next, save);
              adoptSim(next, false);
              return;
            } catch (err) {
              if (!firstError) firstError = err;
            }
          }
          if (firstError !== undefined) throw firstError;
          return;
        }
        case "legacy": {
          next = Simulation.deserialize(source.save);
          adoptSim(next, false);
          return;
        }
        case "found": {
          next = Simulation.newGame(source.seed, source.mode, source.calendar, source.unbridged ?? false);
          adoptSim(next, false);
          return;
        }
        default:
          return;
      }
    },
    saveNow(opts?: SaveOptions): string {
      return saveText(getSim(), opts);
    },
    async save(opts?: SaveOptions): Promise<string> {
      return saveText(getSim(), opts);
    },
    undoSignature(): string {
      const sim = getSim();
      return towerStateSig(sim.tower, sim.money);
    },
  };
}

export function loadFromSource(source: TowerSource, getSim: () => Simulation, adopt?: TsSimAdopt["adopt"]): Promise<void> {
  return createTsLifecycle(getSim, adopt).load(source);
}

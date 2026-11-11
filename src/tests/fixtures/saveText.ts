import { SaveGame } from "../../storage/SaveGame";
import type { SerializedGame } from "../../shared/serializedGame";
import { loadStored } from "../../game/portLifecycle";
import type { SaveLoadDeps } from "../../game/saveLoad";
import { newViewReader } from "../../game/portAccess";
import type { EnginePort } from "../../simport/enginePort";
import { PortCodes } from "../../simport/portCodes";
import { draftTower, type Draft } from "../portKit/drafts";

/**
 * `SaveGame` speaks save text and hands loads to the engine (PR 5d). These
 * helpers give the storage tests the shapes they check, on the Rust engine: a
 * tower is a port kit {@link Draft} (a tooling tower over its own engine,
 * with the old `Simulation` shape), and a load goes through the engine's
 * `loadSave`, as the game's does, so the founder rule applies as in the game.
 */

/** The draft's engine, with every pending edit loaded into it. */
function portOf(draft: Draft): EnginePort {
  draft.settle();
  return draft.port as unknown as EnginePort;
}

/** Run `load` with a loader into a fresh draft's engine (`loadSave`, as the
 *  game loads); the draft, or null when nothing loaded. */
function loaded(load: (tryLoad: (text: string) => boolean) => boolean): Draft | null {
  const draft = draftTower(1);
  const ok = load(loadStored(portOf(draft), () => draft.settle()));
  return ok ? draft : null;
}

/** A `.vctower` file read into a tower the way the game imports one:
 *  `SaveGame.importText`'s checks, then the engine's `loadSave`. */
export async function importTower(text: string): Promise<Draft> {
  const save = await SaveGame.importText(text);
  const draft = loaded((tryLoad) => tryLoad(save));
  if (!draft) throw new Error("the engine refused the imported tower");
  return draft;
}

/** The save text of a tower, as `EnginePort.serialize()` writes it. */
export const saveOf = (sim: { serialize(): unknown }): string => JSON.stringify(sim.serialize());

/** The tower the autosave loads into a fresh engine, with the read's flags. */
export function loadResultSim(): { sim: Draft | null; corrupt: boolean; savedAt: number | undefined } {
  let flags: { corrupt: boolean; savedAt: number | undefined } = { corrupt: false, savedAt: undefined };
  const into = loaded((tryLoad) => {
    const r = SaveGame.loadResult(tryLoad);
    flags = { corrupt: r.corrupt, savedAt: r.savedAt };
    return r.loaded;
  });
  return { sim: into, ...flags };
}

/** The tower the autosave loads, or null. */
export const loadAuto = (): Draft | null => loadResultSim().sim;

/** The tower manual slot `n` loads, or null. */
export function loadSlotSim(n: number): Draft | null {
  return loaded((tryLoad) => SaveGame.loadSlot(n, tryLoad));
}

/**
 * The storage half on its own: the save text `SaveGame` hands its loader,
 * read back as the save, with no engine behind the loader. The storage suites
 * check what `SaveGame` decoded and handed on with these, so they run where
 * no engine package is built; the engine's load of that text is pinned by
 * the engine-backed helpers above and by the Rust load tests.
 */
function readHanded(load: (tryLoad: (text: string) => boolean) => boolean): SerializedGame | null {
  let handed: string | null = null;
  const ok = load((text) => {
    handed = text;
    return true;
  });
  return ok && handed !== null ? (JSON.parse(handed) as SerializedGame) : null;
}

/** The save the autosave hands its loader, with the read's flags. */
export function readResult(): { save: SerializedGame | null; corrupt: boolean; savedAt: number | undefined } {
  let flags: { corrupt: boolean; savedAt: number | undefined } = { corrupt: false, savedAt: undefined };
  const save = readHanded((tryLoad) => {
    const r = SaveGame.loadResult(tryLoad);
    flags = { corrupt: r.corrupt, savedAt: r.savedAt };
    return r.loaded;
  });
  return { save, ...flags };
}

/** The save the autosave hands its loader, or null. */
export const readAuto = (): SerializedGame | null => readResult().save;

/** The save manual slot `n` hands its loader, or null. */
export function readSlot(n: number): SerializedGame | null {
  return readHanded((tryLoad) => SaveGame.loadSlot(n, tryLoad));
}

/** The save `SaveGame.importText` reads out of a `.vctower` file. */
export async function readImport(text: string): Promise<SerializedGame> {
  return JSON.parse(await SaveGame.importText(text)) as SerializedGame;
}

type PortDeps = "enginePort" | "portCodes" | "reader" | "towerSwapped";

/** A test's own tower, and what a swap hands it. */
interface TestTower {
  getSim(): Draft;
  /** Called with the test's tower once a swap loaded a new tower into its
   *  engine (a new game, a load, an import): the engine holds the new tower,
   *  so the draft now reads it. */
  adoptSim(sim: Draft): void;
}

/**
 * Give a test's `SaveLoad` deps the engine port pieces, over the engine of
 * the tower the test's `getSim` answers. A done swap hands that tower to the
 * test's `adoptSim` when `SaveLoad` reports it (`towerSwapped`, as the game
 * follows a swap).
 */
export function withPorts(deps: Omit<SaveLoadDeps, PortDeps> & TestTower): SaveLoadDeps {
  const engine = portOf(deps.getSim());
  const codes = new PortCodes(engine);
  const reader = newViewReader(engine);
  return Object.assign(deps, {
    enginePort: () => portOf(deps.getSim()),
    portCodes: () => codes,
    reader: () => {
      portOf(deps.getSim());
      reader.update();
      return reader;
    },
    towerSwapped: () => {
      const sim = deps.getSim();
      sim.discard();
      deps.adoptSim(sim);
    },
  });
}

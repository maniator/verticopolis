import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { SaveGame } from "../../storage/SaveGame";
import type { Scenario } from "./scenarios";

/**
 * The cold start with a saved tower (#1254): a scenario's save placed in the
 * autosave slot of a fresh browser context before its page opens, so the
 * boot loads that tower behind the title screen, as it does for a player
 * with an autosave. M5 measures an empty tower; this row is reported beside
 * it and gates nothing.
 */

/** The autosave slot `SaveGame` reads at boot (`AUTO_KEY` in SaveGame.ts;
 *  the round trip below fails if the two ever differ). */
export const AUTOSAVE_KEY = "verticopolis-save";

export interface AutosaveSeed {
  value: string;
  sha256: string;
}

const seeds = new Map<string, AutosaveSeed>();

/** The stored autosave value for a save: its text packed by
 *  `SaveGame.packSync`, the game's own autosave writer, so the boot reads it
 *  exactly as it reads a real one. Packed once per save text
 *  in a Node process, so all of a run's processes and both engines boot the
 *  same bytes. The pack stamps the write time, so a resumed run (a new Node
 *  process) packs different bytes; each result records the sha256 it used. */
export function autosaveSeed(sc: Pick<Scenario, "save">): AutosaveSeed {
  let seed = seeds.get(sc.save);
  if (seed === undefined) {
    const value = SaveGame.packSync(sc.save);
    seed = { value, sha256: createHash("sha256").update(value).digest("hex") };
    seeds.set(sc.save, seed);
  }
  return seed;
}

/** Before any browser runs: pack each scenario's seed and read it back
 *  through `SaveGame.loadResult`, the reader the boot uses, so a seed the
 *  boot could not read stops the run before its first measurement. The read
 *  must hand the engine the scenario's save, changed only by the write stamp
 *  the autosave writer adds; the runner checks the booted tower's population
 *  on the page. */
export function checkAutosaveSeeds(scenarios: readonly Pick<Scenario, "name" | "save" | "population">[]): void {
  for (const sc of scenarios) {
    // An empty tower would pass the runner's population check without the
    // save ever loading.
    if (!(sc.population > 0)) throw new Error(`${sc.name}: the saved-tower start needs a tower with people in it; this save has population ${sc.population}`);
    let handed: string | null = null;
    const read = withAutosave(autosaveSeed(sc).value, () =>
      SaveGame.loadResult((text) => {
        handed = text;
        return true;
      }),
    );
    const same = handed !== null && isDeepStrictEqual(unstamped(handed), unstamped(sc.save));
    if (read.loaded && !read.corrupt && same) continue;
    let what = "a different tower";
    if (handed === null) what = "no tower";
    else if (same) what = "loaded";
    throw new Error(`${sc.name}: the autosave seed does not load back (${what}${read.corrupt ? ", read as corrupt" : ""})`);
  }
}

/** A save's tower without the write stamp (`savedAt`, `appVersion`) that
 *  every autosave write sets. */
function unstamped(text: string): unknown {
  const { savedAt: _savedAt, appVersion: _appVersion, ...tower } = JSON.parse(text) as Record<string, unknown>;
  return tower;
}

/** Run `fn` with a storage holding only the autosave slot, then restore the
 *  global storage (absent under Node, a test environment's own otherwise). */
function withAutosave<T>(value: string, fn: () => T): T {
  const g = globalThis as { localStorage?: Storage };
  const prior = Object.getOwnPropertyDescriptor(g, "localStorage");
  const items = new Map([[AUTOSAVE_KEY, value]]);
  const storage: Storage = {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, String(v)),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
  };
  Object.defineProperty(g, "localStorage", { value: storage, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (prior) Object.defineProperty(g, "localStorage", prior);
    else delete g.localStorage;
  }
}

/** The context's storage state: the seed in the autosave slot of the app's
 *  origin. Playwright writes it while it creates the context, before any of
 *  the context's pages open, so no seeding runs inside the timed start. */
export function autosaveState(origin: string, seed: AutosaveSeed): { cookies: []; origins: { origin: string; localStorage: { name: string; value: string }[] }[] } {
  return { cookies: [], origins: [{ origin, localStorage: [{ name: AUTOSAVE_KEY, value: seed.value }] }] };
}

/** Page function: whether the boot loaded a readable autosave, and the
 *  booted tower's population. */
export function bootedTower(): { loaded: boolean; corrupt: boolean; population: number } {
  const g = (window as unknown as { game: { hadReadableSave: boolean; saveWasCorrupt: boolean; sim: { population: number } } }).game;
  return { loaded: g.hadReadableSave, corrupt: g.saveWasCorrupt, population: g.sim.population };
}

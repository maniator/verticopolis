import { catalogFor } from "./catalog";
import type { Catalog } from "./catalogTypes";
import type { GameMode } from "./types";

/**
 * Each tower's catalog handle (#921): where a frontend reads every price, size
 * and build rule, so the values come from whichever engine runs the tower.
 * A tower reads the TypeScript tables by default; a WASM host points it at the
 * engine binding for as long as it runs the tower. Kept beside the tower
 * rather than on it: nothing here is saved, and the engine never reads it.
 */
interface Handle {
  source: (mode: GameMode) => Catalog;
  read: Map<GameMode, Catalog>;
}

const handles = new WeakMap<object, Handle>();

function handleOf(tower: object): Handle {
  let h = handles.get(tower);
  if (!h) {
    h = { source: catalogFor, read: new Map() };
    handles.set(tower, h);
  }
  return h;
}

/** The catalog of `mode` (the tower's own by default) from the tower's
 *  source, read once and kept. */
export function towerCatalog(tower: { readonly mode: GameMode }, mode: GameMode = tower.mode): Catalog {
  return catalogOn(tower, mode);
}

/** The catalog of `mode` from the source set on `key` (a tower, or the engine
 *  the game holds), read once and kept. */
export function catalogOn(key: object, mode: GameMode): Catalog {
  const h = handleOf(key);
  let c = h.read.get(mode);
  if (!c) {
    c = h.source(mode);
    h.read.set(mode, c);
  }
  return c;
}

/** Read the tower's catalog from `source` from now on, or from the
 *  TypeScript tables again when `source` is null. */
export function useTowerCatalogSource(tower: object, source: ((mode: GameMode) => Catalog) | null): void {
  const h = handleOf(tower);
  h.source = source ?? catalogFor;
  h.read.clear();
}

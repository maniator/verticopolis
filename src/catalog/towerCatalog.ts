import type { Catalog } from "./catalogTypes";
import type { GameMode } from "../shared/types";

/**
 * Each tower's catalog handle (#921): where a frontend reads every price, size
 * and build rule, so the values come from whichever engine runs the tower.
 * The Rust host points the engine port at the engine binding's catalogs
 * (`rustEngine.ts`), and the render tower reads the port's (`portAccess.ts`).
 * Kept beside the tower rather than on it: nothing here is saved, and the
 * engine never reads it.
 *
 * A tower with no source set reads the fallback, which only tests and the
 * tooling build's hand-built towers register: they hand it the TypeScript
 * engine's tables, which the shipped game does not carry. With no fallback a
 * read throws, so a shipped tower whose source was never set fails loudly
 * instead of reading a table the build does not have.
 */
type Source = (mode: GameMode) => Catalog;

interface Handle {
  /** Null reads the fallback. */
  source: Source | null;
  read: Map<GameMode, Catalog>;
}

const handles = new WeakMap<object, Handle>();
let fallback: Source | null = null;

function handleOf(tower: object): Handle {
  let h = handles.get(tower);
  if (!h) {
    h = { source: null, read: new Map() };
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
    const source = h.source ?? fallback;
    if (!source) throw new Error(`no catalog source is set for this tower's ${mode} catalog: the engine host sets one on every tower it runs`);
    c = source(mode);
    h.read.set(mode, c);
  }
  return c;
}

/** Read the tower's catalog from `source` from now on, or from the fallback
 *  when `source` is null. */
export function useTowerCatalogSource(tower: object, source: Source | null): void {
  const h = handleOf(tower);
  h.source = source;
  h.read.clear();
}

/** The source a tower with none set reads (see the module doc): the
 *  TypeScript engine's tables, for tests and the tooling build. */
export function useFallbackCatalogSource(source: Source | null): void {
  fallback = source;
}

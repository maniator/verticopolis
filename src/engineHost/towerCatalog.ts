import type { Catalog } from "@verticopolis/engine/catalog/catalogTypes";
import type { GameMode } from "@verticopolis/engine/model/types";
import {
  catalogOn as sourceCatalogOn,
  useFallbackSource,
  useTowerSource,
} from "@verticopolis/components/render/towerSource";
import { renderRules, toRenderCatalog } from "../engineRender";

/**
 * A tower's engine catalog, by the handle the components' renderer keeps
 * (`render/towerSource`). The game sets it from the engine's catalogs with
 * the engine's rules (`engineRender.ts`), so the catalog a lookup hands back
 * is the engine's own object and the cast back to `Catalog` holds.
 */

type Source = (mode: GameMode) => Catalog;

/** `tower`'s catalog in its own mode, or in `mode`. */
export function towerCatalog(tower: { readonly mode: GameMode }, mode: GameMode = tower.mode): Catalog {
  return catalogOn(tower, mode);
}

/** The catalog of `mode` that `key` (a tower or its port) was given. */
export function catalogOn(key: object, mode: GameMode): Catalog {
  return sourceCatalogOn(key, mode) as Catalog;
}

/** Gives `tower` its engine catalogs, or clears them with `null`. */
export function useTowerCatalogSource(tower: object, source: Source | null): void {
  useTowerSource(tower, source && { catalog: (mode) => toRenderCatalog(source(mode)), rules: renderRules });
}

/** The catalogs a tower with none of its own reads, or none with `null`. */
export function useFallbackCatalogSource(source: Source | null): void {
  useFallbackSource(source && { catalog: (mode) => toRenderCatalog(source(mode)), rules: renderRules });
}

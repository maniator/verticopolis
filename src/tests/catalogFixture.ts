import { COMPONENT_FIXTURES } from "./packagePaths";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Catalog } from "@verticopolis/engine/catalog/catalogTypes";
import { readCatalog } from "@verticopolis/engine/binding/catalog";
import type { GameMode } from "@verticopolis/engine/model/types";

/**
 * The Rust engine's catalog for each mode, as its `catalog(mode)` export
 * answers it, for tests that price, size or lay out without an engine. The
 * catalog is the engine's published rule table (CONTRIBUTING.md, "What every
 * test must do": a pinned value comes from the catalog), so the fixtures
 * (`catalog.<mode>.json` in the components package) are written from the engine on
 * purpose, as the catalog digests are: `portReads.integration.test.ts` holds
 * each to the engine's answer, and `VC_UPDATE_PORT_FIXTURES=1` rewrites it.
 * Each read passes the binding's own shape check (`readCatalog`).
 */

const FIXTURES = COMPONENT_FIXTURES;
const read = new Map<GameMode, Catalog>();

/** The fixture file of `mode`'s catalog. */
export const catalogFixturePath = (mode: GameMode): string => resolve(FIXTURES, `catalog.${mode}.json`);

/** `mode`'s catalog, read once. */
export function catalogFor(mode: GameMode): Catalog {
  let c = read.get(mode);
  if (!c) {
    const text = JSON.stringify(JSON.parse(readFileSync(catalogFixturePath(mode), "utf8")));
    c = readCatalog({ catalog: () => text }, mode);
    read.set(mode, c);
  }
  return c;
}

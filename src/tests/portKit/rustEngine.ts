import { afterEach } from "vitest";
import { useTowerCatalogSource } from "../../catalog/towerCatalog";
import { readCatalog } from "../../dualrun/catalog";
import { draftTower, releaseDrafts, type Draft } from "./drafts";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { ToolingTower, type ToolingEngine } from "../../game/toolingTower";
import type { EnginePort } from "../../simport/enginePort";

/**
 * The Rust engine for the port's integration suites. The port's unit tests
 * (`src/simport/`) run on mock ports instead (`mockPort.ts`). Where the
 * package is required, a missing one fails.
 * Every engine reads its prices and sizes from the engine's own catalogs, as
 * the game's boot sets them, and every engine and draft a test makes is freed
 * after it.
 */

/** No engine package here: the suites that need one skip. */
export const noEngine = !hasWasmPackage();

type Freed = EnginePort & { free(): void };
const made: Freed[] = [];

function adopt(engine: Freed): EnginePort {
  made.push(engine);
  useTowerCatalogSource(engine, (mode) => readCatalog(wasm(), mode));
  return engine;
}
afterEach(() => {
  for (const e of made.splice(0)) e.free();
  releaseDrafts();
});

/** An engine on `save` (a draft's save text, a fixture file's). */
export function engineFromSave(save: string): EnginePort {
  return adopt(wasm().Engine.fromSave(save) as unknown as Freed);
}

/** A freshly founded tower's engine, as `Engine.newGame` starts it. */
export function newEngine(seed: number, mode: "classic" | "modern" = "classic", calendar?: string): EnginePort {
  return adopt(wasm().Engine.newGame(seed, mode, calendar ?? null) as unknown as Freed);
}

/**
 * The small Modern tower the reader and card tests share: a lobby and two
 * floors across x 160 to 279, at three stars with money to spare, with what
 * `extra` builds on it.
 */
export function smallTower(extra: (d: Draft) => void): Draft {
  const d = draftTower(5, "modern");
  d.money = 1e8;
  d.star = 3;
  for (let x = 160; x < 280; x++) must(d.build("lobby", 1, x), `lobby at ${x}`);
  for (const floor of [2, 3]) for (let x = 160; x < 280; x++) must(d.build("floor", floor, x), `floor ${floor} at ${x}`);
  extra(d);
  return d;
}

/** The engine's own answers about its tower: its save's records (with the
 *  defaults a save leaves out read back) and its geometry lookups, through
 *  the tooling tower's views. */
export const look = (engine: EnginePort): ToolingTower => new ToolingTower(() => engine as unknown as ToolingEngine);

/** Fail with the engine's reason when a build is refused. */
export function must(result: { ok: boolean; reason?: string }, what: string): void {
  if (!result.ok) throw new Error(`${what}: ${result.reason ?? "refused"}`);
}

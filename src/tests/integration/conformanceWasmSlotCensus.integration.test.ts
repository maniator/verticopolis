/**
 * The population a Saves row shows is the engine's own count (`slotCensus.ts`),
 * and with an engine installed a row only claims a slot loads once the engine
 * has accepted its save. With none installed a parseable save still reads as
 * existing, with no population.
 * Skips without the WASM package, like the rest of `npm run test:wasm`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import towerFile from "../../../conformance/fixtures/towerone_6.vctower?raw";
import { Simulation } from "../../engine/Simulation";
import { SaveGame } from "../../storage/SaveGame";
import { setSlotPopulationReader } from "../../storage/slotCensus";
import { populationReaderFromModule } from "../../wasmhost/slotPopulation";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { saveOf, importTower } from "../fixtures/saveText";
import type { Draft } from "../portKit/drafts";
import { PortCodes } from "../../simport/portCodes";
import type { EnginePort } from "../../simport/enginePort";

/** The tower's population, from the engine's stats strip. */
function population(sim: Draft): number {
  sim.settle();
  const port = sim.port as unknown as EnginePort;
  return new PortCodes(port).slot(port.statsStrip(), "statsStrip", "population");
}

const run = hasWasmPackage();

describe.skipIf(!run)("slot rows count their population through the engine", () => {
  beforeEach(() => {
    localStorage.clear();
    setSlotPopulationReader(populationReaderFromModule(wasm()));
  });
  afterEach(() => {
    setSlotPopulationReader(null);
    localStorage.clear();
  });

  it("matches the loaded engine's census for a populated tower", async () => {
    const sim = await importTower(towerFile);
    expect(population(sim)).toBeGreaterThan(0);
    SaveGame.saveSlot(1, saveOf(sim));
    const row = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(row.exists).toBe(true);
    expect(row.population).toBe(population(sim));
  });

  it("does not offer a slot the engine refuses, though its bytes are present", () => {
    setSlotPopulationReader(() => {
      throw new Error("The engine refused this save.");
    });
    SaveGame.saveSlot(2, saveOf(Simulation.newGame(7)));
    const row = SaveGame.listSlots().find((s) => s.slot === 2)!;
    expect(row.exists).toBe(false);
    expect(row.present).toBe(true);
  });

  it("shows no population while no engine is installed, and keeps the other facts", () => {
    setSlotPopulationReader(null);
    const sim = Simulation.newGame(7);
    SaveGame.saveSlot(1, saveOf(sim));
    const row = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(row.exists).toBe(true);
    expect(row.population).toBeUndefined();
    expect(row.towerName).toBe(JSON.parse(saveOf(sim)).towerName);
  });

  it("does not read a slot again on a reopen, and does after the slot is rewritten", () => {
    const inner = populationReaderFromModule(wasm());
    let reads = 0;
    setSlotPopulationReader((text) => (reads++, inner(text)));
    SaveGame.saveSlot(1, saveOf(Simulation.newGame(7)));
    const first = SaveGame.listSlots().find((s) => s.slot === 1)!;
    expect(SaveGame.listSlots().find((s) => s.slot === 1)).toEqual(first);
    expect(reads).toBe(1);
    SaveGame.saveSlot(1, saveOf(Simulation.newGame(8)));
    expect(SaveGame.listSlots().find((s) => s.slot === 1)!.exists).toBe(true);
    expect(reads).toBe(2);
  });
});

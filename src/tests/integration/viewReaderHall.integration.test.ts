import { afterEach, describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { useTowerCatalogSource } from "../../engine/towerCatalog";
import type { EnginePort } from "../../simport/enginePort";
import { newViewReader } from "../../game/portAccess";
import { bindViewKinds } from "../../presentation/viewKinds";
import { catalogFor } from "../../engine/catalog";
import { readCatalog } from "../../dualrun/catalog";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The reader over the Rust engine sizes the wedding hall as the engine does:
 * five stories, floors 100 to 104, nothing on 105. The height comes from the
 * port's own catalog, so it holds after the view's kind facts are bound to
 * another catalog (a scene or a swapped-in tower binds them again).
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type RustEngine = EnginePort & { free(): void };
const freed: RustEngine[] = [];
afterEach(() => {
  for (const e of freed.splice(0)) e.free();
  bindViewKinds(catalogFor("modern"));
});

const HALL_X = 100;

/** A tower reaching floor 100 with the TypeScript hall on top, saved and read by the Rust engine, which widens it to its own 28 by 5. */
function towerWithHall(): RustEngine {
  const built = Simulation.newGame(5, "modern");
  built.money = 1e9;
  built.star = 5;
  for (let x = HALL_X - 4; x < HALL_X + 36; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
  for (let floor = 2; floor <= 100; floor++) for (let x = HALL_X - 4; x < HALL_X + 36; x++) expect(built.build("floor", floor, x).ok, `floor ${floor}`).toBe(true);
  expect(built.build("weddingHall", 100, HALL_X).ok).toBe(true);
  const rust = wasm().Engine.fromSave(JSON.stringify(built.serialize())) as unknown as RustEngine;
  freed.push(rust);
  useTowerCatalogSource(rust, (mode) => readCatalog(wasm(), mode));
  return rust;
}

describe.skipIf(!hasWasmPackage())("the reader over the Rust engine's wedding hall", () => {
  it("finds the hall on floors 100 to 104 and nothing above, before and after the view's facts are rebound", () => {
    const rust = towerWithHall();
    const reader = newViewReader(rust);
    const hall = reader.rooms.find((u) => u.kind === "weddingHall")!;
    expect(hall.floor).toBe(100);
    const check = () => {
      for (let floor = 100; floor <= 104; floor++) expect(reader.tower.unitAt(floor, hall.x + 1), `floor ${floor}`).toBe(hall);
      expect(reader.tower.unitAt(105, hall.x + 1)).toBeUndefined();
    };
    check();
    // The scene, the UI or another tower binds the view's facts to the TypeScript tables' catalog.
    bindViewKinds(catalogFor("classic"));
    reader.update();
    check();
  }, 60_000);
});

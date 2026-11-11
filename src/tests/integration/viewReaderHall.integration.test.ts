import { afterEach, describe, expect, it } from "vitest";
import { towerCatalog } from "../../catalog/towerCatalog";
import { portOf } from "../../game/cardKit.fixture";
import { draftTower } from "../portKit/drafts";
import type { EnginePort } from "../../simport/enginePort";
import { newRenderSim, newViewReader } from "../../game/portAccess";
import { bindViewKinds, findViewKind } from "../../presentation/viewKinds";
import { catalogFor } from "../catalogFixture";
import { readCatalog } from "../../dualrun/catalog";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";

/**
 * The reader over the Rust engine sizes the wedding hall as the engine does:
 * five stories, floors 100 to 104, nothing on 105. The height comes from the
 * port's own catalog, so it holds after the view's kind facts are bound to
 * another catalog (a scene or a swapped-in tower binds them again).
 */


afterEach(() => {
  bindViewKinds(catalogFor("modern"));
});

const HALL_X = 100;

/** A tower reaching floor 100 with a wedding hall on top, built on the Rust engine. */
function towerWithHall(): EnginePort {
  const built = draftTower(5, "modern");
  built.money = 1e9;
  built.star = 5;
  for (let x = HALL_X - 4; x < HALL_X + 36; x++) expect(built.tower.place("lobby", 1, x).ok).toBe(true);
  for (let floor = 2; floor <= 100; floor++) for (let x = HALL_X - 4; x < HALL_X + 36; x++) expect(built.tower.place("floor", floor, x).ok, `floor ${floor}`).toBe(true);
  built.settle();
  expect(built.build("weddingHall", 100, HALL_X).ok).toBe(true);
  return portOf(built);
}

describe.skipIf(!hasWasmPackage())("the reader over the Rust engine's wedding hall", () => {
  it("is sized from the Modern catalog because both modes of the Rust catalog state the same heights", () => {
    const modern = readCatalog(wasm(), "modern").facilities;
    const classic = new Map(readCatalog(wasm(), "classic").facilities.map((f) => [f.key, f.floors]));
    for (const f of modern) if (classic.has(f.key)) expect(classic.get(f.key), f.key).toBe(f.floors);
  });

  it("finds the hall on floors 100 to 104 and nothing above, before and after the view's facts are rebound", () => {
    const rust = towerWithHall();
    const reader = newViewReader(rust);
    const hall = reader.rooms.find((u) => u.kind === "weddingHall")!;
    // The frontend kind facts are bound from the live Rust source.
    expect(findViewKind("weddingHall")).toMatchObject({ width: 28, floors: 5 });
    const renderSim = newRenderSim(rust, reader);
    expect(towerCatalog(renderSim).economy.garbageCollectHour).toBe(readCatalog(wasm(), "modern").economy.garbageCollectHour);
    expect(hall.floor).toBe(100);
    const check = () => {
      for (let floor = 100; floor <= 104; floor++) expect(reader.tower.unitAt(floor, hall.x + 1), `floor ${floor}`).toBe(hall);
      for (const x of [hall.x, hall.x + hall.width - 1]) expect(reader.tower.unitAt(102, x), `edge ${x}`).toBe(hall);
      expect(reader.tower.unitAt(105, hall.x + 1)).toBeUndefined();
      expect(reader.tower.unitAt(99, hall.x + 1)).not.toBe(hall);
      for (const x of [hall.x - 1, hall.x + hall.width]) expect(reader.tower.unitAt(102, x), `beside ${x}`).not.toBe(hall);
    };
    check();
    // The scene, the UI or another tower binds the view's facts to another
    // catalog, here one whose hall is a single 16-tile story.
    const classic = catalogFor("classic");
    bindViewKinds({ ...classic, facilities: classic.facilities.map((f) => (f.key === "weddingHall" ? { ...f, floors: 1, width: 16 } : f)) });
    expect(findViewKind("weddingHall")).toMatchObject({ width: 16, floors: 1 });
    reader.update();
    check();
  }, 60_000);
});

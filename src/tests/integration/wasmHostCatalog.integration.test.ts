import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { catalogFor } from "../../engine/catalog";
import type { WasmModule } from "../../dualrun/binding";
import { attachMirror } from "../../dualrun/mirror";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { towerCatalog } from "../../engine/towerCatalog";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { loadFixture } from "../dualrun/dualRunHarness";

/**
 * The tower's catalog on the WASM host (#921): while a host runs the tower,
 * `towerCatalog(sim)` is the engine's (read through the binding), and the tower
 * goes back to the TypeScript tables when the host detaches. An attach the
 * host refuses leaves the tower reading the tables.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

/** The binding, with its catalog export counting the modes asked for and
 *  optionally rewriting the reply, and its engine builds counted. */
function countingModule(rewrite?: (text: string) => string): { mod: WasmModule; asked: string[]; built: () => number } {
  const base = wasm();
  const asked: string[] = [];
  let builds = 0;
  const mod = Object.create(base) as WasmModule;
  const Engine = Object.create(base.Engine) as WasmModule["Engine"];
  Engine.fromSave = (...args: Parameters<WasmModule["Engine"]["fromSave"]>) => {
    builds++;
    return base.Engine.fromSave(...args);
  };
  mod.Engine = Engine;
  mod.catalog = (mode: string) => {
    asked.push(mode);
    const text = base.catalog!(mode);
    return rewrite ? rewrite(text) : text;
  };
  return { mod, asked, built: () => builds };
}

describe.skipIf(!hasWasmPackage())("a hosted tower reads the engine's catalog (#921)", () => {
  for (const mode of ["classic", "modern"] as const) {
    it(`${mode}: the catalog comes from the binding while attached, and from the tables after`, () => {
      const sim = Simulation.newGame(41, mode);
      const { mod, asked, built } = countingModule();
      const host = attachWasmHost(sim, mod);
      try {
        expect(built()).toBe(1);
        // Both modes are read once, at attach, before an engine is built.
        expect([...asked].sort()).toEqual(["classic", "modern"]);
        expect(towerCatalog(sim)).toEqual(catalogFor(mode));
        const other = mode === "classic" ? "modern" : "classic";
        expect(towerCatalog(sim, other)).toEqual(catalogFor(other));
        expect(towerCatalog(sim, other)).toBe(towerCatalog(sim, other));
        expect(asked).toHaveLength(2);
      } finally {
        host.detach();
      }
      const before = asked.length;
      expect(towerCatalog(sim)).toEqual(catalogFor(mode));
      expect(towerCatalog(sim, "modern")).toEqual(catalogFor("modern"));
      expect(asked.length).toBe(before);
    });
  }

  it("refuses a binding whose catalog this build cannot read, before building an engine", () => {
    const sim = Simulation.newGame(42, "classic");
    const { mod, built } = countingModule((text) => text.replace('"version":1', '"version":99'));
    expect(() => attachWasmHost(sim, mod)).toThrow(/catalog is version 99/);
    expect(built()).toBe(0);
    expect(towerCatalog(sim)).toEqual(catalogFor("classic"));
    // Nothing was attached: a fresh host attaches normally.
    const host = attachWasmHost(sim, wasm());
    host.detach();
  });

  it("refuses a binding that states a different world, before building an engine", () => {
    const sim = Simulation.newGame(45, "modern");
    const { mod, built } = countingModule((text) => text.replace('"lotWidth":375', '"lotWidth":376'));
    expect(() => attachWasmHost(sim, mod)).toThrow(/states a different world/);
    expect(built()).toBe(0);
    expect(towerCatalog(sim)).toEqual(catalogFor("modern"));
  });

  it("refuses a binding that differs in any one world field the read model applies", () => {
    // The preview and the build apply the tables' ground-floor rule, so a
    // binding with another ground floor would quote one price and charge another.
    const own = catalogFor("modern").world;
    const other = catalogFor("modern").facilities.find((f) => f.key !== own.groundFloorStructure)!.key;
    const changes = (Object.keys(own) as (keyof typeof own)[]).map((field): [keyof typeof own, unknown] => {
      const value = own[field];
      return [field, typeof value === "number" ? value + 1 : other];
    });
    expect(changes.map(([field]) => field).sort()).toEqual(["groundFloor", "groundFloorStructure", "lobbyInterval", "lotWidth", "maxFloor", "minFloor"]);
    for (const [field, value] of changes) {
      const sim = Simulation.newGame(46, "modern");
      const { mod, built } = countingModule((text) => editCatalog(text, (c) => {
        c.world[field] = value;
      }));
      expect(() => attachWasmHost(sim, mod)).toThrow(`states a different world from this build's tables (${field})`);
      expect(built()).toBe(0);
      expect(towerCatalog(sim)).toEqual(catalogFor("modern"));
    }
  });

  it("refuses a binding that lists a facility kind this build cannot draw, drops one or lists one twice", () => {
    // A kind no pool lists and the world does not name, so the catalog reader
    // accepts the first three edits and the attach guard is what refuses them.
    // The reader itself refuses a repeated kind; the case pins that it never
    // reaches the host either.
    const own = catalogFor("modern");
    const pooled = new Set(own.pools.flatMap((p) => p.kinds));
    const free = own.facilities.find((f) => !pooled.has(f.key) && f.key !== own.world.groundFloorStructure)!.key;
    const cases: [string, (c: EditableCatalog) => void, RegExp][] = [
      ["added", (c) => void c.facilities.push({ ...c.facilities.find((f) => f.key === free)!, key: "spaceport" }), /unknown spaceport\)/],
      ["renamed", (c) => void (c.facilities.find((f) => f.key === free)!.key = "spaceport"), new RegExp(`unknown spaceport; missing ${free}\\)`)],
      ["dropped", (c) => void (c.facilities = c.facilities.filter((f) => f.key !== free)), new RegExp(`missing ${free}\\)`)],
      ["repeated", (c) => void c.facilities.push({ ...c.facilities.find((f) => f.key === free)! }), new RegExp(`${free} is listed twice`)],
    ];
    for (const [, edit, message] of cases) {
      const sim = Simulation.newGame(47, "modern");
      const { mod, built } = countingModule((text) => editCatalog(text, edit));
      expect(() => attachWasmHost(sim, mod)).toThrow(message);
      expect(built()).toBe(0);
      expect(towerCatalog(sim)).toEqual(catalogFor("modern"));
    }
  });

  it("checks the other mode's catalog too: a Classic tower refuses a binding whose Modern world differs", () => {
    const sim = Simulation.newGame(48, "classic");
    const { mod, built } = countingModule((text) => editCatalog(text, (c) => {
      c.world.lobbyInterval = (c.world.lobbyInterval as number) + 1;
    }));
    expect(() => attachWasmHost(sim, mod)).toThrow("modern catalog states a different world from this build's tables (lobbyInterval)");
    expect(built()).toBe(0);
    expect(towerCatalog(sim)).toEqual(catalogFor("classic"));
  });

  it("refuses a binding whose other mode's catalog is unreadable, so no render meets it later", () => {
    // A Classic tower reads the Modern catalog too (its patronage yardstick),
    // so both modes are checked at attach.
    const sim = Simulation.newGame(44, "classic");
    const { mod, built } = countingModule((text) => (text.includes('"mode":"modern"') ? text.replace('"version":1', '"version":99') : text));
    expect(() => attachWasmHost(sim, mod)).toThrow(/catalog is version 99/);
    expect(built()).toBe(0);
    expect(towerCatalog(sim, "modern")).toEqual(catalogFor("modern"));
  });

  it("leaves the tables in place when it refuses a tower whose crowd already exists", () => {
    const sim = loadFixture("conformance/fixtures/towerone-star4.vctower");
    sim.tick(60);
    expect(sim.crowd.people.length).toBeGreaterThan(0);
    const { mod, asked, built } = countingModule();
    expect(() => attachWasmHost(sim, mod)).toThrow(/crowd/);
    expect(built()).toBe(0);
    const before = asked.length;
    expect(towerCatalog(sim)).toEqual(catalogFor(sim.mode));
    expect(towerCatalog(sim, "modern")).toEqual(catalogFor("modern"));
    expect(asked.length).toBe(before);
  });

  it("leaves the tables in place when the attach is refused after the catalog was read", () => {
    const sim = Simulation.newGame(43, "classic");
    const detachMirror = attachMirror(sim, () => {});
    const { mod, asked, built } = countingModule();
    try {
      expect(() => attachWasmHost(sim, mod)).toThrow(/already attached/);
    } finally {
      detachMirror();
    }
    // This refusal comes after the engine is built (the host frees it); the
    // source is still never switched.
    expect(built()).toBe(1);
    const before = asked.length;
    expect(towerCatalog(sim, "modern")).toEqual(catalogFor("modern"));
    expect(asked.length).toBe(before);
  });
});

type EditableCatalog = { mode: string; world: Record<string, unknown>; facilities: { key: string }[] };

/** Edits the Modern catalog's JSON (the binding answers both modes through
 *  the same export), leaving the Classic one as the engine wrote it. */
function editCatalog(text: string, edit: (c: EditableCatalog) => void): string {
  const c = JSON.parse(text) as EditableCatalog;
  if (c.mode !== "modern") return text;
  edit(c);
  return JSON.stringify(c);
}

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readCatalog } from "../../engineBinding/catalog";
import type { GameMode } from "../../shared/types";
import { REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../engineBinding/binding";

/**
 * `canBuild(kind, floor, x)` through the WASM binding (#922): the dry run a
 * frontend's ghost and price label read before `build`. The dry run must say
 * what `build` then does: a refusal is the refusal `build` gives (same reason,
 * no money spent), and an accepted quote is the exact charge `build` makes (the
 * facility, the floor tiles laid under a room, and the tiles bridged to the
 * tower when bridging is on). The sweep covers every catalog kind over a grid of
 * floors and positions, on new games and saved towers in both modes (two of
 * them raised to the TOWER rating so the star-gated rules answer), with
 * bridging on and off where the mode allows it, and with money flush, short,
 * and exactly at a price. Until #1875 this suite compared each answer with the
 * TypeScript engine's; the engine's own placement rules are pinned by the Rust
 * tests in `engine-rs/src/tower_scans_tests.rs` and the conformance scenarios.
 */

type Quote = { ok: boolean; reason?: string; cost: number };

const FLOORS = [-10, -9, -4, -1, 0, 1, 2, 3, 4, 5, 6, 9, 11, 15, 16, 30, 31, 61, 100, 101];
const XS = [-3, 0, 1, 37, 88, 120, 150, 151, 160, 175, 199, 240, 300, 371, 372, 380, 1000];

type Start = { label: string; seed?: number; fixture?: string; mode: GameMode; star?: number };
const STARTS: Start[] = [
  { label: "new Classic game", seed: 7, mode: "classic" },
  { label: "new Modern game", seed: 7, mode: "modern" },
  { label: "towerone_6 in Classic", fixture: "conformance/fixtures/towerone_6.vctower", mode: "classic" },
  { label: "sixseven-december in Modern", fixture: "conformance/fixtures/sixseven-december.vctower", mode: "modern" },
  { label: "towerone_6 at TOWER rating in Classic", fixture: "conformance/fixtures/towerone_6.vctower", mode: "classic", star: 6 },
  { label: "towerone-star4 at TOWER rating in Modern", fixture: "conformance/fixtures/towerone-star4.vctower", mode: "modern", star: 6 },
];

function open(start: Start): WasmEngine {
  const { Engine } = wasm();
  if (start.seed !== undefined) return Engine.newGame(start.seed, start.mode);
  const engine = Engine.fromVctower(readFileSync(resolve(REPO_ROOT, start.fixture!), "utf8"), start.mode);
  if (start.star === undefined) return engine;
  // Raise the rating through the save, the way a loaded tower carries it.
  const save = JSON.parse(engine.serialize()) as { star: number };
  engine.free();
  save.star = start.star;
  return Engine.fromSave(JSON.stringify(save));
}

const quote = (engine: WasmEngine, kind: string, floor: number, x: number): Quote =>
  JSON.parse(engine.canBuild(kind, floor, x)) as Quote;
const build = (engine: WasmEngine, kind: string, floor: number, x: number): { ok: boolean; reason?: string } =>
  JSON.parse(engine.build(kind, floor, x)) as { ok: boolean; reason?: string };

/** Sweeps the grid: every refusal is checked against `build` on the same tower
 *  (a refused build changes nothing), and the first accepted placement of each
 *  kind is built on a copy to compare the charge with the quote. */
function sweep(engine: WasmEngine, kinds: readonly string[]): { ok: number; diffs: string[] } {
  const { Engine } = wasm();
  const diffs: string[] = [];
  const charged = new Set<string>();
  let ok = 0;
  for (const kind of kinds) {
    for (const floor of FLOORS) {
      for (const x of XS) {
        const q = quote(engine, kind, floor, x);
        const at = `${kind} @ ${floor},${x}`;
        if (!q.ok) {
          const before = engine.money();
          const r = build(engine, kind, floor, x);
          if (r.ok || r.reason !== q.reason || engine.money() !== before) {
            diffs.push(`${at}: quote ${JSON.stringify(q)} build ${JSON.stringify(r)}`);
          }
          continue;
        }
        ok++;
        if (charged.has(kind)) continue;
        charged.add(kind);
        const copy = Engine.fromSave(engine.serialize());
        try {
          const before = copy.money();
          const r = build(copy, kind, floor, x);
          if (!r.ok || before - copy.money() !== q.cost) {
            diffs.push(`${at}: quote ${JSON.stringify(q)} build ${JSON.stringify(r)} charged ${before - copy.money()}`);
          }
        } finally {
          copy.free();
        }
      }
    }
  }
  return { ok, diffs };
}

describe.skipIf(!hasWasmPackage())("canBuild through the WASM binding says what build does", () => {
  for (const start of STARTS) {
    it(`${start.label}: bridging on and off where the mode allows, flush, short and exactly at a price`, () => {
      const engine = open(start);
      try {
        expect(engine.mode()).toBe(start.mode);
        const catalog = readCatalog(wasm(), start.mode);
        const kinds = catalog.facilities.map((f) => f.key);
        const cost = (key: string): number => catalog.facilities.find((f) => f.key === key)!.cost;
        const before = engine.serialize();
        const startMoney = engine.money();
        const startBridging = engine.autoBridge();
        let accepted = 0;
        // A lobby tile's price over a floor tile, and where there is no floor
        // yet, so the money check's boundary (afford at equal) is met
        // wherever the grid meets either.
        for (const money of [1e9, 1_200, cost("lobby"), cost("lobby") + cost("floor")]) {
          engine.setMoney(money);
          for (const bridging of [false, true]) {
            if (engine.autoBridge() !== bridging) engine.toggleAutoBridge();
            // Classic cannot switch bridging off: both passes run with it on there.
            expect(engine.autoBridge()).toBe(start.mode === "classic" ? true : bridging);
            const r = sweep(engine, kinds);
            expect(r.diffs.slice(0, 10)).toEqual([]);
            accepted += r.ok;
          }
        }
        // The grid must reach accepted placements too, or it only checks refusals.
        expect(accepted).toBeGreaterThan(0);
        // Every refused build left the tower as it was (money aside, which the sweep set).
        engine.setMoney(startMoney);
        if (engine.autoBridge() !== startBridging) engine.toggleAutoBridge();
        expect(engine.serialize()).toBe(before);
      } finally {
        engine.free();
      }
    }, 120_000);
  }

  it("refuses an unknown kind with a zero price, without throwing", () => {
    const engine = open(STARTS[0]!);
    try {
      expect(quote(engine, "castle", 2, 160)).toEqual({ ok: false, reason: "Unknown facility.", cost: 0 });
      expect(build(engine, "castle", 2, 160)).toEqual({ ok: false, reason: "Unknown facility." });
    } finally {
      engine.free();
    }
  });

  it("quotes the price build then charges", () => {
    const engine = open(STARTS[0]!);
    try {
      engine.setMoney(1e9);
      for (let x = 150; x < 175; x++) build(engine, "lobby", 1, x);
      // An office on floor 2 lays the floor tiles under it; the quote must equal the charge.
      const q = quote(engine, "office", 2, 152);
      expect(q).toMatchObject({ ok: true });
      expect(q.cost).toBeGreaterThan(readCatalog(wasm(), "classic").facilities.find((f) => f.key === "office")!.cost);
      const before = engine.money();
      expect(build(engine, "office", 2, 152)).toMatchObject({ ok: true });
      expect(before - engine.money()).toBe(q.cost);
    } finally {
      engine.free();
    }
  });
});

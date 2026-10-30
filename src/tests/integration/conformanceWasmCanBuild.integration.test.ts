import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES } from "../../engine/facilitiesData";
import type { FacilityKind, GameMode } from "../../engine/types";
import type { SerializedGame } from "../../engine/serializedGame";
import { decodeVctower } from "../../storage/vctowerContainer";
import { markFounderFromLoadedFile } from "../../engine/sim/founderStatus";
import { REPO_ROOT } from "../conformance/scenario";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../dualrun/binding";

/**
 * `canBuild(kind, floor, x)` through the WASM binding (#922): the dry run a
 * frontend's ghost and price label read before `build`. On the same tower the
 * Rust engine must give the TypeScript engine's answer, field for field: the
 * same refusal and reason, and the same full price (the facility, the floor
 * tiles laid under a room, and the tiles bridged to the tower when bridging is
 * on). The sweep covers every kind over a grid of floors
 * and positions, on new games and saved towers in both modes (two of them
 * raised to the TOWER rating so the star-gated rules answer), with bridging on
 * and off where the mode allows it, and with money flush, short, and exactly
 * at a price.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type Quote = { ok: boolean; reason?: string; cost: number };

// The metro is not swept: the Rust engine refuses it on a row that holds a room
// or above floors that exist below it (#1500), rules the TypeScript engine does
// not have. the metro tests in engine-rs `tower_scans_tests.rs` cover them.
const KINDS = (Object.keys(FACILITIES) as FacilityKind[]).filter((kind) => kind !== "metro");
// Floor -9 is not swept: the Rust engine keeps the bottom basement row for the
// metro tunnel (#1500), a rule the TypeScript engine does not have.
const FLOORS = [-10, -4, -1, 0, 1, 2, 3, 4, 5, 6, 9, 11, 15, 16, 30, 31, 61, 100, 101];
const XS = [-3, 0, 1, 37, 88, 120, 150, 151, 160, 175, 199, 240, 300, 371, 372, 380, 1000];

/** `star` raises a loaded tower's rating before both engines read it, so the
 *  kinds behind a star gate (the 2 and 3 star hotels, shops, services and
 *  parking, the Metro and its basement rule, the Wedding Hall and its crown
 *  floor) give compared placement answers instead of the gate's refusal. */
type Start = { label: string; seed?: number; fixture?: string; mode: GameMode; star?: number };
const STARTS: Start[] = [
  { label: "new Classic game", seed: 7, mode: "classic" },
  { label: "new Modern game", seed: 7, mode: "modern" },
  { label: "towerone_6 in Classic", fixture: "conformance/fixtures/towerone_6.vctower", mode: "classic" },
  { label: "sixseven-december in Modern", fixture: "conformance/fixtures/sixseven-december.vctower", mode: "modern" },
  { label: "towerone_6 at TOWER rating in Classic", fixture: "conformance/fixtures/towerone_6.vctower", mode: "classic", star: 6 },
  { label: "towerone-star4 at TOWER rating in Modern", fixture: "conformance/fixtures/towerone-star4.vctower", mode: "modern", star: 6 },
];

function pair(start: Start): { sim: Simulation; engine: WasmEngine } {
  const { Engine } = wasm();
  if (start.seed !== undefined) return { sim: Simulation.newGame(start.seed, start.mode), engine: Engine.newGame(start.seed, start.mode) };
  const text = readFileSync(resolve(REPO_ROOT, start.fixture!), "utf8");
  const raw = decodeVctower(text, start.fixture!) as SerializedGame;
  raw.mode = start.mode;
  const sim = Simulation.deserialize(raw);
  markFounderFromLoadedFile(sim, raw);
  if (start.star === undefined) return { sim, engine: Engine.fromVctower(text, start.mode) };
  // Raise the rating, then hand both engines the same save text.
  sim.star = start.star;
  const save = JSON.stringify(sim.serialize());
  return { sim: Simulation.deserialize(JSON.parse(save) as SerializedGame), engine: Engine.fromSave(save) };
}

/** The TypeScript answer in the binding's shape: no `reason` key on success. */
const tsQuote = (sim: Simulation, kind: FacilityKind, floor: number, x: number): Quote => {
  const q = sim.canBuild(kind, floor, x);
  return q.reason === undefined ? { ok: q.ok, cost: q.cost } : { ok: q.ok, reason: q.reason, cost: q.cost };
};

/** Every (kind, floor, x) whose answers differ, as readable lines. */
function sweep(sim: Simulation, engine: WasmEngine): { checked: number; ok: number; diffs: string[] } {
  const diffs: string[] = [];
  let checked = 0;
  let ok = 0;
  for (const kind of KINDS) {
    // Only the Rust engine builds the wedding hall as the 28 wide, five story
    // cathedral, and only it reserves Classic's floor 100 for that hall.
    if (kind === "weddingHall") continue;
    for (const floor of FLOORS) {
      if (sim.mode === "classic" && floor + (FACILITIES[kind].floors ?? 1) > 100 && floor <= 100) continue;
      for (const x of XS) {
        const want = tsQuote(sim, kind, floor, x);
        const got = JSON.parse(engine.canBuild(kind, floor, x)) as Quote;
        checked++;
        if (want.ok) ok++;
        if (!isDeepStrictEqual(got, want)) diffs.push(`${kind} @ ${floor},${x}: rust ${JSON.stringify(got)} ts ${JSON.stringify(want)}`);
      }
    }
  }
  return { checked, ok, diffs };
}

describe.skipIf(!hasWasmPackage())("canBuild through the WASM binding matches the TypeScript engine", () => {
  for (const start of STARTS) {
    it(`${start.label}: bridging on and off where the mode allows, flush, short and exactly at a price`, () => {
      const { sim, engine } = pair(start);
      try {
        expect(engine.mode()).toBe(sim.mode);
        let accepted = 0;
        // 5,000 is exactly a ground-floor lobby tile, so the money check's
        // boundary (afford at equal) is compared too.
        for (const money of [1e9, 1_200, 5_000]) {
          sim.money = money;
          engine.setMoney(money);
          for (const bridging of [false, true]) {
            if (sim.autoBridge !== bridging) sim.toggleAutoBridge();
            if (engine.autoBridge() !== bridging) engine.toggleAutoBridge();
            // Classic cannot switch bridging off: both passes run with it on there.
            expect(sim.autoBridge).toBe(start.mode === "classic" ? true : bridging);
            expect(engine.autoBridge()).toBe(sim.autoBridge);
            const r = sweep(sim, engine);
            expect(r.diffs.slice(0, 10)).toEqual([]);
            accepted += r.ok;
          }
        }
        // The grid must reach accepted placements too, or it only compares refusals.
        expect(accepted).toBeGreaterThan(0);
      } finally {
        engine.free();
      }
    }, 120_000);
  }

  it("answers an unknown kind the way TypeScript does, without throwing", () => {
    const { sim, engine } = pair(STARTS[0]!);
    try {
      const want = sim.canBuild("castle" as FacilityKind, 2, 160);
      expect(JSON.parse(engine.canBuild("castle", 2, 160))).toEqual(want);
    } finally {
      engine.free();
    }
  });

  it("quotes the price build then charges", () => {
    const { engine } = pair(STARTS[0]!);
    try {
      engine.setMoney(1e9);
      for (let x = 150; x < 175; x++) JSON.parse(engine.build("lobby", 1, x));
      // An office on floor 2 lays the floor tiles under it; the quote must equal the charge.
      const quote = JSON.parse(engine.canBuild("office", 2, 152)) as Quote;
      expect(quote).toMatchObject({ ok: true });
      expect(quote.cost).toBeGreaterThan(FACILITIES.office.cost);
      const before = engine.money();
      expect(JSON.parse(engine.build("office", 2, 152))).toMatchObject({ ok: true });
      expect(before - engine.money()).toBe(quote.cost);
    } finally {
      engine.free();
    }
  });
});

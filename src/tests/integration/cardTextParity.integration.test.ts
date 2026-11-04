import { describe, expect, it } from "vitest";
import { html } from "lit-html";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES, facilityFloors } from "../../engine/facilities";
import type { FacilityKind, GameMode, UnitState } from "../../engine/types";
import { facilityDiagnostics, transportDiagnostics } from "../../game/facilityDiagnostics";
import { createCardKit } from "../../game/cardKit";
import type { EnginePort } from "../../simport/enginePort";
import { ViewReader } from "../../simport/viewReader";
import { renderToFragment } from "../../ui/testing/litTestUtils";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { lobbyDistanceFixture, retailServiceFixture, serviceDiagnosticsFixture } from "../fixtures/serviceDiagnostics.fixture";
import { buildWinningTower } from "../fixtures/winningTower";

/**
 * The card-text sweep (#1561's canary): the inspector and editor lines the
 * TypeScript reference printed for a room, against the lines the shipped
 * Rust-backed card prints for the same saved tower, room by room. The facts
 * tests (`conformanceWasmDiagnostics`) only check lines a fact section names,
 * so a line the reference drew with no fact behind it (the shoppers-too-far
 * line) slipped through; this compares the text itself, in card order. A
 * comparison as a set missed that the Rust card put a venue's business block
 * above its notice (the every-kind case puts a shop on notice, a state only a
 * save can hold, since play gives notice to lease tenants alone).
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but the engine's WASM package was not built");

type RustPort = EnginePort & { free(): void };

const textOf = (parts: readonly unknown[]): string[] =>
  parts.map((p) => (renderToFragment(html`${p}`).textContent ?? "").trim()).filter(Boolean);

function winning(mode: GameMode): Simulation {
  const sim = Simulation.newGame(5, mode);
  buildWinningTower(sim, { officeTop: 12 });
  return sim;
}

/** A tower with every rentable room made unhappy, so the gripe, notice and
 *  won't-lease branches have something to say. */
function unhappy(sim: Simulation): Simulation {
  for (const u of sim.tower.units) {
    if (u.state === "occupied" || u.state === "asleep") u.satisfaction = 0.2;
  }
  return sim;
}

/** One of every room kind the lot accepts, each on its own stretch of a tall
 *  slab tower, all put in `state`. Kinds that need special ground (basement,
 *  rooftop, transport) are skipped when the tower refuses them. */
function everyKind(mode: GameMode, state: UnitState): Simulation {
  const sim = Simulation.newGame(9, mode);
  sim.money = 1e12;
  sim.star = 5;
  const W = 250;
  const slab = (kind: "lobby" | "floor", f: number, x: number) => {
    const r = sim.tower.place(kind, f, x);
    if (!r.ok) throw new Error(`${kind} at floor ${f}, x ${x}: ${r.reason}`);
  };
  for (let x = 0; x < W; x++) slab("lobby", 1, x);
  for (let f = 2; f <= 40; f++) for (let x = 0; x < W; x++) slab("floor", f, x);
  const kinds = (Object.keys(FACILITIES) as FacilityKind[]).filter((k) => !FACILITIES[k].transport && k !== "floor" && k !== "lobby");
  let floor = 3;
  let x = 2;
  const skipped: FacilityKind[] = [];
  for (const k of kinds) {
    const width = FACILITIES[k].width;
    if (x + width > W) { x = 2; floor += 4; }
    if (floor > 38) throw new Error(`no room left for ${k}; widen the fixture`);
    const r = sim.tower.place(k, floor, x);
    if (r.ok) x += width + 1;
    else skipped.push(k);
  }
  // Only kinds that need ground the slab tower lacks may be refused: the
  // basement kinds, and the wedding hall (it sits in a fixed 100-104 floor
  // band no slab tower here reaches).
  const unexpected = skipped.filter((k) => !FACILITIES[k].basement && k !== "weddingHall");
  if (unexpected.length > 0) throw new Error(`refused placements: ${unexpected.join(", ")}`);
  for (const u of sim.tower.units) {
    if (u.kind === "floor" || u.kind === "lobby") continue;
    u.state = state;
    u.satisfaction = 0.25;
    if (state !== "empty" && state !== "construction") u.everOccupied = true;
    if (state === "vacating") { u.vacateReason = "rent"; u.vacateAt = sim.clock.minutes + 600; }
    u.patronageToday = 12;
    u.patronageYest = 30;
    u.profitYest = 400;
  }
  return sim;
}

/** Every passenger and service transport, with car counts that put some shafts
 *  past the near-capacity line once the sim has run a few hours. */
function everyTransport(mode: GameMode): Simulation {
  const sim = Simulation.newGame(4, mode);
  sim.money = 1e12;
  sim.star = 5;
  for (let x = 0; x < 200; x++) sim.tower.place("lobby", 1, x);
  for (let f = 2; f <= 30; f++) for (let x = 0; x < 200; x++) sim.tower.place("floor", f, x);
  let x = 4;
  for (const [kind, top] of [
    ["elevatorStandard", 20], ["elevatorService", 12], ["elevatorExpress", 28], ["stairs", 2], ["escalator", 2],
  ] as const) {
    const r = sim.tower.placeTransport(kind, x, 1, top);
    if (!r.ok) throw new Error(`${kind}: ${r.reason}`);
    x += FACILITIES[kind].width + 2;
  }
  for (let i = 0; i < 48; i++) sim.tick(10);
  return sim;
}

const STATES: readonly UnitState[] = ["empty", "occupied", "vacating", "construction", "fire", "gutted", "dirty"];

const CASES: ReadonlyArray<readonly [string, (mode: GameMode) => Simulation]> = [
  ["service rooms", (m) => serviceDiagnosticsFixture(m).sim],
  ["service rooms, unhappy", (m) => unhappy(serviceDiagnosticsFixture(m).sim)],
  ["retail venues", (m) => retailServiceFixture(m).sim],
  ["lobby distance", (m) => lobbyDistanceFixture(m).sim],
  ["lobby distance, unhappy", (m) => unhappy(lobbyDistanceFixture(m).sim)],
  ...STATES.map((st) => [`every kind, ${st}`, (m: GameMode) => everyKind(m, st)] as const),
  ["every transport", everyTransport],
  ["winning tower", winning],
  ["winning tower, unhappy", (m) => unhappy(winning(m))],
];

describe.skipIf(!hasWasmPackage())("the Rust card prints the lines the TypeScript card did", () => {
  for (const mode of ["classic", "modern"] as const) {
    for (const [name, build] of CASES) {
      it(`${mode}: ${name}`, () => {
        const sim = build(mode);
        const rust = wasm().Engine.fromSave(JSON.stringify(sim.serialize())) as unknown as RustPort;
        try {
          const kit = createCardKit({ enginePort: rust, reader: new ViewReader(rust, facilityFloors) });
          const misses: string[] = [];
          let compared = 0;
          let shoppers = 0;
          for (const u of sim.tower.units) {
            if (u.kind === "floor" || u.kind === "lobby") continue;
            const want = textOf(facilityDiagnostics(sim, u));
            const got = textOf(kit.diagnostics.unit(u.id, true));
            compared += want.length;
            shoppers += want.filter((l) => l.startsWith("Shoppers:")).length;
            if (JSON.stringify(want) !== JSON.stringify(got)) {
              misses.push(`${u.kind} #${u.id} floor ${u.floor}\n  TS:   ${JSON.stringify(want)}\n  Rust: ${JSON.stringify(got)}`);
            }
          }
          for (const t of sim.tower.transports) {
            if (!FACILITIES[t.kind]) continue;
            // A shaft with no measured trip yet read "Avg load: 0% full" on the
            // TypeScript card; the Rust card prints no load line until the
            // engine has a measurement. A deliberate, harmless difference.
            const want = textOf(transportDiagnostics(sim, t)).filter((l) => l !== "Avg load: 0% full");
            const got = textOf(kit.diagnostics.transport(t.id));
            if (JSON.stringify(want) !== JSON.stringify(got)) misses.push(`${t.kind} #${t.id}\n  TS:   ${JSON.stringify(want)}\n  Rust: ${JSON.stringify(got)}`);
          }
          expect(misses.slice(0, 6).join("\n")).toBe("");
          // Both sides printing nothing would also agree, so insist the sweep read real lines.
          if (name !== "every transport") expect(compared, `${mode}: ${name} compared no lines`).toBeGreaterThan(0);
          if (name === "lobby distance") expect(shoppers, `${mode}: the far shop must carry the warning`).toBe(1);
          if (name.startsWith("every kind")) {
            const kinds = new Set(sim.tower.units.map((q) => q.kind));
            expect(kinds.size, `${mode}: ${name} placed too few kinds`).toBeGreaterThan(25);
          }
        } finally {
          rust.free();
        }
      });
    }
  }
});

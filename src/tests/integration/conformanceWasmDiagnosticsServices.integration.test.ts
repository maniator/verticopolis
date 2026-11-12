import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { SerializedGame, Unit } from "../../shared/types";
import { isOperational } from "../../shared/unitState";
import { catalogFacility } from "../../catalog/catalogTypes";
import { catalogFor } from "../catalogFixture";
import type { ServiceDiagnosticFacts } from "../../simport/enginePort";
import {
  CONFORMANCE_DIR,
  firstDivergence,
  loadScenario,
  runScenario,
  type Checkpoint,
  type ScenarioEngine,
} from "../conformance/scenario";
import { hasWasmPackage, reloadWasmHandle, startWasmHandle, wasmEngine } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../dualrun/binding";
import viewLayout from "../../simport/fixtures/viewLayout.json";

/**
 * The service, venue and transport facts behind the card (#1215, facade slice
 * 6c, families 2 to 4) over the whole conformance corpus on the Rust engine,
 * as `conformanceWasmDiagnostics` does for the tenant family. Every scenario
 * runs, and the engine is asked at every checkpoint, before the state is
 * hashed, and on each side of a reload: every room's `serviceDiagnostics`
 * (hotel, parking, housekeeping, retail and the venue's lobby distance), the
 * first floor tile's and the first lobby tile's, every shaft's `shaftCard`
 * (which carries the elevator load and the near-capacity advice) and the
 * tower's three recycling reads. The run must still reproduce the pinned
 * checkpoints, which is the proof that asking moves no hash, every room and
 * shaft must answer, and an inert service room must answer no service section.
 * A read that raises a gameplay event the next checkpoint would not hash (the
 * one before a reload, or the last one) fails the run. What each answer says
 * is held by the Rust tests (`wasm_port_reports_tests`) and, on the card, by
 * `cardVerdicts` and `cardTextParity`; the TypeScript reference these reads
 * were once compared with is gone.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const lock = JSON.parse(readFileSync(resolve(CONFORMANCE_DIR, "expected.json"), "utf8")) as { scenarios: Record<string, Checkpoint[]> };
const files = readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();


/** The tower's recycling reads: capacity, fill and whether demand is met. */
interface Recycling { capacity: number; fill: number; met: boolean }

/** A shaft card as the engine writes it: the typed array's kind and its slots. */
interface Card { type: string; slots: number[] }

/** One read: the rooms and shafts asked about and what the engine gave. */
interface Read {
  rooms: number[];
  shafts: number[];
  facts: ServiceDiagnosticFacts[];
  cards: Card[];
  recycling: Recycling;
}

/** Every room, plus the first floor tile and the first lobby tile (which
 *  carry no service section; the rest are skipped for time), in tower order. */
function roomIds(units: readonly Pick<Unit, "id" | "kind">[]): number[] {
  const floor = units.find((u) => u.kind === "floor");
  const lobby = units.find((u) => u.kind === "lobby");
  return units.filter((u) => (u.kind !== "floor" && u.kind !== "lobby") || u === floor || u === lobby).map((u) => u.id);
}

const cardOf = (card: Float64Array | Int32Array | ArrayLike<number>): Card => ({ type: card.constructor.name, slots: Array.from(card) });

/** The kinds whose service sections an inert state (fire, gutted, under
 *  construction) switches off: parking, housekeeping and a venue's retail
 *  block. A venue's lobby distance is still answered. */
const isServiceKind = (kind: Unit["kind"]): boolean =>
  kind === "parking" || kind === "parkingRamp" || kind === "housekeeping" || catalogFacility(catalogFor("modern"), kind).commercial;

/** The kinds of the inert service rooms in each read, and of its shafts, for
 *  the tally. */
const inertOf = new WeakMap<Read, string[]>();
const shaftKindsOf = new WeakMap<Read, string[]>();

/** No gameplay event may be pending after the read before a reload or the
 *  read at the last checkpoint, since no later hash would see it. Before a
 *  reload the runner has just drained the scenario's own events, so one left
 *  there came from the read. At the last checkpoint one could also come from
 *  a command after it, so the message names only where it was found. */
function quiet(engine: ScenarioEngine, when: string): void {
  const left = engine.drainEvents();
  if (left.length > 0) throw new Error(`${left.length} gameplay event(s) pending after the read ${when}, which no hash sees`);
}

/** One read of the engine: every room's service facts, every shaft's card
 *  and the recycling reads. */
function read(handle: WasmEngine, reads: Read[]): void {
  const save = JSON.parse(handle.serialize()) as SerializedGame;
  const rooms = roomIds(save.units);
  const shafts = save.transports.map((t) => t.id);
  const read: Read = {
    rooms,
    shafts,
    facts: rooms.map((id) => {
      const facts = handle.serviceDiagnostics(id) as ServiceDiagnosticFacts | undefined;
      if (!facts) throw new Error(`serviceDiagnostics(${id}) answered nothing for a unit`);
      return facts;
    }),
    cards: shafts.map((id) => {
      const card = cardOf(handle.shaftCard(id));
      // A real shaft's card always carries its header, load slots included.
      if (card.slots.length <= Math.max(CARD_UTILIZATION, CARD_NEAR_CAPACITY)) {
        throw new Error(`shaftCard(${id}) answered ${card.slots.length} slots for a real shaft`);
      }
      return card;
    }),
    recycling: { capacity: handle.recyclingCapacity(), fill: handle.recyclingFill(), met: handle.recyclingDemandMet() },
  };
  // The save leaves an empty room's state out, as a load reads it.
  const inert = save.units.filter((u) => isServiceKind(u.kind) && !isOperational({ state: u.state ?? "empty" }));
  // An inert room switches those sections off.
  for (const u of inert) {
    const { parking, housekeeping, retail } = read.facts[rooms.indexOf(u.id)];
    if (parking.status !== "notApplicable" || housekeeping.status !== "notApplicable" || retail.active) {
      throw new Error(`the inert ${u.kind} ${u.id} still answers a service section`);
    }
  }
  inertOf.set(read, inert.map((u) => u.kind));
  shaftKindsOf.set(read, save.transports.map((t) => t.kind));
  reads.push(read);
}

/** Frees a handle on a path that is already failing, keeping that failure:
 *  the free's own error is dropped. */
function freeQuietly(free: () => void): void {
  try {
    free();
  } catch {
    // the error already on its way out is the one to report
  }
}

/** The Rust engine with a read before each hash and on each side of a
 *  reload. An event the read after a reload raises lands in the next hash.
 *  Its reload is
 *  `wasmEngine`'s (`reloadWasmHandle`, then the old handle freed, in
 *  `wasmEngine.ts`) with the reads around it, so a change there belongs here
 *  too. After a trap the instance is poisoned and its free can throw, which
 *  must not replace the error on its way out, as the runner has it
 *  (`scenario.ts`). */
function wasmWithReads(handle: WasmEngine, reads: Read[]): ScenarioEngine {
  const base = wasmEngine(handle);
  let freed = false;
  const release = (): void => {
    if (freed) return;
    freed = true;
    base.free?.();
  };
  return {
    ...base,
    stateDigest: () => {
      read(handle, reads);
      return base.stateDigest();
    },
    reload: () => {
      read(handle, reads);
      quiet(base, "before a reload");
      let loaded: WasmEngine;
      try {
        loaded = reloadWasmHandle(handle);
      } catch (e) {
        freeQuietly(release);
        throw e;
      }
      try {
        release();
        read(loaded, reads);
      } catch (e) {
        freeQuietly(() => loaded.free());
        throw e;
      }
      return wasmWithReads(loaded, reads);
    },
    // A second free, such as a runner's cleanup after a reload freed this
    // handle, does nothing.
    free: () => {
      if (freed) return;
      try {
        quiet(base, "at the last checkpoint");
      } catch (e) {
        freeQuietly(release);
        throw e;
      }
      release();
    },
  };
}

/** The `shaftCard` header slots this test tallies, by name from the view
 *  layout the engine writes its cards in. */
const CARD_UTILIZATION = viewLayout.records.shaftCard.indexOf("utilization");
const CARD_NEAR_CAPACITY = viewLayout.records.shaftCard.indexOf("nearCapacity");
/** A set flag slot holds 1 (the Rust port's `flag` in
 *  `engine-rs/src/wasm_port_panels.rs`, read the same way by `Cards` in
 *  `src/simport/cards.ts`). */
const FLAG_SET = 1;
const nearCapacity = (card: Card): boolean => card.slots[CARD_NEAR_CAPACITY] === FLAG_SET;

/** The sections the corpus reached when this test was written. A corpus or
 *  engine change that stops reaching one, or starts reaching a new one, fails
 *  the last test, so the run's coverage cannot change unseen. The inert
 *  cinema and shop come from ransom-ignored-modern, whose blast-gutted rooms
 *  only that scenario reaches; it ran past the TypeScript reference (#349) and
 *  rejoined the run when the reference was retired. A standard elevator near
 *  capacity left when venues began counting yesterday's visitors (#1500):
 *  the slower star pace thins the corpus's crowds below the cutoff, and
 *  `cardVerdicts.integration.test.ts` still pins the flag on both sides of it.
 *  When riders began boarding only a car stopped at their floor (#2051) the
 *  corpus moved twice more: an express elevator near capacity left, and an
 *  inert parking floor arrived, with the Classic ransom scenario now running
 *  544 hours to its threat instead of 352. The flag stays pinned on both
 *  sides by `cardVerdicts.integration.test.ts`. */
const CORPUS_SECTIONS: readonly string[] = [
  "commercial:lobbyFar:false", "commercial:lobbyFar:true",
  "hotel:counts:dirty", "hotel:counts:infested", "hotel:counts:other", "hotel:excluded:dirty", "hotel:excluded:other",
  "housekeeping:adequate", "housekeeping:nominalShortfall", "housekeeping:observedShortfall",
  "inert:amusements", "inert:boutiqueBay", "inert:daycare", "inert:fastFood", "inert:foodHall", "inert:housekeeping",
  "inert:nightclub", "inert:parking", "inert:skyBar", "inert:spa",
  "parking:connected", "parking:connected:short", "parking:disconnected", "parking:ramp", "parking:ramp:short",
  "recycling:met:filling",
  "retail:advice:none", "retail:advice:overBuilt", "retail:advice:underServed", "retail:rain",
  "retail:tier:average", "retail:tier:booming", "retail:tier:low", "retail:tier:noData",
  "shaft:idle:elevatorStandard", "shaft:load:elevatorExpress", "shaft:load:elevatorStandard",
  "shaft:noReading:elevatorExpress", "shaft:noReading:elevatorService", "shaft:noReading:elevatorStandard",
  "shaft:noReading:escalator", "shaft:noReading:stairs",
];

/** Which sections the corpus exercised, so a gap in the comparison shows,
 *  and the scenario files whose comparison passed, the only ones tallied. */
const seen = new Map<string, number>();
const passed = new Set<string>();
function bump(k: string): void {
  seen.set(k, (seen.get(k) ?? 0) + 1);
}
function tally(read: Read): void {
  for (const f of read.facts) {
    if (f.hotel.rating !== "notApplicable") bump(`hotel:${f.hotel.rating}:${f.hotel.condition}`);
    if (f.parking.status !== "notApplicable") bump(`parking:${f.parking.status}${f.parking.shortage ? ":short" : ""}`);
    if (f.housekeeping.status !== "notApplicable") bump(`housekeeping:${f.housekeeping.status}`);
    if (f.retail.active) {
      bump(`retail:tier:${f.retail.tier}`);
      bump(`retail:advice:${f.retail.advice}`);
      if (f.retail.rainy) bump("retail:rain");
    }
    if (f.commercial.lobbyFar !== null) bump(`commercial:lobbyFar:${f.commercial.lobbyFar}`);
  }
  const kinds = shaftKindsOf.get(read) ?? [];
  read.cards.forEach((card, i) => {
    const utilization = card.slots[CARD_UTILIZATION];
    if (utilization === undefined || Number.isNaN(utilization)) bump(`shaft:noReading:${kinds[i]}`);
    else bump(`shaft:${utilization > 0 ? "load" : "idle"}:${kinds[i]}`);
    if (nearCapacity(card)) bump(`shaft:nearCapacity:${kinds[i]}`);
  });
  if (read.recycling.capacity > 0) bump(`recycling:${read.recycling.met ? "met" : "over"}${read.recycling.fill > 0 ? ":filling" : ""}`);
  for (const kind of inertOf.get(read) ?? []) bump(`inert:${kind}`);
}

describe.skipIf(!hasWasmPackage())("service, venue and transport facts through the WASM binding", () => {
  it("finds the shaft card's load slots in the layout", () => {
    expect(CARD_UTILIZATION, "utilization").toBeGreaterThanOrEqual(0);
    expect(CARD_NEAR_CAPACITY, "nearCapacity").toBeGreaterThanOrEqual(0);
  });

  for (const file of files) {
    const scenario = loadScenario(resolve(SCENARIO_DIR, file));
    it(`${scenario.id}: every room's service facts, every shaft's card and the recycling reads answer without moving a hash`, () => {
      const pinned = lock.scenarios[scenario.id];
      if (!pinned?.length) throw new Error(`${scenario.id} has no checkpoints in the lock; regenerate it with the Rust run first`);
      const reads: Read[] = [];
      expect(firstDivergence(runScenario(scenario, (start) => wasmWithReads(startWasmHandle(start), reads)), pinned)).toBeNull();
      // One read per checkpoint and two per reload.
      const reloads = scenario.commands.filter((c) => c.op === "reload").length;
      expect(reads.length, `${scenario.id}: reads`).toBe(pinned.length + 2 * reloads);
      reads.forEach(tally);
      passed.add(file);
    }, 120_000);
  }

  it("reaches exactly the sections the corpus is known to reach", (ctx) => {
    // A -t run, or a scenario that failed above, leaves the tally partial.
    if (passed.size < files.length) {
      ctx.skip("the tally is partial because not every scenario finished; run the whole file to check it");
    }
    expect([...seen.keys()].sort()).toEqual([...CORPUS_SECTIONS].sort());
  });

  afterAll(() => {
    if (seen.size > 0) console.info(`service facts compared, by section: ${JSON.stringify(Object.fromEntries([...seen].sort()))}`);
  });
});

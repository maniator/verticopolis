import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Simulation } from "../../engine/Simulation";
import type { Unit } from "../../engine/types";
import { serviceDiagnostics } from "../../engine/port/reports";
import { shaftCard } from "../../engine/port/queries";
import { isCommercialKind } from "../../engine/facilities";
import { isOperational } from "../../shared/unitState";
import type { ServiceDiagnosticFacts } from "../../simport/enginePort";
import {
  CONFORMANCE_DIR,
  firstDivergence,
  loadScenario,
  reloadTsSim,
  runScenario,
  startTsSim,
  tsEngine,
  type Checkpoint,
  type ScenarioEngine,
  PAST_THE_TYPESCRIPT_REFERENCE,
} from "../conformance/scenario";
import { hasWasmPackage, reloadWasmHandle, startWasmHandle, wasmEngine, wasmRequired } from "../conformance/wasmEngine";
import type { WasmEngine } from "../../dualrun/binding";
import viewLayout from "../../engine/viewLayout.json";

/**
 * The service, venue and transport facts behind the card (#1215, facade slice
 * 6c, families 2 to 4) against the TypeScript reference, over the whole
 * conformance corpus, as `conformanceWasmDiagnostics` does for the tenant
 * family. Every scenario runs on each engine, and both are asked at every
 * checkpoint, before the state is hashed, and on each side of a reload: every
 * room's `serviceDiagnostics` (hotel, parking, housekeeping, retail and the
 * venue's lobby distance), the first floor tile's and the first lobby tile's,
 * every shaft's `shaftCard` (which carries the elevator load and the
 * near-capacity advice) and the tower's three recycling reads. The two runs
 * must agree read for read, and both must still reproduce the pinned
 * checkpoints, which is the proof that asking moves no hash on either engine.
 * A read that raises a gameplay event the next checkpoint would not hash (the
 * one before a reload, or the last one) fails the run.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const lock = JSON.parse(readFileSync(resolve(CONFORMANCE_DIR, "expected.json"), "utf8")) as { scenarios: Record<string, Checkpoint[]> };
const files = readdirSync(SCENARIO_DIR)
  .filter((f) => f.endsWith(".json") && !PAST_THE_TYPESCRIPT_REFERENCE.has(f))
  .sort();

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

/** The tower's recycling reads: capacity, fill and whether demand is met. */
interface Recycling { capacity: number; fill: number; met: boolean }

/** A shaft card as both engines write it: the typed array's kind and its slots. */
interface Card { type: string; slots: number[] }

/** One read: the rooms and shafts asked about and what each engine gave. */
interface Read {
  rooms: number[];
  shafts: number[];
  facts: ServiceDiagnosticFacts[];
  cards: Card[];
  recycling: Recycling;
}

/** Every room, plus the first floor tile and the first lobby tile (which
 *  carry no service section; the rest are skipped for time), in tower order. */
function roomIds(units: readonly Unit[]): number[] {
  const floor = units.find((u) => u.kind === "floor");
  const lobby = units.find((u) => u.kind === "lobby");
  return units.filter((u) => (u.kind !== "floor" && u.kind !== "lobby") || u === floor || u === lobby).map((u) => u.id);
}

const cardOf = (card: Float64Array | Int32Array | ArrayLike<number>): Card => ({ type: card.constructor.name, slots: Array.from(card) });

/** The kinds whose service sections an inert state (fire, gutted, under
 *  construction) switches off: parking, housekeeping and a venue's retail
 *  block. A venue's lobby distance is still answered. */
const isServiceKind = (kind: Unit["kind"]): boolean =>
  kind === "parking" || kind === "parkingRamp" || kind === "housekeeping" || isCommercialKind(kind);

/** The kinds of the inert service rooms in each TypeScript read, and of its
 *  shafts, for the tally only: the facts themselves are compared whatever the
 *  state. */
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

/** One read of the TypeScript engine. */
function readTs(sim: Simulation, reads: Read[]): void {
  const rooms = roomIds(sim.tower.units);
  const shafts = sim.tower.transports.map((t) => t.id);
  const read: Read = {
    rooms,
    shafts,
    facts: rooms.map((id) => {
      const facts = serviceDiagnostics(sim, id);
      if (!facts) throw new Error(`the reference's serviceDiagnostics(${id}) answered nothing for a unit`);
      return facts;
    }),
    cards: shafts.map((id) => {
      const card = cardOf(shaftCard(sim, id));
      // A real shaft's card always carries its header, load slots included.
      if (card.slots.length <= Math.max(CARD_UTILIZATION, CARD_NEAR_CAPACITY)) {
        throw new Error(`the reference's shaftCard(${id}) answered ${card.slots.length} slots for a real shaft`);
      }
      return card;
    }),
    recycling: { capacity: sim.recyclingCapacity(), fill: sim.recyclingFill(), met: sim.recyclingDemandMet() },
  };
  const inert = sim.tower.units.filter((u) => isServiceKind(u.kind) && !isOperational(u));
  // The reference switches those sections off, and the comparison holds the
  // Rust engine to the same answer.
  for (const u of inert) {
    const { parking, housekeeping, retail } = read.facts[rooms.indexOf(u.id)];
    if (parking.status !== "notApplicable" || housekeeping.status !== "notApplicable" || retail.active) {
      throw new Error(`the reference's inert ${u.kind} ${u.id} still answers a service section`);
    }
  }
  inertOf.set(read, inert.map((u) => u.kind));
  shaftKindsOf.set(read, sim.tower.transports.map((t) => t.kind));
  reads.push(read);
}

/** One read of the Rust engine, asked about the ids the TypeScript run read
 *  at the same point (the pinned hashes hold the two towers equal). */
function readRs(handle: WasmEngine, want: readonly Read[], reads: Read[]): void {
  const at = want[reads.length];
  if (!at) throw new Error(`the Rust run read ${reads.length + 1} times, more than the TypeScript run's ${want.length}`);
  const { rooms, shafts } = at;
  reads.push({
    rooms,
    shafts,
    facts: rooms.map((id) => {
      const facts = handle.serviceDiagnostics(id) as ServiceDiagnosticFacts | undefined;
      if (!facts) throw new Error(`the Rust serviceDiagnostics(${id}) answered nothing for a unit`);
      return facts;
    }),
    cards: shafts.map((id) => cardOf(handle.shaftCard(id))),
    recycling: { capacity: handle.recyclingCapacity(), fill: handle.recyclingFill(), met: handle.recyclingDemandMet() },
  });
}

/** The TypeScript engine with a read before each hash and on each side of a
 *  reload. An event the read after a reload raises lands in the next hash.
 *  Its reload is `tsEngine`'s (`reloadTsSim`, in `scenario.ts`) with the
 *  reads around it, so a change there belongs here too. */
function tsWithReads(sim: Simulation, reads: Read[]): ScenarioEngine {
  const base = tsEngine(sim);
  return {
    ...base,
    stateDigest: () => {
      readTs(sim, reads);
      return base.stateDigest();
    },
    reload: () => {
      readTs(sim, reads);
      quiet(base, "before a reload");
      const loaded = reloadTsSim(sim);
      readTs(loaded, reads);
      return tsWithReads(loaded, reads);
    },
    free: () => {
      quiet(base, "at the last checkpoint");
      base.free?.();
    },
  };
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

/** The Rust engine with the same reads at the same points. Its reload is
 *  `wasmEngine`'s (`reloadWasmHandle`, then the old handle freed, in
 *  `wasmEngine.ts`) with the reads around it, so a change there belongs here
 *  too. After a trap the instance is poisoned and its free can throw, which
 *  must not replace the error on its way out, as the runner has it
 *  (`scenario.ts`). */
function wasmWithReads(handle: WasmEngine, want: readonly Read[], reads: Read[]): ScenarioEngine {
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
      readRs(handle, want, reads);
      return base.stateDigest();
    },
    reload: () => {
      readRs(handle, want, reads);
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
        readRs(loaded, want, reads);
      } catch (e) {
        freeQuietly(() => loaded.free());
        throw e;
      }
      return wasmWithReads(loaded, want, reads);
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
 *  layout both engines write their cards in. */
const CARD_UTILIZATION = viewLayout.records.shaftCard.indexOf("utilization");
const CARD_NEAR_CAPACITY = viewLayout.records.shaftCard.indexOf("nearCapacity");
/** A set flag slot holds 1 (the Rust port's `flag` in
 *  `engine-rs/src/wasm_port_panels.rs`, read the same way by `Cards` in
 *  `src/simport/cards.ts`). */
const FLAG_SET = 1;
const nearCapacity = (card: Card): boolean => card.slots[CARD_NEAR_CAPACITY] === FLAG_SET;

/** The sections the corpus reached when this test was written. A corpus or
 *  engine change that stops reaching one, or starts reaching a new one, fails
 *  the last test, so the comparison's coverage cannot change unseen. An inert
 *  cinema and shop left with ransom-ignored-modern, whose blast-gutted rooms
 *  only that scenario reached; it is past the TypeScript reference now (#349),
 *  and the Rust engine's own lock still pins it. */
const CORPUS_SECTIONS: readonly string[] = [
  "commercial:lobbyFar:false", "commercial:lobbyFar:true",
  "hotel:counts:dirty", "hotel:counts:infested", "hotel:counts:other", "hotel:excluded:dirty", "hotel:excluded:other",
  "housekeeping:adequate", "housekeeping:nominalShortfall", "housekeeping:observedShortfall",
  "inert:amusements", "inert:boutiqueBay", "inert:daycare", "inert:fastFood", "inert:foodHall",
  "inert:nightclub", "inert:parking", "inert:skyBar", "inert:spa",
  "parking:connected", "parking:disconnected", "parking:ramp",
  "recycling:met:filling",
  "retail:advice:none", "retail:advice:overBuilt", "retail:advice:underServed", "retail:rain",
  "retail:tier:average", "retail:tier:booming", "retail:tier:low", "retail:tier:noData",
  "shaft:idle:elevatorStandard", "shaft:load:elevatorExpress", "shaft:load:elevatorStandard", "shaft:nearCapacity:elevatorStandard",
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
    it(`${scenario.id}: every room's service facts, every shaft's card and the recycling reads match the TypeScript reference`, () => {
      const pinned = lock.scenarios[scenario.id];
      if (!pinned?.length) throw new Error(`${scenario.id} has no checkpoints in the lock; regenerate it with the TypeScript run first`);
      const tsReads: Read[] = [];
      expect(firstDivergence(runScenario(scenario, (start) => tsWithReads(startTsSim(start), tsReads)), pinned)).toBeNull();
      const rsReads: Read[] = [];
      expect(firstDivergence(runScenario(scenario, (start) => wasmWithReads(startWasmHandle(start), tsReads, rsReads)), pinned)).toBeNull();
      // One read per checkpoint and two per reload, on each engine.
      const reloads = scenario.commands.filter((c) => c.op === "reload").length;
      expect(tsReads.length, `${scenario.id}: TypeScript reads`).toBe(pinned.length + 2 * reloads);
      expect(rsReads.length, `${scenario.id}: Rust reads`).toBe(tsReads.length);
      tsReads.forEach((want, i) => {
        const got = rsReads[i]!;
        // Drill to the first difference only when the read differs, so a
        // matching read builds no message per room.
        if (isDeepStrictEqual(got, want)) return;
        want.rooms.forEach((id, j) => {
          expect(got.facts[j], `${scenario.id}, read ${i}, unit ${id}`).toStrictEqual(want.facts[j]);
        });
        want.shafts.forEach((id, j) => {
          expect(got.cards[j], `${scenario.id}, read ${i}, shaft ${id}`).toStrictEqual(want.cards[j]);
        });
        expect(got.recycling, `${scenario.id}, read ${i}, recycling`).toStrictEqual(want.recycling);
        expect(got, `${scenario.id}, read ${i}`).toStrictEqual(want);
      });
      tsReads.forEach(tally);
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

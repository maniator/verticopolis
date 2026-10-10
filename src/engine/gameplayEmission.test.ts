import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Simulation } from "./Simulation";
import { canonicalJson } from "./canonicalJson";
import { crowdView, stateView } from "./conformanceView";
import { GAMEPLAY_RING_CAP, GameplayEventBuffer } from "./gameplayEventBuffer";
import { checkCatalog, checkEvent } from "./gameplayCatalog";
import { noteStars } from "./sim/star";
import type { GameplayEvent } from "./gameplayEvents";
import type { SerializedGame } from "./serializedGame";
import { decodeVctower } from "../storage/vctowerContainer";

/**
 * The TypeScript engine's gameplay event emission points, the mirror of the
 * Rust engine's (`engine-rs/src/gameplay.rs`). The conformance lock holds the
 * two streams to one hash per checkpoint; these pin each transition point
 * and the buffer's isolation from the save and the hashed views.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = checkCatalog(JSON.parse(readFileSync(resolve(root, "conformance/events/catalog.json"), "utf8")));

/** A founded tower with a lobby row and a floor above, its founding drained. */
function tower(mode: "classic" | "modern" = "classic"): Simulation {
  const sim = Simulation.newGame(7, mode);
  sim.money = 1e9;
  for (let x = 170; x < 210; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 210; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
  sim.drainGameplayEvents();
  return sim;
}

/** Drain, checking every event against the catalog on the way. */
function drain(sim: Simulation): GameplayEvent[] {
  const out = sim.drainGameplayEvents();
  for (const e of out) checkEvent(catalog, e);
  return out;
}

describe("gameplay event buffer", () => {
  it("drops the oldest event when full and counts it", () => {
    const buf = new GameplayEventBuffer();
    for (let i = 0; i < GAMEPLAY_RING_CAP + 5; i++) buf.push("facility_placed", { kind: "office", floor: i % 100, count: 1 });
    expect(buf.length).toBe(GAMEPLAY_RING_CAP);
    expect(buf.dropped).toBe(5);
    const out = buf.drain();
    expect(out).toHaveLength(GAMEPLAY_RING_CAP);
    expect(out[0]).toEqual({ name: "facility_placed", payload: { kind: "office", floor: 5, count: 1 } });
    expect(out[out.length - 1].payload).toEqual({ kind: "office", floor: (GAMEPLAY_RING_CAP + 4) % 100, count: 1 });
    expect(buf.length).toBe(0);
    expect(buf.drain()).toEqual([]);
    expect(buf.dropped).toBe(5);
  });

  it("inherits a replaced tower's owed events and drop count ahead of its own", () => {
    const old = tower();
    expect(old.build("office", 2, 180).ok).toBe(true);
    old.gameplayEvents.dropped = 3;
    const next = Simulation.newGame(8, "modern");
    next.gameplayEvents.inherit(old.gameplayEvents);
    expect(drain(next)).toEqual([
      { name: "facility_placed", payload: { kind: "office", floor: 2, count: 1 } },
      { name: "tower_founded", payload: { mode: "modern" } },
    ]);
    expect(next.gameplayEventsDropped).toBe(3);
    // The replaced buffer is left empty, so nothing is handed over twice.
    expect(old.gameplayEvents.length).toBe(0);
    expect(old.gameplayEventsDropped).toBe(0);
    // Inheriting from itself changes nothing, even on a marked buffer.
    next.gameplayEvents.push("fire_started", {});
    next.gameplayEvents.discardOnHandOff = true;
    next.gameplayEvents.inherit(next.gameplayEvents);
    next.gameplayEvents.discardOnHandOff = false;
    expect(drain(next)).toEqual([{ name: "fire_started", payload: {} }]);
    expect(next.gameplayEventsDropped).toBe(3);
    // Overflow drops the oldest (the inherited events first) and counts them.
    const full = new GameplayEventBuffer();
    for (let i = 0; i < GAMEPLAY_RING_CAP; i++) full.push("fire_started", {});
    const prev = new GameplayEventBuffer();
    prev.push("star_reached", { star: 2 });
    full.inherit(prev);
    expect(full.length).toBe(GAMEPLAY_RING_CAP);
    expect(full.dropped).toBe(1);
    expect(full.drain().some((e) => e.name === "star_reached")).toBe(false);
  });

  it("leaves a backdrop's events and drops behind", () => {
    const backdrop = Simulation.newGame(9, "classic");
    backdrop.gameplayEvents.discardOnHandOff = true;
    backdrop.gameplayEvents.dropped = 2;
    backdrop.gameplayEvents.push("fire_started", {});
    const next = Simulation.newGame(10, "modern");
    next.gameplayEvents.inherit(backdrop.gameplayEvents);
    expect(drain(next)).toEqual([{ name: "tower_founded", payload: { mode: "modern" } }]);
    expect(next.gameplayEventsDropped).toBe(0);
    expect(backdrop.gameplayEvents.length).toBe(0);
  });

  it("never reaches the save or the hashed views, full or empty", () => {
    const sim = tower("modern");
    sim.tick(180);
    sim.drainGameplayEvents();
    const save = JSON.stringify(sim.serialize());
    const state = canonicalJson(stateView(sim));
    const crowd = canonicalJson(crowdView(sim));
    for (let i = 0; i < GAMEPLAY_RING_CAP + 3; i++) sim.gameplayEvents.push("star_reached", { star: 2 + (i % 5) });
    // The ring this test filled (under the WASM host the app-facing count is the engine's).
    expect(sim.gameplayEvents.dropped).toBe(3);
    expect(JSON.stringify(sim.serialize())).toBe(save);
    expect(canonicalJson(stateView(sim))).toBe(state);
    expect(canonicalJson(crowdView(sim))).toBe(crowd);
    sim.drainGameplayEvents();
    expect(JSON.stringify(sim.serialize())).toBe(save);
    expect(canonicalJson(stateView(sim))).toBe(state);
    expect(canonicalJson(crowdView(sim))).toBe(crowd);
  });
});

describe("gameplay event emission", () => {
  it("founds a new tower once and loads a save silently", () => {
    const sim = Simulation.newGame(3, "modern");
    expect(drain(sim)).toEqual([{ name: "tower_founded", payload: { mode: "modern" } }]);
    const loaded = Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())) as SerializedGame);
    expect(loaded.drainGameplayEvents()).toEqual([]);
    // A real four-star save, with its milestones, stars, shafts and prices.
    const file = "src/tests/fixtures/towerone-star4.vctower";
    const raw = decodeVctower(readFileSync(resolve(root, file), "utf8"), file) as SerializedGame;
    expect(Simulation.deserialize(raw).drainGameplayEvents()).toEqual([]);
  });

  it("reports a placement by the kind placed and the top story it reaches", () => {
    const sim = Simulation.newGame(3, "classic");
    sim.money = 1e9;
    sim.drainGameplayEvents();
    // The Floor tool on the ground floor lays a lobby.
    expect(sim.build("floor", 1, 180).ok).toBe(true);
    expect(sim.build("office", 1, 180).ok).toBe(false); // a refusal emits nothing
    for (let x = 181; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    expect(sim.build("office", 2, 182).ok).toBe(true);
    for (let x = 191; x < 197; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
    expect(sim.buildTransport("stairs", 192, 1, 2).ok).toBe(true);
    const events = drain(sim);
    expect(events[0]).toEqual({ name: "facility_placed", payload: { kind: "lobby", floor: 1, count: 1 } });
    expect(events[20]).toEqual({ name: "facility_placed", payload: { kind: "office", floor: 2, count: 1 } });
    expect(events[events.length - 1]).toEqual({ name: "facility_placed", payload: { kind: "stairs", floor: 2, count: 1 } });
    expect(events).toHaveLength(28);
  });

  it("reports the engine's sell command, and nothing for the tower's raw removal", () => {
    const sim = tower();
    expect(sim.build("office", 2, 180).ok).toBe(true);
    expect(sim.buildTransport("stairs", 200, 1, 2).ok).toBe(true);
    sim.drainGameplayEvents();
    expect(sim.sellAt(2, 180)).toBe(true);
    expect(sim.sellAt(2, 200)).toBe(true);
    expect(sim.sellAt(2, 209)).toBe(true); // an unloaded floor tile at the edge
    expect(drain(sim)).toEqual([
      { name: "facility_removed", payload: { kind: "office", method: "sell" } },
      { name: "facility_removed", payload: { kind: "stairs", method: "sell" } },
      { name: "facility_removed", payload: { kind: "floor", method: "sell" } },
    ]);
    const u = sim.tower.unitAt(2, 190)!;
    expect(sim.tower.removeUnit(u.id)).toBeDefined();
    expect(sim.drainGameplayEvents()).toEqual([]);
  });

  it("reports price changes, one per batch, and nothing for a refusal or a no-op", () => {
    const sim = tower();
    expect(sim.build("office", 2, 180).ok).toBe(true);
    expect(sim.build("office", 2, 190).ok).toBe(true);
    sim.drainGameplayEvents();
    const office = sim.tower.unitAt(2, 180)!;
    expect(sim.adjustRent(office.id, 1)).not.toBeNull();
    const price = sim.priceUnit(office, 9000)!;
    expect(sim.priceUnit(office, price)).toBe(price); // the same price
    expect(sim.setNoRate(office.id)).toBe(true);
    expect(sim.setNoRate(office.id)).toBe(true); // already off the market
    expect(sim.applyRentBatch("office", "default")?.changed).toBeGreaterThan(0);
    expect(sim.applyRentBatch("office", "default")?.changed).toBe(0);
    expect(sim.applyRentBatch("condo", "default")?.eligible).toBe(0); // nothing to write
    expect(sim.priceUnit(office, Number.NaN)).toBeNull();
    expect(drain(sim)).toEqual(Array(4).fill({ name: "pricing_changed", payload: { kind: "office" } }));
  });

  it("reports a car count or span that changed, and nothing for a no-op", () => {
    const sim = tower();
    expect(sim.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
    sim.drainGameplayEvents();
    const shaft = sim.tower.transportAt(1, 172)!;
    expect(sim.tower.setCars(shaft.id, 3)).toBe(true);
    expect(sim.tower.setCars(shaft.id, 3)).toBe(false);
    expect(sim.tower.resizeTransport(shaft.id, 1, 2).ok).toBe(true); // the same span
    expect(sim.tower.resizeTransport(shaft.id, 1, 3).ok).toBe(true);
    expect(drain(sim)).toEqual(Array(2).fill({ name: "capacity_changed", payload: { kind: "elevatorStandard" } }));
  });

  it("reports every rung a promotion crosses", () => {
    const sim = tower();
    sim.star = 4;
    noteStars(sim, 1);
    expect(drain(sim).map((e) => e.payload)).toEqual([{ star: 2 }, { star: 3 }, { star: 4 }]);
    sim.star = 1;
    sim.tower.totalPopulation = () => 100_000; // past every population rung; no Security, so 2★ is the cap
    sim.evaluateStar();
    expect(sim.star).toBe(2);
    expect(drain(sim)).toEqual([{ name: "star_reached", payload: { star: 2 } }]);
    sim.evaluateStar();
    expect(sim.drainGameplayEvents()).toEqual([]);
  });

  it("reports fires, bombs and how each emergency was resolved", () => {
    const sim = tower();
    expect(sim.build("office", 2, 180).ok).toBe(true);
    for (const u of sim.tower.units) if (u.state === "construction") u.state = "empty";
    sim.drainGameplayEvents();
    sim.startFire();
    expect(sim.fires).toBe(1);
    sim.events.pending = { kind: "fireRescue", cost: 1000, message: "" };
    sim.resolveChoice("accept");
    expect(drain(sim)).toEqual([
      { name: "fire_started", payload: {} },
      { name: "emergency_resolved", payload: { kind: "fireRescue", decision: "accept", source: "player" } },
      { name: "fire_gutted", payload: { rooms: 1 } },
    ]);
    // An accept the tower cannot pay is a decline.
    sim.money = 10;
    sim.events.pending = { kind: "fireRescue", cost: 1000, message: "" };
    sim.resolveChoice("accept");
    expect(drain(sim)).toEqual([{ name: "emergency_resolved", payload: { kind: "fireRescue", decision: "decline", source: "player" } }]);
    // The daily roll's auto-decline, then the search finds no Security.
    sim.money = 1e9;
    expect(sim.build("office", 2, 190).ok).toBe(true);
    for (const u of sim.tower.units) if (u.state === "construction") u.state = "empty";
    sim.drainGameplayEvents();
    sim.events.pending = { kind: "bombThreat", cost: 300_000, message: "" };
    sim.events.maybeRandomEvent();
    const events = drain(sim);
    expect(events[0]).toEqual({ name: "emergency_resolved", payload: { kind: "bombThreat", decision: "decline", source: "timeout" } });
    expect(events[1]).toMatchObject({ name: "bomb_detonated" });
    expect((events[1].payload as { rooms: number }).rooms).toBeGreaterThan(0);
  });

  it("reports a milestone once, when it is announced", () => {
    const sim = tower();
    sim.star = 4;
    sim.checkMilestones();
    expect(drain(sim)).toEqual([{ name: "milestone_reached", payload: { id: "star-4" } }]);
    sim.checkMilestones();
    expect(sim.drainGameplayEvents()).toEqual([]);
  });
});

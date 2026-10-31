import { describe, expect, it } from "vitest";
import { facilityFloors } from "../engine/facilities";
import { isOperational, type UnitState } from "../engine/types";
import { TsEngine } from "../engine/port/tsEngine";
import { Simulation } from "../engine/Simulation";
import type { EnginePort } from "../simport/enginePort";
import { ViewReader } from "../simport/viewReader";
import { createCardKit, INERT_STATES } from "./cardKit";
import { VIEW_LAYOUT } from "../engine/port/layout";
import { renderToFragment } from "../ui/testing/litTestUtils";
import { unitEditorTemplate } from "../ui/templates/editor";
import { unitInspectorTemplate } from "../ui/templates/inspector";

/** A tower with a recycling center in the basement and an occupied office. */
function tower(): { sim: Simulation; centerId: number; officeId: number } {
  const sim = Simulation.newGame(3, "classic");
  sim.money = 1e9;
  sim.star = 5;
  for (let x = 170; x < 230; x++) sim.tower.place("lobby", 1, x);
  for (const f of [0, -1, 2]) for (let x = 170; x < 230; x++) sim.tower.place("floor", f, x);
  const center = sim.tower.place("recycling", -1, 180);
  const office = sim.tower.place("office", 2, 180);
  if (!center.ok || center.unitId === undefined || !office.ok || office.unitId === undefined) throw new Error("the test tower did not build");
  const c = sim.tower.getUnit(center.unitId);
  const o = sim.tower.getUnit(office.unitId);
  if (!c || !o) throw new Error("the test tower lost a room");
  c.state = "occupied";
  o.state = "occupied";
  o.occupants = 6;
  return { sim, centerId: center.unitId, officeId: office.unitId };
}

/** The engine as the Rust engine presents it to the cards: the same reads, and
 *  no TypeScript tower behind them. */
function withoutTower(engine: TsEngine): EnginePort {
  return new Proxy(engine, { get: (target, key) => (key === "sim" ? undefined : Reflect.get(target, key, target)) }) as unknown as EnginePort;
}

describe("the card kit's unit lines on an engine with no TypeScript tower", () => {
  it("show a recycling center's fill and capacity lines, the same as the TypeScript tower's", () => {
    const { sim, centerId } = tower();
    const engine = new TsEngine(sim);
    const reader = new ViewReader(engine, facilityFloors);
    const own = createCardKit({ enginePort: engine, reader }).diagnostics.unit(centerId);
    const hosted = createCardKit({ enginePort: withoutTower(engine), reader }).diagnostics.unit(centerId);
    expect(own).toHaveLength(2);
    expect(hosted).toEqual(own);
  });

  it("read the capacity from the port", () => {
    const { sim, centerId } = tower();
    const engine = new TsEngine(sim);
    expect(engine.recyclingCapacity()).toBe(2500);
    const reader = new ViewReader(engine, facilityFloors);
    const lines = createCardKit({ enginePort: withoutTower(engine), reader }).diagnostics.unit(centerId);
    expect(lines.map((l) => l.values.join("|")).join("\n")).toContain("2,500");
  });

  it("show tenant access from port facts, without recycling lines for another kind or a center under construction", () => {
    const { sim, centerId, officeId } = tower();
    const engine = new TsEngine(sim);
    const reader = new ViewReader(engine, facilityFloors);
    const kit = createCardKit({ enginePort: withoutTower(engine), reader });
    const officeLines = kit.diagnostics.unit(officeId);
    const officeText = officeLines.map((l) => l.strings.map((s, i) => s + (i < l.values.length ? String(l.values[i]) : "")).join("")).join("\n");
    expect(officeText).toContain("Access:");
    // Rust has no TypeScript tower; it still renders the existing engine facts.
    expect(officeText).toContain("No elevator or stair reaches this floor.");
    const center = sim.tower.getUnit(centerId);
    if (!center) throw new Error("the center is gone");
    center.state = "construction";
    expect(kit.diagnostics.unit(centerId)).toEqual([]);
  });

  it("shows the engine-reported Main gripe on both mobile and desktop without a TypeScript mirror", () => {
    const { sim, officeId } = tower();
    sim.tower.getUnit(officeId)!.satisfaction = 0.01;
    const engine = new TsEngine(sim);
    const fields = VIEW_LAYOUT.records.unitFacts;
    const port = new Proxy(engine, {
      get(target, key) {
        if (key === "sim") return undefined;
        if (key === "unitFacts") return (id: number) => {
          const record = target.unitFacts(id);
          if (id === officeId) {
            record[fields.indexOf("gripe")] = 1;
            record[fields.indexOf("gripeCause")] = VIEW_LAYOUT.vacateReasons.indexOf("rent");
          }
          return record;
        };
        return Reflect.get(target, key, target);
      },
    }) as unknown as EnginePort;
    const reader = new ViewReader(port, facilityFloors);
    const kit = createCardKit({ enginePort: port, reader });
    const unit = kit.cards.unit(officeId)!;
    const copy = "Main gripe: the rent is above the going rate. Lower it to keep them.";
    const mobile = renderToFragment(unitEditorTemplate(unit, kit.catalog(), 12, true, kit.diagnostics.unit(officeId)));
    const desktop = renderToFragment(unitInspectorTemplate(unit, kit.catalog(), 12, kit.diagnostics.unit(officeId)));
    expect(mobile.querySelector(".ed-diagnostics")?.textContent).toContain(copy);
    expect(desktop.textContent).toContain(copy);
  });

  it("does not recalculate Rust grievance facts on every 160ms editor refresh", () => {
    const { sim, officeId } = tower();
    sim.tower.getUnit(officeId)!.satisfaction = 0.01;
    const engine = new TsEngine(sim);
    let reads = 0;
    let generation = engine.generation();
    const port = new Proxy(engine, {
      get(target, key) {
        if (key === "sim") return undefined;
        if (key === "generation") return () => generation;
        if (key === "unitFacts") return (id: number) => {
          reads++;
          return target.unitFacts(id);
        };
        return Reflect.get(target, key, target);
      },
    }) as unknown as EnginePort;
    const reader = new ViewReader(port, facilityFloors);
    const kit = createCardKit({ enginePort: port, reader });
    const office = sim.tower.getUnit(officeId)!;
    // Opening a card asks Rust once. A frame pump only changes the clock
    // within an hour, so it reuses the same engine-authored explanation.
    kit.diagnostics.unit(officeId, true);
    expect(reads).toBe(1);
    for (let i = 0; i < 12; i++) kit.diagnostics.unit(officeId);
    expect(reads).toBe(1);
    reader.header = { ...reader.header, minutes: reader.header.minutes + 5 };
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(1);

    // Game hour (also across midnight) invalidates the inspector demand memo.
    reader.header = { ...reader.header, minutes: reader.header.minutes + 60 };
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(2);
    // Selected unit state and price change without a structural revision.
    office.satisfaction = 0.02;
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(3);
    office.rent = (office.rent ?? 0) + 50;
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(4);
    // A direct command re-reads even if an unrelated room's rent changed.
    kit.diagnostics.unit(officeId, true);
    expect(reads).toBe(5);
    // A command elsewhere in the tower may leave every selected-unit field
    // unchanged; explicit mutation invalidation still forces a fresh cause.
    kit.diagnostics.invalidate();
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(6);

    reader.header = { ...reader.header, population: reader.header.population + 1 };
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(7);
    reader.header = { ...reader.header, revision: reader.header.revision + 1 };
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(8);
    // A load or undo can reuse the same room id and clock; generation must
    // keep those tower identities apart.
    generation++;
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(9);
  });

  it("keeps a Rust tenant's on-notice countdown live instead of caching it per hour", () => {
    const { sim, officeId } = tower();
    const office = sim.tower.getUnit(officeId)!;
    office.state = "vacating";
    office.vacateReason = "noise";
    office.vacateAt = sim.clock.minutes + 180;
    const engine = new TsEngine(sim);
    let reads = 0;
    const port = new Proxy(engine, {
      get(target, key) {
        if (key === "sim") return undefined;
        if (key === "unitFacts") return (id: number) => {
          reads++;
          return target.unitFacts(id);
        };
        return Reflect.get(target, key, target);
      },
    }) as unknown as EnginePort;
    const kit = createCardKit({ enginePort: port, reader: new ViewReader(port, facilityFloors) });
    kit.diagnostics.unit(officeId);
    sim.clock.minutes += 5;
    kit.diagnostics.unit(officeId);
    expect(reads).toBe(2);
  });

  it("treat a room as inert in exactly the states the engine does", () => {
    const all: UnitState[] = ["construction", "empty", "occupied", "moving_in", "vacating", "asleep", "dirty", "infested", "fire", "gutted"];
    for (const state of all) expect(INERT_STATES.has(state), state).toBe(!isOperational({ state }));
  });
});

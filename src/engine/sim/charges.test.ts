import { describe, it, expect } from "vitest";
import { Simulation } from "../Simulation";
import { ECON, carResaleRefund, resaleRefund } from "../econConfig";
import { FACILITIES, GRID, maxCarsFor } from "../facilities";
import type { Transport, Unit } from "../types";

/**
 * The priced editor commands (#914): adding and removing cars, extending a
 * shaft, and selling by id each move the money inside the engine, so a
 * frontend never writes `money` for them. The Rust port carries the same
 * cases in `engine-rs/src/charges.rs`.
 */

const C = 180;

/** A lobby on floor 1 and plain floor on 2..top across [C - 10, C + 10),
 *  laid with the raw tower edits so the money starts where the test sets it. */
function tower(top = 4, money = 10_000_000): Simulation {
  const sim = Simulation.newGame(7, "classic");
  for (let x = C - 10; x < C + 10; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= top; f++) {
    for (let x = C - 10; x < C + 10; x++) expect(sim.tower.place("floor", f, x).ok, `floor ${f} @ ${x}`).toBe(true);
  }
  sim.money = money;
  return sim;
}

function elevator(sim: Simulation, bottom = 1, top = 2): Transport {
  const r = sim.tower.placeTransport("elevatorStandard", C - 8, bottom, top);
  expect(r.ok, r.reason).toBe(true);
  return sim.tower.transportAt(bottom, C - 8)!;
}

function office(sim: Simulation, floor = 2): Unit {
  const r = sim.tower.place("office", floor, C);
  expect(r.ok, r.reason).toBe(true);
  return sim.tower.unitAt(floor, C)!;
}

describe("addCar / removeCar", () => {
  it("charges the add-car cost and refunds half on removal", () => {
    const sim = tower();
    const t = elevator(sim);
    const before = sim.money;
    const add = sim.addCar(t.id);
    expect(add).toEqual({ ok: true, delta: -ECON.addCarCost });
    expect(ECON.addCarCost).toBe(40_000);
    expect(t.cars).toBe(2);
    expect(sim.money).toBe(before - 40_000);
    const remove = sim.removeCar(t.id);
    expect(remove).toEqual({ ok: true, delta: carResaleRefund() });
    expect(carResaleRefund()).toBe(20_000);
    expect(t.cars).toBe(1);
    expect(sim.money).toBe(before - 20_000);
  });

  it("refuses an add when short of money and leaves the shaft and balance alone", () => {
    const sim = tower(4, ECON.addCarCost - 1);
    const t = elevator(sim);
    expect(sim.addCar(t.id)).toEqual({ ok: false, reason: "Not enough money.", delta: 0 });
    expect(t.cars).toBe(1);
    expect(sim.money).toBe(ECON.addCarCost - 1);
    // Exactly the price is enough.
    sim.money = ECON.addCarCost;
    expect(sim.addCar(t.id).ok).toBe(true);
    expect(sim.money).toBe(0);
  });

  it("refuses at the car cap, at one car, and for a non-elevator id", () => {
    const sim = tower();
    const t = elevator(sim);
    sim.tower.setCars(t.id, maxCarsFor(t.kind));
    const money = sim.money;
    expect(sim.addCar(t.id)).toEqual({ ok: false, reason: `This elevator already runs ${maxCarsFor(t.kind)} cars.`, delta: 0 });
    sim.tower.setCars(t.id, 1);
    expect(sim.removeCar(t.id)).toEqual({ ok: false, reason: "An elevator keeps at least one car.", delta: 0 });
    expect(sim.addCar(9999).reason).toBe("No such elevator.");
    expect(sim.removeCar(9999).reason).toBe("No such elevator.");
    expect(sim.money).toBe(money);
  });
});

describe("extendTransport", () => {
  it("charges one floor's cost per floor added and nothing for a shrink", () => {
    const sim = tower(6);
    const t = elevator(sim, 1, 2);
    const before = sim.money;
    const up = sim.extendTransport(t.id, "up", 3);
    expect(up).toEqual({ ok: true, delta: -ECON.transportFloorCost, added: 1 });
    expect(ECON.transportFloorCost).toBe(5_000);
    expect(t.top).toBe(3);
    expect(sim.money).toBe(before - 5_000);
    const shrink = sim.extendTransport(t.id, "up", 2);
    expect(shrink).toEqual({ ok: true, delta: 0, added: 0 });
    expect(Object.is(shrink.delta, 0)).toBe(true);
    expect(t.top).toBe(2);
    expect(sim.money).toBe(before - 5_000);
  });

  it("bills a drag only past its high-water mark", () => {
    const sim = tower(6);
    const t = elevator(sim, 1, 2);
    const hwm = { bottom: 1, top: 2 };
    const before = sim.money;
    expect(sim.extendTransport(t.id, "up", 5, hwm)).toMatchObject({ ok: true, added: 3 });
    hwm.top = 5;
    expect(sim.extendTransport(t.id, "up", 3, hwm)).toMatchObject({ ok: true, added: 0 }); // drag back
    expect(sim.extendTransport(t.id, "up", 5, hwm)).toMatchObject({ ok: true, added: 0 }); // and out again
    expect(sim.extendTransport(t.id, "up", 6, hwm)).toMatchObject({ ok: true, added: 1 });
    expect(sim.money).toBe(before - 4 * ECON.transportFloorCost);
  });

  it("grows only as far as the balance covers, and refuses when it covers no floor", () => {
    const sim = tower(6, 2 * ECON.transportFloorCost + 1);
    const t = elevator(sim, 1, 2);
    expect(sim.extendTransport(t.id, "up", 6)).toMatchObject({ ok: true, added: 2 });
    expect(t.top).toBe(4);
    expect(sim.money).toBe(1);
    expect(sim.extendTransport(t.id, "up", 5)).toEqual({ ok: false, reason: "Not enough money.", delta: 0, added: 0 });
    expect(t.top).toBe(4);
    // In debt the budget is zero floors, never a free shrink of the far end.
    sim.money = -50_000;
    expect(sim.extendTransport(t.id, "down", 0, { bottom: 1, top: 4 }).reason).toBe("Not enough money.");
    expect(t.bottom).toBe(1);
  });

  it("refuses with no reason when nothing would change, and with the tower's reason when blocked", () => {
    const sim = tower(3);
    const t = elevator(sim, 1, 2);
    const money = sim.money;
    expect(sim.extendTransport(t.id, "up", 2)).toEqual({ ok: false, delta: 0, added: 0 });
    // Past the top of the lot the resize refuses, and nothing is charged.
    const blocked = sim.extendTransport(t.id, "up", GRID.maxFloor + 1);
    expect(blocked).toEqual({ ok: false, reason: "Outside the buildable range.", delta: 0, added: 0 });
    expect(sim.money).toBe(money);
    expect(sim.extendTransport(9999, "up", 3).reason).toBe("No such elevator.");
  });
});

describe("sell", () => {
  it("refunds half a unit's cost and half a shaft's", () => {
    const sim = tower();
    const u = office(sim);
    const t = elevator(sim);
    const before = sim.money;
    expect(sim.sell(u.id)).toEqual({ ok: true, delta: resaleRefund("office") });
    expect(sim.tower.getUnit(u.id)).toBeUndefined();
    expect(sim.sell(t.id)).toEqual({ ok: true, delta: resaleRefund("elevatorStandard") });
    expect(sim.tower.getTransport(t.id)).toBeUndefined();
    expect(sim.money).toBe(before + resaleRefund("office") + resaleRefund("elevatorStandard"));
  });

  it("pays nothing for a gutted shell", () => {
    const sim = tower();
    const u = office(sim);
    u.state = "gutted";
    const before = sim.money;
    expect(sim.sell(u.id)).toEqual({ ok: true, delta: 0 });
    expect(sim.tower.getUnit(u.id)).toBeUndefined();
    expect(sim.money).toBe(before);
  });

  it("refuses a burning unit and a floor that holds up the story above", () => {
    const sim = tower(3);
    const u = office(sim);
    u.state = "fire";
    const before = sim.money;
    expect(sim.sell(u.id)).toEqual({ ok: false, reason: "You can't remove a burning unit. Call fire rescue or let it burn out.", delta: 0 });
    const floor2 = sim.tower.units.find((x) => x.kind === "floor" && x.floor === 2 && x.x === C + 9)!;
    const res = sim.sell(floor2.id);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe(sim.tower.removalReason(floor2.id));
    expect(sim.tower.getUnit(floor2.id)).toBeDefined();
    expect(sim.sell(9999)).toEqual({ ok: false, reason: "Nothing to sell.", delta: 0 });
    expect(sim.money).toBe(before);
  });

  it("cancels a pending VIP inspection when the last Wedding Hall goes", () => {
    const sim = Simulation.newGame(8, "classic");
    const w = FACILITIES.weddingHall.width;
    for (let x = C; x < C + w; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
    for (let f = 2; f <= GRID.maxFloor; f++) {
      for (let x = C; x < C + w; x++) expect(sim.tower.place("floor", f, x).ok).toBe(true);
    }
    sim.money = 1e9;
    sim.star = 5;
    expect(sim.build("weddingHall", GRID.maxFloor, C).ok).toBe(true);
    expect(sim.vipVisitDay).toBeGreaterThanOrEqual(0);
    const hall = sim.tower.unitAt(GRID.maxFloor, C)!;
    expect(sim.sell(hall.id).ok).toBe(true);
    expect(sim.tower.builtWeddingHall).toBe(false);
    expect(sim.vipVisitDay).toBe(-1);
  });

  it("is the path sellAt takes for a room, so the two cannot drift", () => {
    const a = tower();
    const b = tower();
    const ua = office(a);
    const ub = office(b);
    ua.state = ub.state = "gutted";
    expect(a.sellAt(2, C)).toBe(true);
    expect(b.sell(ub.id).ok).toBe(true);
    expect(a.money).toBe(b.money);
    expect(JSON.stringify(a.serialize())).toBe(JSON.stringify(b.serialize()));
  });
});

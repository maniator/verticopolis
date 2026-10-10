import { describe, expect, it } from "vitest";
import { Simulation } from "../Simulation";
import { ECON, carResaleRefund, extendBill, resaleRefund } from "../econConfig";
import { GRID, maxCarsFor } from "../facilities";
import type { Transport, Unit } from "../types";
import { CAR_LIMIT, ELEVATOR_GONE, FACILITY_GONE, LAST_CAR, NOT_ENOUGH_MONEY, ONLY_ELEVATOR_CARS, ONLY_ELEVATOR_EXTEND } from "./charges";

/**
 * The engine-owned charges (#914): each command checks, moves the tower and
 * moves the money itself. `engine-rs/src/charges.rs` carries the same cases.
 */

/** A lobby, a floor with an office over it, an elevator on 1..2 and stairs,
 *  every placement asserted so a silent fixture failure can't pass a test. */
function fixture() {
  const sim = new Simulation();
  for (let x = 10; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let fl = 2; fl <= 4; fl++) for (let x = 10; x < 40; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
  const r = sim.tower.place("office", 2, 20);
  expect(r.ok).toBe(true);
  const office = sim.tower.getUnit(r.unitId!)!;
  expect(sim.buildTransport("elevatorStandard", 10, 1, 2).ok).toBe(true);
  const lift = sim.tower.transportAt(1, 10)!;
  expect(lift.cars).toBe(1);
  expect(sim.buildTransport("stairs", 30, 1, 2).ok).toBe(true);
  const stairs = sim.tower.transportAt(1, 30)!;
  sim.money = 1_000_000;
  return { sim, office, lift, stairs };
}

describe("addCar / removeCar", () => {
  it("charges the add-car cost and refunds half on removal", () => {
    const { sim, lift } = fixture();
    expect(sim.addCar(lift.id)).toEqual({ ok: true, delta: -ECON.addCarCost });
    expect(lift.cars).toBe(2);
    expect(sim.money).toBe(1_000_000 - ECON.addCarCost);
    expect(sim.removeCar(lift.id)).toEqual({ ok: true, delta: carResaleRefund() });
    expect(lift.cars).toBe(1);
    expect(sim.money).toBe(1_000_000 - ECON.addCarCost + carResaleRefund());
  });

  it("refuses an add when short of money, leaving cars and money alone", () => {
    const { sim, lift } = fixture();
    sim.money = ECON.addCarCost - 1;
    expect(sim.addCar(lift.id)).toEqual({ ok: false, reason: NOT_ENOUGH_MONEY, delta: 0 });
    expect(lift.cars).toBe(1);
    expect(sim.money).toBe(ECON.addCarCost - 1);
    sim.money = ECON.addCarCost; // exactly enough pays
    expect(sim.addCar(lift.id).ok).toBe(true);
    expect(sim.money).toBe(0);
  });

  it("refuses an add at the car limit before any money talk", () => {
    const { sim, lift } = fixture();
    expect(sim.tower.setCars(lift.id, maxCarsFor(lift.kind))).toBe(true);
    sim.money = 0;
    expect(sim.addCar(lift.id)).toEqual({ ok: false, reason: CAR_LIMIT, delta: 0 });
    expect(lift.cars).toBe(maxCarsFor(lift.kind));
  });

  it("refuses removing the last car, a missing shaft and a stairway", () => {
    const { sim, lift, stairs } = fixture();
    const money = sim.money;
    expect(sim.removeCar(lift.id)).toEqual({ ok: false, reason: LAST_CAR, delta: 0 });
    expect(sim.addCar(99_999)).toEqual({ ok: false, reason: ELEVATOR_GONE, delta: 0 });
    expect(sim.removeCar(99_999)).toEqual({ ok: false, reason: ELEVATOR_GONE, delta: 0 });
    expect(sim.addCar(stairs.id)).toEqual({ ok: false, reason: ONLY_ELEVATOR_CARS, delta: 0 });
    expect(sim.removeCar(stairs.id)).toEqual({ ok: false, reason: ONLY_ELEVATOR_CARS, delta: 0 });
    expect(sim.money).toBe(money);
    expect(lift.cars).toBe(1);
  });
});

describe("extendTransport", () => {
  const per = ECON.transportFloorCost;

  it("bills one floor per button press and nothing to shrink", () => {
    const { sim, lift } = fixture();
    expect(sim.extendTransport(lift.id, "up", 3)).toEqual({ ok: true, delta: -per, bottom: 1, top: 3, added: 1 });
    expect(sim.money).toBe(1_000_000 - per);
    expect(sim.extendTransport(lift.id, "up", 2)).toEqual({ ok: true, delta: 0, bottom: 1, top: 2, added: 0 });
    expect(sim.money).toBe(1_000_000 - per);
  });

  it("bills a drag only past its high-water mark, so a wiggle is billed once", () => {
    const { sim, lift } = fixture();
    const hwm = { bottom: 1, top: 2 };
    expect(sim.extendTransport(lift.id, "up", 4, hwm).added).toBe(2);
    hwm.top = 4;
    expect(sim.extendTransport(lift.id, "up", 3, hwm).delta).toBe(0); // back down: free
    expect(sim.extendTransport(lift.id, "up", 4, hwm)).toEqual({ ok: true, delta: 0, bottom: 1, top: 4, added: 0 }); // regrow within the mark
    expect(sim.money).toBe(1_000_000 - 2 * per);
  });

  it("never bills a standing floor again, whatever mark the caller passes", () => {
    const { sim, lift } = fixture();
    expect(sim.extendTransport(lift.id, "up", 3, { bottom: 1, top: 1 })).toEqual({ ok: true, delta: -per, bottom: 1, top: 3, added: 1 });
  });

  it("grows only as far as the budget pays, and refuses when it pays for none", () => {
    const { sim, lift } = fixture();
    sim.money = per + per / 2; // one floor's worth
    expect(sim.extendTransport(lift.id, "up", 4)).toEqual({ ok: true, delta: -per, bottom: 1, top: 3, added: 1 });
    expect(sim.money).toBe(per / 2);
    expect(sim.extendTransport(lift.id, "up", 4)).toEqual({ ok: false, reason: NOT_ENOUGH_MONEY, delta: 0, bottom: 1, top: 3, added: 0 });
    sim.money = -10_000; // in debt the budget is no new floors, never a shrink
    expect(sim.extendTransport(lift.id, "up", 4)).toEqual({ ok: false, reason: NOT_ENOUGH_MONEY, delta: 0, bottom: 1, top: 3, added: 0 });
    expect(lift.top).toBe(3);
  });

  it("refuses with the tower's reason and charges nothing when the span does not fit", () => {
    const { sim, lift } = fixture();
    expect(sim.buildTransport("elevatorStandard", 10, 3, 4).ok).toBe(true); // another shaft sits on 3..4
    const money = sim.money;
    const res = sim.extendTransport(lift.id, "up", 3);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("Transport shafts cannot overlap.");
    expect(res).toMatchObject({ delta: 0, bottom: 1, top: 2, added: 0 });
    expect(sim.money).toBe(money);
  });

  it("bills the down end the same way: per floor past the mark, budget-clamped, shrinks free", () => {
    const { sim } = fixture();
    expect(sim.buildTransport("elevatorStandard", 14, 3, 4).ok).toBe(true);
    const shaft = sim.tower.transportAt(3, 14)!;
    const start = sim.money;
    const hwm = { bottom: 3, top: 4 };
    expect(sim.extendTransport(shaft.id, "down", 1, hwm)).toEqual({ ok: true, delta: -2 * per, bottom: 1, top: 4, added: 2 });
    hwm.bottom = 1;
    expect(sim.extendTransport(shaft.id, "down", 2, hwm)).toEqual({ ok: true, delta: 0, bottom: 2, top: 4, added: 0 });
    expect(sim.extendTransport(shaft.id, "down", 1, hwm)).toEqual({ ok: true, delta: 0, bottom: 1, top: 4, added: 0 });
    // A down target above the shaft shrinks it to one floor tall, never past it.
    expect(sim.extendTransport(shaft.id, "down", 6)).toEqual({ ok: true, delta: 0, bottom: 3, top: 4, added: 0 });
    expect(sim.money).toBe(start - 2 * per);
  });

  it("clamps a broke down extension to the budget, then refuses it", () => {
    const { sim } = fixture();
    expect(sim.buildTransport("elevatorStandard", 14, 3, 4).ok).toBe(true);
    const shaft = sim.tower.transportAt(3, 14)!;
    sim.money = per + per / 2;
    expect(sim.extendTransport(shaft.id, "down", 1)).toEqual({ ok: true, delta: -per, bottom: 2, top: 4, added: 1 });
    expect(sim.extendTransport(shaft.id, "down", 1)).toEqual({ ok: false, reason: NOT_ENOUGH_MONEY, delta: 0, bottom: 2, top: 4, added: 0 });
  });

  it("refuses a stairway and a missing shaft", () => {
    const { sim, stairs } = fixture();
    expect(sim.extendTransport(stairs.id, "up", 3)).toEqual({ ok: false, reason: ONLY_ELEVATOR_EXTEND, delta: 0, bottom: 1, top: 2, added: 0 });
    expect(sim.extendTransport(99_999, "down", 0)).toEqual({ ok: false, reason: ELEVATOR_GONE, delta: 0, bottom: 0, top: 0, added: 0 });
  });
});

describe("extendBill vectors (engine-rs/src/charges_tests.rs carries the same)", () => {
  it.each([
    [{ bottom: 1, top: 2 }, { bottom: 1, top: 2 }, "up", 4, 1e6, { nb: 1, nt: 4, added: 2 }],
    [{ bottom: 1, top: 2 }, { bottom: 1, top: 2 }, "up", 9, 7_500, { nb: 1, nt: 3, added: 1 }],
    [{ bottom: 1, top: 3 }, { bottom: 1, top: 5 }, "up", 5, 0, { nb: 1, nt: 5, added: 0 }],
    [{ bottom: 3, top: 6 }, { bottom: 3, top: 6 }, "up", 1, 0, { nb: 3, nt: 4, added: 0 }],
    [{ bottom: 3, top: 6 }, { bottom: 3, top: 6 }, "down", 1, -50_000, { nb: 3, nt: 6, added: 0 }],
    [{ bottom: 4, top: 6 }, { bottom: 3, top: 6 }, "down", 1, 5_000, { nb: 2, nt: 6, added: 1 }],
    [{ bottom: 1, top: 2 }, { bottom: 1, top: 2 }, "up", 50, 1e300, { nb: 1, nt: 50, added: 48 }],
  ] as const)("%o mark %o %s to %d with %d", (cur, hwm, end, target, money, want) => {
    expect(extendBill(cur, hwm, end, target, money, 5_000)).toEqual(want);
  });
});

describe("removeFacility", () => {
  it("refunds half a unit's cost and half a shaft's", () => {
    const { sim, office, lift } = fixture();
    expect(sim.removeFacility(office.id, "sell")).toEqual({ ok: true, delta: resaleRefund("office") });
    expect(sim.tower.getUnit(office.id)).toBeUndefined();
    expect(sim.removeFacility(lift.id, "bulldoze")).toEqual({ ok: true, delta: resaleRefund("elevatorStandard") });
    expect(sim.tower.transportById(lift.id)).toBeUndefined();
    expect(sim.money).toBe(1_000_000 + resaleRefund("office") + resaleRefund("elevatorStandard"));
  });

  it("refunds nothing for a gutted unit", () => {
    const { sim, office } = fixture();
    office.state = "gutted";
    expect(sim.removeFacility(office.id, "bulldoze")).toEqual({ ok: true, delta: 0 });
    expect(sim.money).toBe(1_000_000);
  });

  it("refuses a burning unit in the gesture's own words", () => {
    const { sim, office } = fixture();
    office.state = "fire";
    expect(sim.removeFacility(office.id, "sell").reason).toBe("You can't sell a burning unit. Call fire rescue or let it burn out.");
    expect(sim.removeFacility(office.id, "bulldoze")).toEqual({ ok: false, reason: "You can't bulldoze a burning unit. Call fire rescue or let it burn out.", delta: 0 });
    expect(sim.tower.getUnit(office.id)).toBe(office);
  });

  it("refuses structure the tower keeps, and a missing id", () => {
    const { sim } = fixture();
    const lobby = sim.tower.unitAt(1, 20) as Unit;
    expect(sim.removeFacility(lobby.id, "bulldoze")).toEqual({ ok: false, reason: sim.tower.removalReason(lobby.id), delta: 0 });
    // Floor 3 carries floor 4 above it, so it can't be pulled out.
    const floor3 = sim.tower.units.find((u: Unit) => u.kind === "floor" && u.floor === 3 && u.x === 15)!;
    expect(sim.removeFacility(floor3.id, "sell").reason).toBe("Remove the story above first. Floors can't hang in midair.");
    expect(sim.removeFacility(99_999, "sell")).toEqual({ ok: false, reason: FACILITY_GONE, delta: 0 });
    expect(sim.money).toBe(1_000_000);
  });

  it("cancels the pending VIP inspection with the last Wedding Hall", () => {
    const { sim } = fixture();
    sim.star = 5;
    sim.money = 10_000_000;
    // The hall only goes on the top floor: stack floor up to it under its footprint.
    for (let fl = 5; fl <= GRID.maxFloor; fl++) for (let x = 10; x < 26; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
    expect(sim.build("weddingHall", GRID.maxFloor, 10).ok).toBe(true);
    expect(sim.vipVisitDay).toBeGreaterThan(0);
    const hall = sim.tower.unitAt(GRID.maxFloor, 10)!;
    expect(sim.removeFacility(hall.id, "sell").ok).toBe(true);
    expect(sim.vipVisitDay).toBe(-1);
  });

  it("is the path sellAt pays through: same refund, same refusals", () => {
    const { sim, office } = fixture();
    office.state = "gutted";
    expect(sim.sellAt(2, 20)).toBe(true);
    expect(sim.money).toBe(1_000_000);
    const shaft: Transport = sim.tower.transportAt(1, 30)!;
    expect(sim.sellAt(1, 30)).toBe(true);
    expect(sim.money).toBe(1_000_000 + resaleRefund(shaft.kind));
    expect(sim.sellAt(1, 20)).toBe(false); // lobby tiles are permanent
  });
});

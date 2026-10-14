import { describe, expect, it } from "vitest";
import { Simulation } from "../Simulation";
import { ECON, carResaleRefund, extendBill, resaleRefund } from "../econConfig";
import { GRID, maxCarsFor } from "../facilities";
import type { Transport, Unit } from "../types";
import { CAR_LIMIT, ELEVATOR_GONE, FACILITY_GONE, INVALID_REQUEST, LAST_CAR, NOT_ENOUGH_MONEY, ONLY_ELEVATOR_CARS, ONLY_ELEVATOR_EXTEND } from "./charges";

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

describe("gameplay events from the charges", () => {
  it("reports capacity_changed for each paid edit and nothing for a refusal", () => {
    const { sim, lift } = fixture();
    sim.drainGameplayEvents();
    const capacity = { name: "capacity_changed", payload: { kind: "elevatorStandard" } };
    expect(sim.addCar(lift.id).ok).toBe(true);
    expect(sim.removeCar(lift.id).ok).toBe(true);
    expect(sim.extendTransport(lift.id, "up", 3).ok).toBe(true);
    expect(sim.drainGameplayEvents()).toEqual([capacity, capacity, capacity]);
    sim.money = 0;
    expect(sim.addCar(lift.id).ok).toBe(false);
    expect(sim.removeCar(lift.id).ok).toBe(false);
    expect(sim.extendTransport(lift.id, "up", 4).ok).toBe(false);
    expect(sim.drainGameplayEvents()).toEqual([]);
  });

  it("reports facility_removed with the method, and nothing for a refused removal", () => {
    const { sim, office, stairs } = fixture();
    sim.drainGameplayEvents();
    expect(sim.removeFacility(stairs.id, "bulldoze").ok).toBe(true);
    expect(sim.removeFacility(office.id, "sell").ok).toBe(true);
    expect(sim.removeFacility(99_999, "bulldoze").ok).toBe(false);
    expect(sim.drainGameplayEvents()).toEqual([
      { name: "facility_removed", payload: { kind: "stairs", method: "bulldoze" } },
      { name: "facility_removed", payload: { kind: "office", method: "sell" } },
    ]);
  });
});

describe("malformed requests (#923)", () => {
  it("refuses a non-whole id, floor or mark and an unknown end or method, moving nothing", () => {
    const { sim, lift, office } = fixture();
    const before = JSON.stringify(sim.serialize());
    sim.drainGameplayEvents();
    const refused = { ok: false, reason: INVALID_REQUEST, delta: 0 };
    for (const id of [lift.id + 0.5, Number.NaN, Infinity, -Infinity, 2 ** 53]) {
      expect(sim.addCar(id)).toEqual(refused);
      expect(sim.removeCar(id)).toEqual(refused);
      expect(sim.removeFacility(id, "bulldoze")).toEqual(refused);
    }
    expect(sim.extendTransport(lift.id, "up", 3.5)).toEqual({ ...refused, bottom: 1, top: 2, added: 0 });
    expect(sim.extendTransport(lift.id, "up", Number.NaN)).toEqual({ ...refused, bottom: 1, top: 2, added: 0 });
    expect(sim.extendTransport(lift.id, "left" as "up", 3)).toEqual({ ...refused, bottom: 1, top: 2, added: 0 });
    expect(sim.extendTransport(lift.id, "up", 3, { bottom: 1, top: Number.NaN })).toEqual({ ...refused, bottom: 1, top: 2, added: 0 });
    expect(sim.extendTransport(lift.id + 0.5, "up", 3)).toEqual({ ...refused, bottom: 0, top: 0, added: 0 });
    expect(sim.removeFacility(office.id, "burn" as "sell")).toEqual(refused);
    expect(sim.removeFacility(office.id, "Sell" as "sell")).toEqual(refused);
    expect(sim.extendTransport(lift.id, "UP" as "up", 3)).toEqual({ ...refused, bottom: 1, top: 2, added: 0 });
    // Not a number or a string at all: a second frontend's untyped call.
    const raw = <T>(v: unknown) => v as T;
    for (const id of ["12", String(lift.id), null, undefined, true, BigInt(lift.id), new Number(lift.id), [lift.id], { id: lift.id }]) {
      expect(sim.addCar(raw(id))).toEqual(refused);
      expect(sim.removeCar(raw(id))).toEqual(refused);
      expect(sim.removeFacility(raw(id), "sell")).toEqual(refused);
      expect(sim.extendTransport(raw(id), "up", 3)).toEqual({ ...refused, bottom: 0, top: 0, added: 0 });
      expect(sim.extendTransport(lift.id, "up", raw(id))).toEqual({ ...refused, bottom: 1, top: 2, added: 0 });
    }
    for (const word of [null, undefined, 5, true, new String("up"), new String("sell")]) {
      expect(sim.extendTransport(lift.id, raw(word), 3)).toEqual({ ...refused, bottom: 1, top: 2, added: 0 });
      expect(sim.removeFacility(office.id, raw(word))).toEqual(refused);
    }
    for (const mark of [0, "", false, "{\"bottom\":1,\"top\":2}", { bottom: "1", top: 2 }, { bottom: 1 }]) {
      expect(sim.extendTransport(lift.id, "up", 3, raw(mark))).toEqual({ ...refused, bottom: 1, top: 2, added: 0 });
    }
    expect(raw<(...a: unknown[]) => unknown>(sim.addCar).call(sim)).toEqual(refused);
    expect(raw<(...a: unknown[]) => unknown>(sim.removeFacility).call(sim, office.id)).toEqual(refused);
    let reads = 0; // a mark that answers 1, then 0.5: checked and billed on one read
    const shifty = { get bottom() { return reads++ === 0 ? 1 : 0.5; }, top: 2 };
    expect(sim.extendTransport(lift.id, "up", 1, shifty).ok).toBe(true); // a no-op inside the mark
    expect(reads).toBe(1);
    expect(JSON.stringify(sim.serialize())).toBe(before);
    // A mark answering 2, then 5, on a real extension: billed on the first
    // read, four floors, never on the second.
    let topReads = 0;
    const shifting = { bottom: 1, get top() { return topReads++ === 0 ? 2 : 5; } };
    expect(sim.extendTransport(lift.id, "up", 6, shifting)).toMatchObject({ ok: true, top: 6, added: 4, delta: -4 * ECON.transportFloorCost });
    expect(topReads).toBe(1);
    sim.drainGameplayEvents();
    expect(sim.drainGameplayEvents()).toEqual([]);
  });

  it("takes a -0 mark field as 0, which the binding's JSON-integer mark refuses (#923)", () => {
    const { sim, lift } = fixture();
    expect(sim.extendTransport(lift.id, "up", 3, { bottom: -0, top: 2 })).toMatchObject({ ok: true, top: 3, added: 1 });
  });

  it("widens a mark narrower than the shaft, so no standing floor is billed again", () => {
    const { sim, lift } = fixture();
    expect(sim.extendTransport(lift.id, "up", 4).ok).toBe(true); // shaft 1..4
    const money = sim.money;
    // A caller's stale mark of 1..2 must not bill floors 3 and 4 again.
    const r = sim.extendTransport(lift.id, "up", 5, { bottom: 1, top: 2 });
    expect(r).toMatchObject({ ok: true, top: 5, added: 1, delta: -ECON.transportFloorCost });
    expect(sim.money).toBe(money - ECON.transportFloorCost);
  });
});

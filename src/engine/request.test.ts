import { describe, expect, it } from "vitest";
import { Simulation } from "./Simulation";
import { INVALID_REQUEST, whole } from "./request";
import { INVALID_REQUEST as CHARGE_INVALID_REQUEST } from "./sim/charges";

/**
 * The relayed edit commands refuse a malformed argument before anything
 * moves (#996), in the TypeScript engine alone, so this half holds where the
 * WASM package is not built. `relayedCommandRaw.integration.test.ts` pins the
 * binding to the same answers.
 */

/** A lobby, floors 2 and 3, an office on 2 and an elevator on 1..3. */
function fixture() {
  const sim = new Simulation();
  for (let x = 10; x < 40; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (const fl of [2, 3]) for (let x = 10; x < 40; x++) expect(sim.tower.place("floor", fl, x).ok).toBe(true);
  const office = sim.tower.place("office", 2, 20).unitId!;
  expect(sim.buildTransport("elevatorStandard", 10, 1, 3).ok).toBe(true);
  const lift = sim.tower.transportAt(1, 10)!.id;
  sim.money = 1_000_000;
  sim.drainGameplayEvents();
  return { sim, office, lift };
}

const raw = <T>(v: unknown) => v as T;

describe("whole", () => {
  it("takes safe integers only, and charges re-exports the one reason", () => {
    for (const v of [0, -0, 1, -1, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) expect(whole(v), String(v)).toBe(true);
    for (const v of [0.5, Number.NaN, Infinity, -Infinity, 2 ** 53, "1", null, undefined, true, BigInt(1), new Number(1), [1]]) expect(whole(v), String(v)).toBe(false);
    expect(CHARGE_INVALID_REQUEST).toBe(INVALID_REQUEST);
  });
});

describe("malformed relayed commands (#996)", () => {
  it("are refused with the command's own answer and move nothing", () => {
    const { sim, office, lift } = fixture();
    const before = JSON.stringify(sim.serialize());
    const invalid = { ok: false, reason: INVALID_REQUEST };
    for (const bad of [String(lift), "2", null, undefined, true, lift + 0.5, Number.NaN, Infinity, 2 ** 53, BigInt(lift), new Number(lift), [lift]]) {
      const v = raw<number>(bad);
      expect(sim.sellAt(v, 20)).toBe(false);
      expect(sim.sellAt(2, v)).toBe(false);
      expect(sim.setCars(v, 2)).toBe(false);
      expect(sim.setCars(lift, v)).toBe(false);
      expect(sim.tower.setCars(v, 2)).toBe(false);
      expect(sim.tower.setCars(lift, v)).toBe(false);
      for (const resize of [sim.resizeTransport.bind(sim), sim.tower.resizeTransport.bind(sim.tower)]) {
        expect(resize(v, 1, 2)).toEqual(invalid);
        expect(resize(lift, v, 2)).toEqual(invalid);
        expect(resize(lift, 1, v)).toEqual(invalid);
      }
      expect(sim.tower.setStop(v, 2, false)).toBe(false);
      expect(sim.tower.setStop(lift, v, false)).toBe(false);
      expect(sim.tower.setSchedule(v, null)).toBe(false);
      expect(sim.adjustRent(v, 1)).toBeNull();
      expect(sim.adjustRent(office, raw(bad))).toBeNull();
      expect(sim.setNoRate(v)).toBe(false);
    }
    for (const stop of [null, undefined, 0, 1, "false", new Boolean(false)]) expect(sim.tower.setStop(lift, 2, raw(stop))).toBe(false);
    for (const dir of [0, -0, 2, -2, 0.5]) expect(sim.adjustRent(office, raw(dir))).toBeNull();
    expect(JSON.stringify(sim.serialize())).toBe(before);
    expect(sim.drainGameplayEvents()).toEqual([]);
  });

  it("still land when well formed", () => {
    const { sim, office, lift } = fixture();
    expect(sim.setCars(lift, 2)).toBe(true);
    expect(sim.tower.setStop(lift, 2, false)).toBe(true);
    expect(sim.tower.setSchedule(lift, null)).toBe(true);
    expect(sim.resizeTransport(lift, 1, 2)).toEqual({ ok: true, added: -1, floorTilesCreated: 0 });
    expect(sim.adjustRent(office, 1)).not.toBeNull();
    expect(sim.setNoRate(office)).toBe(true);
    expect(sim.sellAt(2, 20)).toBe(true);
    expect(sim.tower.getUnit(office)).toBeUndefined();
  });
});

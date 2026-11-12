import { expect, it } from "vitest";
import { newSeededDraft, LOT_WIDTH } from "../portKit/draftFixtures";
import { catalogFor } from "../catalogFixture";
import { wasm } from "../conformance/wasmEngine";
import { parseEngineIdentity, readEngineIdentity } from "../../wasmhost/engineIdentity";
import { PortSim, describeEngines, type Leg } from "../portKit/portSim";

/**
 * Save fields the engine reads and writes back, through the port on both
 * engines. Each test takes the save the engine writes after a few hours of
 * play, edits one field the way a newer build, an older build or a hand edit
 * would, loads the edited text into a fresh engine and reads that engine's
 * save. Moved here from `storage.integration.test.ts`, where they wrote the
 * field on a TypeScript `Simulation` and could not run on the Rust engine.
 */

type Save = Record<string, unknown> & { units: unknown[] };

/** The save of a small office tower after five hours on `leg`. */
function playedSave(leg: Leg): Save {
  const draft = newSeededDraft(42);
  const x0 = Math.floor(LOT_WIDTH / 2) - 20;
  for (let i = 0; i < 12; i++) expect(draft.tower.place("floor", 2, x0 + i).ok).toBe(true);
  const shaft = draft.buildTransport("elevatorStandard", x0, 1, 2);
  expect(shaft.ok, shaft.reason).toBe(true);
  const office = draft.build("office", 2, x0);
  expect(office.ok, office.reason).toBe(true);
  draft.money = 1234567;
  const sim = new PortSim(leg, draft);
  sim.tick(60 * 5);
  return JSON.parse(sim.save()) as Save;
}

/** `data` as save text the way a hand-edited file carries it: an infinite
 *  number is written as an overflowing literal (`1e999`, `-1e999`), which a
 *  JSON reader takes as an infinity, where `JSON.stringify` would write
 *  `null`. NaN has no JSON spelling, so a NaN row sends `null`, and an
 *  `undefined` row leaves the key out, as a file missing the field would. */
function saveText(data: Save): string {
  const literal = new Map([
    ['"__vc_inf__"', "1e999"],
    ['"__vc_neg_inf__"', "-1e999"],
  ]);
  const text = JSON.stringify(data, (_key, v: unknown) => {
    if (v === Infinity) return "__vc_inf__";
    if (v === -Infinity) return "__vc_neg_inf__";
    return v;
  });
  return text.replace(/"__vc_(?:neg_)?inf__"/g, (m) => literal.get(m)!);
}

/** A save with an overflowing literal (see saveText): the engine refuses the
 *  whole text as a number out of range, so it is never loaded with it. */
function expectInfinityHandled(leg: Leg, data: Save, _check: (save: Save) => void): void {
  expect(() => load(leg, data)).toThrow(/number out of range/);
}

/** The engine on `leg` loaded from `data`. */
const load = (leg: Leg, data: Save): PortSim => new PortSim(leg, saveText(data));

/** The save the engine on `leg` writes after loading `data`. */
const resave = (leg: Leg, data: Save): Save => JSON.parse(load(leg, data).save()) as Save;

describeEngines("save fields the engine keeps across a load", (leg: Leg) => {
  it("persists the pending VIP inspection day across save/load", () => {
    const data = playedSave(leg);
    // A Wedding Hall has scheduled the VIP a few days out.
    const due = load(leg, data).state.clock.day + 3;
    data.vipVisitDay = due;
    expect(resave(leg, data).vipVisitDay).toBe(due);
  });

  it("persists the VIP visit counter, hardens forged values, and adopts visits for legacy saves", () => {
    const data = playedSave(leg);
    data.vipVisits = 3;
    data.vipFavorable = true;
    expect(resave(leg, data).vipVisits).toBe(3);
    // Forged counter: negative / non-finite / absurd values clamp. A PRESENT
    // field never triggers the legacy adopt, so save -> load stays idempotent
    // even for a hand-set favorable-with-zero state. NaN arrives as null
    // (see saveText).
    for (const [forged, want] of [
      [-5, 0],
      [NaN, 0],
      [1e300, 1_000_000],
      [0, 0],
    ] as const) {
      data.vipVisits = forged;
      expect(resave(leg, data).vipVisits, `vipVisits ${forged}`).toBe(want);
    }
    // A save written before the counter existed: the favorable review proves
    // one visit, a won tower two (its winning TOWER inspection also counted)...
    delete data.vipVisits;
    expect(resave(leg, data).vipVisits).toBe(1);
    data.evaluatedTower = true;
    expect(resave(leg, data).vipVisits).toBe(2);
    // ...and with neither flag it stays at 0.
    data.evaluatedTower = false;
    data.vipFavorable = false;
    expect(resave(leg, data).vipVisits).toBe(0);
  });

  it("coerces forged top-level scalars (star, money, clock) from a tampered save to sane bounded values", () => {
    const data = playedSave(leg);
    data.star = 3;
    data.money = 1_234_567;
    const goodMinutes = data.minutes;
    expect(typeof goodMinutes, "the engine's save carries its clock as minutes").toBe("number");
    // A valid save round-trips these scalars untouched (coercion is a no-op on
    // legal values, so idempotence and the golden master stay intact).
    const clean = resave(leg, data);
    expect(clean.star).toBe(3);
    expect(clean.money).toBe(1_234_567);
    expect(clean.minutes).toBe(goodMinutes);

    // star: a forged NaN / out-of-range value clamps to the real ladder (1..6).
    for (const [bad, want] of [
      [NaN, 1],
      [0, 1],
      [99, 6],
      [-4, 1],
      ["5", 1],
    ] as const) {
      expect(resave(leg, { ...data, star: bad }).star, `star ${bad}`).toBe(want);
    }

    // money: a forged non-finite / non-number never poisons the bank with NaN;
    // it falls back to the starting balance (pins the fallback so a mutation
    // to `: 0` is caught, not just "finite"). The expected value is the live
    // default (the classic catalog's starting money), so a retune of the starting balance can
    // never leave a stale literal passing for the wrong reason.
    for (const bad of [NaN, "1000", undefined]) {
      expect(resave(leg, { ...data, money: bad }).money, `money ${bad}`).toBe(catalogFor("classic").economy.startingMoney);
    }
    for (const bad of [Infinity, -Infinity]) expectInfinityHandled(leg, { ...data, money: bad }, (save) => expect(save.money, `money ${bad}`).toBe(catalogFor("classic").economy.startingMoney));
    // Legal debt (the sign) round-trips intact.
    expect(resave(leg, { ...data, money: -50_000 }).money).toBe(-50_000);

    // clock: a forged NaN / negative / Infinity / non-number falls back to 0,
    // which maps to the 07:00 founding time (pins the fallback).
    for (const bad of [NaN, -100, "600", undefined]) {
      const sim = load(leg, { ...data, minutes: bad });
      expect(JSON.parse(sim.save()).minutes, `minutes ${bad}`).toBe(7 * 60);
      // A ticked-forward load must not throw on any clock consumer.
      expect(() => sim.tick(60)).not.toThrow();
    }
    for (const bad of [Infinity, -Infinity]) expectInfinityHandled(leg, { ...data, minutes: bad }, (save) => expect(save.minutes, `minutes ${bad}`).toBe(7 * 60));
    // A legitimate fractional minute count round-trips exactly: real play
    // accumulates sub-minute steps, so the coercion must not floor a valid save.
    expect(resave(leg, { ...data, minutes: 420.5 }).minutes).toBe(420.5);
  });

  it("migrates a v3 save up the ladder (venue-census bump): re-stamps version, tower intact", () => {
    // v3 -> v4 is additive/no-op data-wise: the meal-customer census reads a
    // transient overlay that is never serialized, so a v3 save is already valid
    // v4 data. The migration only re-stamps the version; the tower round-trips
    // unchanged and does not fall through the "newer than this build" path.
    const played = playedSave(leg);
    // Tenant the office, so the population check below has people to lose.
    const office = (played.units as { kind: string; state: string; occupants: number }[]).find((u) => u.kind === "office")!;
    office.state = "occupied";
    office.occupants = 6;
    const data = resave(leg, played);
    const population = load(leg, data).state.tower.totalPopulation();
    expect(population, "the office is tenanted, so the population check can fail").toBeGreaterThan(0);
    data.version = 3;
    const beforeUnits = JSON.stringify(data.units);
    const sim = load(leg, data);
    const after = JSON.parse(sim.save()) as Save;
    // No tall lobby (#308), so the engine stamps the plain format, one before its newest.
    expect(after.version).toBe(parseEngineIdentity(readEngineIdentity(wasm()))!.saveVersion - 1);
    expect(after.money).toBe(data.money);
    expect(sim.state.tower.totalPopulation()).toBe(population);
    // Units survive the hop byte-for-byte (only the version stamp changed),
    // compared in the key order the same engine writes.
    expect(JSON.stringify(after.units)).toBe(beforeUnits);
    expect(after.transports).toEqual(data.transports);
  });
});

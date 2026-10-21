import type { FacilityKind } from "../../engine/types";
import type { At, Outcome, ScenarioEngine, Spec } from "./scenario";

/**
 * The scenario ops that tune or provoke something the engine may refuse:
 * `sell`, `adjustRent`, `setNoRate`, `setCars`, `setSchedule` and `startFire`.
 * Each carries an optional `expectFail`, so a command one engine refuses and
 * the other accepts is a divergence and not a silent gap. A tile with nothing
 * on it is a scenario error either way: `expectFail` covers the engine's
 * refusal only.
 */

export type TuneCommand =
  | ({ op: "sell"; kind?: FacilityKind; expectFail?: boolean } & At)
  | ({ op: "adjustRent"; dir: 1 | -1; expectFail?: boolean } & At)
  | ({ op: "setNoRate"; expectFail?: boolean } & At)
  | ({ op: "setCars"; cars: number; expectFail?: boolean } & At)
  | ({ op: "setSchedule"; schedule: Record<string, unknown>; expectFail?: boolean } & At)
  | { op: "startFire"; expectFail?: boolean };

const AT = { floor: "int", x: "int" } as const;
/** The tune ops' fields, checked by the scenario loader like every op's. */
export const TUNE_OPS: Record<TuneCommand["op"], Spec> = {
  sell: { ...AT, kind: "kind?", expectFail: "bool?" },
  adjustRent: { ...AT, dir: "dir", expectFail: "bool?" },
  setNoRate: { ...AT, expectFail: "bool?" },
  setCars: { ...AT, cars: "count", expectFail: "bool?" },
  setSchedule: { ...AT, schedule: "obj", expectFail: "bool?" },
  startFire: { expectFail: "bool?" },
};

/** The command landed (or, with `expectFail`, was refused); anything else throws. */
export function expectOk(ok: boolean, expectFail: boolean | undefined, what: string, reason?: string): void {
  if (ok === !expectFail) return;
  throw new Error(`${what} ${ok ? "succeeded but was expected to fail" : `failed: ${reason ?? "no reason"}`}`);
}

/** A result against the command's `expectFail` and, when it names a `reason`, the exact refusal reason, so an engine that refuses for another reason (or checks the gates in another order) fails. */
export function expectOutcome(r: Outcome, c: { expectFail?: boolean; reason?: string }, what: string): void {
  if (c.reason !== undefined && !c.expectFail) throw new Error(`${what}: a reason needs expectFail`);
  expectOk(r.ok, c.expectFail, what, r.reason);
  if (c.reason !== undefined && r.reason !== c.reason) throw new Error(`${what} was refused for ${JSON.stringify(r.reason ?? "no reason")}, expected ${JSON.stringify(c.reason)}`);
}

function unitAt(e: ScenarioEngine, at: At) {
  const u = e.unitAt(at.floor, at.x);
  if (!u) throw new Error(`no unit at floor ${at.floor}, x ${at.x}`);
  return u;
}

function transportAt(e: ScenarioEngine, at: At) {
  const t = e.transportAt(at.floor, at.x);
  if (!t) throw new Error(`no transport at floor ${at.floor}, x ${at.x}`);
  return t;
}

export function applyTune(e: ScenarioEngine, c: TuneCommand): void {
  switch (c.op) {
    case "sell": {
      // An optional kind pins what the tile holds, so a scenario that says it
      // sells a housekeeping crew cannot quietly sell whatever sits there.
      if (c.kind !== undefined) {
        const here = e.unitAt(c.floor, c.x)?.kind ?? e.transportAt(c.floor, c.x)?.kind;
        if (here !== c.kind) throw new Error(`sell @ ${c.floor},${c.x}: expected ${c.kind}, found ${here ?? "nothing"}`);
      }
      // A refusal needs something on the tile to refuse: a sell at a bare tile
      // is a bad address, as it is for the ops that look up a unit first.
      if (c.expectFail && !e.unitAt(c.floor, c.x) && !e.transportAt(c.floor, c.x)) throw new Error(`no unit or transport at floor ${c.floor}, x ${c.x}`);
      expectOk(e.sellAt(c.floor, c.x), c.expectFail, `sell @ ${c.floor},${c.x}`);
      return;
    }
    case "adjustRent": {
      const u = unitAt(e, c);
      const moved = e.adjustRent(u.id, c.dir) !== null && unitAt(e, c).rent !== u.rent;
      expectOk(moved, c.expectFail, `adjustRent ${c.dir} @ ${c.floor},${c.x}`, "rent did not move");
      return;
    }
    case "setNoRate":
      expectOk(e.setNoRate(unitAt(e, c).id), c.expectFail, `setNoRate @ ${c.floor},${c.x}`);
      return;
    case "setCars": {
      const t = transportAt(e, c);
      expectOk(e.setCars(t.id, c.cars) && transportAt(e, c).cars === c.cars, c.expectFail, `setCars ${c.cars} @ ${c.floor},${c.x}`);
      return;
    }
    case "setSchedule":
      expectOk(e.setSchedule(transportAt(e, c).id, c.schedule), c.expectFail, `setSchedule @ ${c.floor},${c.x}`, "not an elevator");
      return;
    case "startFire": {
      const before = e.fires();
      e.startFire();
      expectOk(e.fires() > before, c.expectFail, "startFire", "nothing caught fire");
      return;
    }
  }
}

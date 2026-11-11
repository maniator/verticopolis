import { describe, expect, it } from "vitest";
import { INVALID_COMMAND } from "../../simport/request";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { draftTower } from "../portKit/portSim";

/**
 * The relayed edit commands' malformed-input boundary (#996), called raw:
 * straight into the wasm-bindgen glue, with no mirror in between, as
 * `chargeBindingRaw.integration.test.ts` does for the charge commands (#923).
 * `sellAt`, `setCars`, `resizeTransport`, `setStop`, `setSchedule` (its id),
 * `adjustRent` and `setNoRate` must each answer a malformed argument with
 * their refusal (`false`, `null`, or `{ ok: false, reason: INVALID_COMMAND }`
 * for the resize), move nothing and emit no gameplay event, instead of
 * coercing a value (`"5"` to 5, `null` to 0, `true` to 1) or truncating it to
 * 32 bits. Until #1875 the TypeScript engine answered every case alongside
 * it, with the same answers.
 *
 * Out of scope: `setSchedule`'s payload stays JSON text read by the glue as a
 * string, so it is always passed well formed here.
 */


type Raw = (...args: unknown[]) => unknown;
type Engine = Record<string, Raw> & { stateDigest(): string; drainGameplayEvents(): string; serialize(): string; free(): void };
type Call = { name: string; rust: (engine: Engine) => unknown };

const loose = <T>(v: unknown) => v as T;

/** A lobby, floors 2 and 3, an elevator on floors 1 to 3 and an office on 2,
 *  with money to spend: the same tower in both engines, through one save. */
function tower(): { engine: Engine; lift: number; office: number } {
  const built = draftTower(7, "classic");
  built.money = 1e7;
  for (let x = 170; x < 200; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 170; x < 200; x++) expect(built.build("floor", floor, x).ok).toBe(true);
  expect(built.buildTransport("elevatorStandard", 172, 1, 3).ok).toBe(true);
  expect(built.build("office", 2, 180).ok).toBe(true);
  const engine = loose<Engine>(wasm().Engine.fromSave(built.saveText()));
  const lift = built.tower.transportAt(1, 172)!.id as number;
  const office = built.tower.unitAt(2, 180)!.id as number;
  // The accepted edges send -0, which names id 0: neither fixture id may be it.
  expect([lift, office]).not.toContain(0);
  return { engine, lift, office };
}

const parsed = (v: unknown) => JSON.parse(v as string) as unknown;
const rent = (v: unknown) => v ?? null;

function binding(name: string, e: Engine, args: unknown[]): unknown {
  if (name === "setSchedule") return e.setSchedule(args[0], "null");
  const out = e[name](...args);
  if (name === "resizeTransport") return parsed(out);
  return name === "adjustRent" ? rent(out) : out;
}
const both = (name: string, label: string, args: unknown[]): Call => ({
  name: `${name}(${label})`,
  rust: (e) => binding(name, e, args),
});

/** What each command answers a malformed request with. */
function refusal(name: string): unknown {
  if (name === "resizeTransport") return { ok: false, reason: INVALID_COMMAND };
  return name === "adjustRent" ? null : false;
}

/** Every numeric argument of every command, with a well-formed value for
 *  the others: [command, the argument's index, the arguments]. */
function positions(lift: number, office: number): [string, number, unknown[]][] {
  return [
    ["sellAt", 0, [2, 180]],
    ["sellAt", 1, [2, 180]],
    ["setCars", 0, [lift, 2]],
    ["setCars", 1, [lift, 2]],
    ["resizeTransport", 0, [lift, 1, 2]],
    ["resizeTransport", 1, [lift, 1, 2]],
    ["resizeTransport", 2, [lift, 1, 2]],
    ["setStop", 0, [lift, 2, false]],
    ["setStop", 1, [lift, 2, false]],
    ["setSchedule", 0, [lift]],
    ["adjustRent", 0, [office, 1]],
    ["adjustRent", 1, [office, 1]],
    ["setNoRate", 0, [office]],
  ];
}

/** The malformed stand-ins for a well-formed number `v`. */
function malformed(v: number): [string, unknown][] {
  return [
    ["a numeric string", String(v)],
    ["null", null],
    ["undefined", undefined],
    ["true", true],
    ["false", false],
    ["a fraction", v + 0.5],
    ["NaN", Number.NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["2^53", 2 ** 53],
    ["-2^53", -(2 ** 53)],
    ["a BigInt", BigInt(v)],
    ["a Symbol", Symbol("v")],
    ["an object", { v }],
    ["an array", [v]],
    ["a boxed number", new Number(v)],
  ];
}

function cases(lift: number, office: number): Call[] {
  const list: Call[] = [];
  for (const [name, at, args] of positions(lift, office)) {
    for (const [what, bad] of malformed(args[at] as number)) {
      const next = [...args];
      next[at] = bad;
      list.push(both(name, `argument ${at} ${what}`, next));
    }
  }
  // Missing arguments: the glue reads them as undefined.
  const missing: [string, unknown[]][] = [
    ["sellAt", []], ["sellAt", [2]],
    ["setCars", []], ["setCars", [lift]],
    ["resizeTransport", []], ["resizeTransport", [lift]], ["resizeTransport", [lift, 1]],
    ["setStop", []], ["setStop", [lift]], ["setStop", [lift, 2]],
    ["adjustRent", []], ["adjustRent", [office]],
    ["setNoRate", []],
  ];
  for (const [name, args] of missing) list.push(both(name, `${args.length} of its arguments`, args));
  // A stop must be a real boolean.
  const stops: [string, unknown][] = [
    ["null", null], ["undefined", undefined], ["0", 0], ["1", 1], ["the string false", "false"], ["the string true", "true"],
    ["empty", ""], ["an object", {}], ["an array", []], ["a boxed Boolean", new Boolean(false)], ["NaN", Number.NaN], ["a Symbol", Symbol("stop")],
  ];
  for (const [what, stop] of stops) list.push(both("setStop", `stop ${what}`, [lift, 2, stop]));
  // A dir must be exactly 1 or -1, the only values any caller or scenario sends.
  const dirs: [string, unknown][] = [["0", 0], ["-0", -0], ["2", 2], ["-2", -2], ["0.5", 0.5], ["-1.5", -1.5], ["Number.MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER]];
  for (const [what, dir] of dirs) list.push(both("adjustRent", `dir ${what}`, [office, dir]));
  return list;
}

/** Whole numbers the boundary accepts that name nothing in the tower, or a
 *  floor or count at the edge of the safe range, where the command moves
 *  nothing: the engine answers with its own refusal, not as malformed. */
function acceptedEdges(lift: number, office: number): Call[] {
  const max = Number.MAX_SAFE_INTEGER;
  const far = 2 ** 32;
  const list: Call[] = [
    // Floor 2 or column 180 plus 2^32 was the office's tile to the old i32 binding.
    both("sellAt", "floor 2 + 2^32", [2 + far, 180]),
    both("sellAt", "column 180 + 2^32", [2, 180 + far]),
    both("sellAt", "floor 2 - 2^32", [2 - far, 180]),
    both("sellAt", "±(2^53 - 1)", [max, -max]),
    both("setStop", "floor 2 + 2^32", [lift, 2 + far, false]),
    both("setStop", "floor 2^53 - 1", [lift, max, false]),
    both("resizeTransport", "top 2^53 - 1", [lift, 1, max]),
    both("resizeTransport", "bottom -(2^53 - 1)", [lift, -max, 2]),
    // The shaft has one car; a count of -(2^53 - 1) clamps to that one.
    both("setCars", "cars -(2^53 - 1)", [lift, -max]),
  ];
  // An id plus or minus 2^32 named the same facility when the binding
  // truncated to i32; now each names nothing.
  const ids = (base: number) => [["-0", -0], ["-1", -1], ["2^53 - 1", max], ["-(2^53 - 1)", -max], ["the id + 2^32", base + far], ["the id - 2^32", base - far]] as const;
  for (const [what, id] of ids(lift)) {
    list.push(both("setCars", `id ${what}`, [id, 2]));
    list.push(both("resizeTransport", `id ${what}`, [id, 1, 2]));
    list.push(both("setStop", `id ${what}`, [id, 2, false]));
    list.push(both("setSchedule", `id ${what}`, [id]));
  }
  for (const [what, id] of ids(office)) {
    list.push(both("adjustRent", `id ${what}`, [id, 1]));
    list.push(both("setNoRate", `id ${what}`, [id]));
  }
  return list;
}

const events = (engine: Engine) => JSON.parse(engine.drainGameplayEvents() as string) as unknown[];
const command0 = (name: string) => name.slice(0, name.indexOf("("));

describe.skipIf(!hasWasmPackage())("relayed commands called raw through the binding (#996)", () => {
  it("refuses every malformed argument, moving nothing", () => {
    const { engine, lift, office } = tower();
    try {
      const start = engine.stateDigest();
      events(engine);
      const run = (list: Call[], malformedRun: boolean) => {
        for (const c of list) {
          let rust: unknown;
          expect(() => { rust = c.rust(engine); }, `${c.name}: the binding threw`).not.toThrow();
          const name = command0(c.name);
          if (!malformedRun && name === "resizeTransport") {
            const r = rust as { ok: boolean; reason?: string };
            expect(r.ok, `${c.name}: accepted`).toBe(false);
            expect(r.reason, `${c.name}: refused as malformed`).not.toBe(INVALID_COMMAND);
          } else {
            expect(rust, c.name).toEqual(refusal(name));
          }
          expect(engine.stateDigest(), `${c.name}: the tower moved`).toBe(start);
        }
      };
      const list = cases(lift, office);
      // 13 numeric arguments x 16 values + 13 missing + 12 stops + 7 dirs.
      expect(list).toHaveLength(13 * 16 + 13 + 12 + 7);
      run(list, true);
      const edges = acceptedEdges(lift, office);
      // 9 floor and count edges + 6 ids x 4 shaft commands + 6 ids x 2 unit commands.
      expect(edges).toHaveLength(9 + 24 + 12);
      run(edges, false);
      expect(events(engine), "a refusal emitted an event").toEqual([]);

      // Well-formed calls still land, and each moves the tower.
      const good: Call[] = [
        both("setCars", "lift, 2", [lift, 2]),
        both("setStop", "lift, 2, false", [lift, 2, false]),
        both("setStop", "lift, 2, true", [lift, 2, true]),
        both("setSchedule", "lift, null", [lift]),
        both("resizeTransport", "lift, 1, 2", [lift, 1, 2]),
        both("adjustRent", "office, 1", [office, 1]),
        both("adjustRent", "office, -1", [office, -1]),
        both("setNoRate", "office", [office]),
        both("sellAt", "2, 180", [2, 180]),
      ];
      for (const c of good) {
        const before = engine.stateDigest();
        expect(c.rust(engine), c.name).not.toEqual(refusal(command0(c.name)));
        if (c.name !== "setSchedule(lift, null)") expect(engine.stateDigest(), `${c.name}: the tower did not move`).not.toBe(before);
      }
      const save = JSON.parse(engine.serialize()) as { units: { id: number }[] };
      expect(save.units.map((u) => u.id), "the office sold").not.toContain(office);
      expect(events(engine), "the landed edits reported nothing").not.toEqual([]);
    } finally {
      engine.free();
    }
  });

  it("hand every changed argument to Rust as it is, so the glue cannot convert it", () => {
    // These methods take `JsValue` (#996); a number or boolean parameter is
    // converted at the wasm call, so the numeric half of the contract is
    // pinned by behavior above (a numeric string floor would sell the
    // office). setSchedule still passes its payload as a string, and shows
    // the check bites.
    const proto = loose<Record<string, unknown>>(wasm().Engine.prototype);
    const glue = (name: string) => String(proto[name]);
    expect(glue("setSchedule")).toMatch(/passStringToWasm0/);
    for (const name of ["sellAt", "setCars", "resizeTransport", "setStop", "adjustRent", "setNoRate"]) {
      expect(glue(name), name).not.toMatch(/passStringToWasm0/);
    }
  });
});

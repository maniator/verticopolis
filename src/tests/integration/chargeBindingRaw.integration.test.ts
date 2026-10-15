import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { stateView } from "../../engine/conformanceView";
import { INVALID_REQUEST } from "../../engine/sim/charges";
import { digest } from "../conformance/canonical";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The charge commands' malformed-input boundary (#923), called raw: straight
 * into the wasm-bindgen glue, with no mirror in between. Every case below is
 * one a second frontend could send. The binding must answer each exactly as
 * the TypeScript engine does (the same structured refusal, with
 * `extendTransport`'s ends as the shaft stands), move nothing and emit no
 * gameplay event, instead of coercing a value (`"5"` to 5, `null` to 0) or
 * throwing in the glue.
 *
 * Since #990 the extend gesture's high-water mark is engine-held
 * (`beginExtend` and `endExtend`), so neither engine takes a mark from the
 * caller: `extendTransport` has three arguments, and a fourth is ignored in
 * both, an inflated one included.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type Raw = (...args: unknown[]) => string;
type Engine = Record<string, Raw> & { stateDigest(): string; drainGameplayEvents(): string; free(): void };
type Call = { name: string; ts: (sim: Simulation) => unknown; rust: (engine: Engine) => string };

/** A lobby, a floor over it, an elevator on floors 1 and 2 and an office,
 *  with money to spend: the same tower in both engines, through one save. */
function tower(): { sim: Simulation; engine: Engine; lift: number; office: number; stairs: number } {
  const built = Simulation.newGame(7, "classic");
  built.money = 1e7;
  for (let x = 170; x < 200; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 200; x++) expect(built.build("floor", 2, x).ok).toBe(true);
  expect(built.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
  expect(built.build("office", 2, 180).ok).toBe(true);
  expect(built.buildTransport("stairs", 190, 1, 2).ok).toBe(true);
  const save = JSON.stringify(built.serialize());
  const sim = Simulation.deserialize(JSON.parse(save) as SerializedGame);
  const engine = loose<Engine>(wasm().Engine.fromSave(save));
  return { sim, engine, lift: sim.tower.transportAt(1, 172)!.id, office: sim.tower.unitAt(2, 180)!.id, stairs: sim.tower.transportAt(1, 190)!.id };
}

const loose = <T>(v: unknown) => v as T;
const call = (f: unknown, self: Simulation, ...args: unknown[]) => loose<(...a: unknown[]) => unknown>(f).call(self, ...args);

function cases(lift: number, office: number, stairs: number): Call[] {
  const list: Call[] = [];
  // The refusal's ends are those of whatever the whole id names: a stair
  // link's own, and 0 and 0 for a unit, which is no shaft.
  list.push({ name: "extendTransport(stairs, end sideways)", ts: (s) => s.extendTransport(stairs, loose("sideways"), 3), rust: (e) => e.extendTransport(stairs, "sideways", 3) });
  list.push({ name: "extendTransport(a unit's id, a fractional floor)", ts: (s) => s.extendTransport(office, "up", 3.5), rust: (e) => e.extendTransport(office, "up", 3.5) });
  const ids: [string, unknown][] = [
    ["a numeric string", String(lift)],
    ["null", null],
    ["undefined", undefined],
    ["true", true],
    ["false", false],
    ["a fraction", lift + 0.5],
    ["NaN", Number.NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["2^53", 2 ** 53],
    ["-2^53", -(2 ** 53)],
    ["a BigInt", BigInt(lift)],
    ["a Symbol", Symbol("id")],
    ["an object", { id: lift }],
    ["an array", [lift]],
    ["a boxed number", new Number(lift)],
  ];
  for (const [what, id] of ids) {
    list.push({ name: `addCar(${what})`, ts: (s) => s.addCar(loose(id)), rust: (e) => e.addCar(id) });
    list.push({ name: `removeCar(${what})`, ts: (s) => s.removeCar(loose(id)), rust: (e) => e.removeCar(id) });
    list.push({ name: `removeFacility(${what}, sell)`, ts: (s) => s.removeFacility(loose(id), "sell"), rust: (e) => e.removeFacility(id, "sell") });
    list.push({ name: `extendTransport(${what} id)`, ts: (s) => s.extendTransport(loose(id), "up", 3), rust: (e) => e.extendTransport(id, "up", 3) });
    list.push({ name: `extendTransport(target ${what})`, ts: (s) => s.extendTransport(lift, "up", loose(id)), rust: (e) => e.extendTransport(lift, "up", id) });
  }
  // Missing arguments: the glue reads them as undefined.
  list.push({ name: "addCar()", ts: (s) => call(s.addCar, s), rust: (e) => e.addCar() });
  list.push({ name: "removeCar()", ts: (s) => call(s.removeCar, s), rust: (e) => e.removeCar() });
  list.push({ name: "removeFacility()", ts: (s) => call(s.removeFacility, s), rust: (e) => e.removeFacility() });
  list.push({ name: "removeFacility(id)", ts: (s) => call(s.removeFacility, s, office), rust: (e) => e.removeFacility(office) });
  list.push({ name: "extendTransport()", ts: (s) => call(s.extendTransport, s), rust: (e) => e.extendTransport() });
  list.push({ name: "extendTransport(id)", ts: (s) => call(s.extendTransport, s, lift), rust: (e) => e.extendTransport(lift) });
  list.push({ name: "extendTransport(id, up)", ts: (s) => call(s.extendTransport, s, lift, "up"), rust: (e) => e.extendTransport(lift, "up") });
  // Enums: only the exact strings.
  const ends: [string, unknown][] = [["UP", "UP"], ["Down", "Down"], ["empty", ""], ["padded", " up"], ["null", null], ["undefined", undefined], ["5", 5], ["true", true], ["an object", {}], ["a boxed String", new String("up")]];
  for (const [what, end] of ends) {
    list.push({ name: `extendTransport(end ${what})`, ts: (s) => s.extendTransport(lift, loose(end), 3), rust: (e) => e.extendTransport(lift, end, 3) });
  }
  const methods: [string, unknown][] = [["Sell", "Sell"], ["BULLDOZE", "BULLDOZE"], ["empty", ""], ["burn", "burn"], ["null", null], ["undefined", undefined], ["7", 7], ["false", false], ["an array", ["sell"]], ["a boxed String", new String("sell")]];
  for (const [what, method] of methods) {
    list.push({ name: `removeFacility(method ${what})`, ts: (s) => s.removeFacility(office, loose(method)), rust: (e) => e.removeFacility(office, method) });
  }
  return list;
}

/** Whole numbers the boundary accepts that name nothing in the tower, or a
 *  floor at the edge of the safe range: the engines refuse them with
 *  their own reason, and must agree on it. */
function acceptedEdges(lift: number): Call[] {
  const max = Number.MAX_SAFE_INTEGER;
  const list: Call[] = [
    { name: "extendTransport(up to 2^53 - 1)", ts: (s) => s.extendTransport(lift, "up", max), rust: (e) => e.extendTransport(lift, "up", max) },
    { name: "extendTransport(down to -(2^53 - 1))", ts: (s) => s.extendTransport(lift, "down", -max), rust: (e) => e.extendTransport(lift, "down", -max) },
    // Floor 3 plus or minus 2^32 was floor 3 to the old i32 binding.
    { name: "extendTransport(up to 3 + 2^32)", ts: (s) => s.extendTransport(lift, "up", 3 + 2 ** 32), rust: (e) => e.extendTransport(lift, "up", 3 + 2 ** 32) },
    { name: "extendTransport(down to 3 - 2^32)", ts: (s) => s.extendTransport(lift, "down", 3 - 2 ** 32), rust: (e) => e.extendTransport(lift, "down", 3 - 2 ** 32) },
  ];
  // The shaft's id plus or minus 2^32 named the shaft itself when the binding
  // truncated to i32; now each names nothing, in both engines.
  const aliases = [["the id + 2^32", lift + 2 ** 32], ["the id - 2^32", lift - 2 ** 32]] as const;
  for (const [what, id] of [["-0", -0], ["-1", -1], ["2^53 - 1", Number.MAX_SAFE_INTEGER], ["-(2^53 - 1)", -Number.MAX_SAFE_INTEGER], ...aliases] as const) {
    list.push({ name: `addCar(${what})`, ts: (s) => s.addCar(id), rust: (e) => e.addCar(id) });
    list.push({ name: `removeCar(${what})`, ts: (s) => s.removeCar(id), rust: (e) => e.removeCar(id) });
    list.push({ name: `removeFacility(${what}, sell)`, ts: (s) => s.removeFacility(id, "sell"), rust: (e) => e.removeFacility(id, "sell") });
    list.push({ name: `extendTransport(${what} id)`, ts: (s) => s.extendTransport(id, "up", 3), rust: (e) => e.extendTransport(id, "up", 3) });
  }
  return list;
}

const drained = (sim: Simulation, engine: Engine) => ({ ts: JSON.parse(JSON.stringify(sim.drainGameplayEvents())) as unknown, rust: JSON.parse(engine.drainGameplayEvents()) as unknown });

describe.skipIf(!hasWasmPackage())("charge commands called raw through the binding (#923)", () => {
  it("refuse every malformed argument exactly as TypeScript does, moving nothing", () => {
    const { sim, engine, lift, office, stairs } = tower();
    try {
      const tsDigest = () => digest(stateView(sim));
      const start = tsDigest();
      expect(engine.stateDigest(), "the engines start apart").toBe(start);
      drained(sim, engine);
      const run = (list: Call[], malformed: boolean) => {
        for (const c of list) {
          let ts: { ok: boolean; reason?: string } = { ok: true };
          let raw = "";
          expect(() => { ts = c.ts(sim) as typeof ts; }, `${c.name}: TypeScript threw`).not.toThrow();
          expect(() => { raw = c.rust(engine); }, `${c.name}: the binding threw`).not.toThrow();
          expect(ts.ok, `${c.name}: TypeScript accepted it`).toBe(false);
          if (malformed) expect(ts.reason, c.name).toBe(INVALID_REQUEST);
          else expect(ts.reason, `${c.name}: refused as malformed`).not.toBe(INVALID_REQUEST);
          expect(JSON.parse(raw), c.name).toEqual(ts);
          expect(tsDigest(), `${c.name}: TypeScript moved`).toBe(start);
          expect(engine.stateDigest(), `${c.name}: Rust moved`).toBe(start);
        }
      };
      const list = cases(lift, office, stairs);
      // 2 ends checks + 16 ids x 5 + 7 missing + 10 ends + 10 methods.
      expect(list).toHaveLength(109);
      run(list, true);
      const edges = acceptedEdges(lift);
      // 4 floor edges + 6 ids x 4 commands.
      expect(edges).toHaveLength(28);
      run(edges, false);
      expect(drained(sim, engine), "a refusal emitted an event").toEqual({ ts: [], rust: [] });

      // beginExtend takes its id raw too: anything but a whole JS number
      // naming an elevator opens no gesture, in either engine, and moves nothing.
      const begin = (e: Engine, ...a: unknown[]) => loose<(...b: unknown[]) => boolean>(e.beginExtend).apply(e, a);
      const beginTs = (...a: unknown[]) => loose<(...b: unknown[]) => boolean>(sim.beginExtend).apply(sim, a);
      const badIds: unknown[][] = [[String(lift)], [null], [undefined], [true], [lift + 0.5], [Number.NaN], [Infinity], [2 ** 53], [BigInt(lift)], [{ id: lift }], [new Number(lift)], [], [office], [stairs], [lift + 2 ** 32], [-0]];
      for (const args of badIds) {
        const name = `beginExtend(${args.map((v) => typeof v === "bigint" ? `${v}n` : String(v)).join(", ")})`;
        expect(beginTs(...args), name).toBe(false);
        expect(begin(engine, ...args), name).toBe(false);
      }
      expect(tsDigest(), "TypeScript moved on beginExtend").toBe(start);
      expect(engine.stateDigest(), "Rust moved on beginExtend").toBe(start);
      expect(drained(sim, engine), "beginExtend emitted an event").toEqual({ ts: [], rust: [] });

      // Well-formed calls still land in both, with the same answers, events
      // and state: a gesture that wiggles inside its mark for free, a press
      // after it closes, a caller's inflated fourth argument that buys
      // nothing, and the car and removal commands.
      const extend = (e: Engine | Simulation, ...a: unknown[]) => loose<(...b: unknown[]) => unknown>(e.extendTransport).apply(e, a);
      expect(beginTs(lift)).toBe(true);
      expect(begin(engine, lift)).toBe(true);
      // An open gesture is in neither engine's hashed state.
      expect(tsDigest(), "TypeScript hashed the gesture").toBe(start);
      expect(engine.stateDigest(), "Rust hashed the gesture").toBe(start);
      const good: Call[] = [
        { name: "extendTransport in a gesture", ts: (s) => s.extendTransport(lift, "up", 4), rust: (e) => e.extendTransport(lift, "up", 4) },
        { name: "extendTransport back inside the mark", ts: (s) => s.extendTransport(lift, "up", 3), rust: (e) => e.extendTransport(lift, "up", 3) },
        { name: "extendTransport regrown inside the mark", ts: (s) => s.extendTransport(lift, "up", 4), rust: (e) => e.extendTransport(lift, "up", 4) },
        { name: "endExtend, then a shrink", ts: (s) => (s.endExtend(), s.extendTransport(lift, "up", 3)), rust: (e) => (e.endExtend(), e.extendTransport(lift, "up", 3)) },
        { name: "extendTransport with an inflated caller mark", ts: (s) => extend(s, lift, "up", 5, { bottom: 1, top: 50 }), rust: (e) => loose<string>(extend(e, lift, "up", 5, '{"bottom":1,"top":50}')) },
        { name: "addCar", ts: (s) => s.addCar(lift), rust: (e) => e.addCar(lift) },
        { name: "removeCar", ts: (s) => s.removeCar(lift), rust: (e) => e.removeCar(lift) },
        { name: "removeFacility", ts: (s) => s.removeFacility(office, "sell"), rust: (e) => e.removeFacility(office, "sell") },
      ];
      const added: number[] = [];
      for (const c of good) {
        const ts = c.ts(sim) as { ok: boolean; added?: number };
        expect(ts.ok, c.name).toBe(true);
        expect(JSON.parse(c.rust(engine)), c.name).toEqual(ts);
        expect(engine.stateDigest(), `${c.name}: the engines split`).toBe(tsDigest());
        if (ts.added !== undefined) added.push(ts.added);
      }
      // Two floors billed out, none back in, none regrown, and the press after
      // the gesture bills its floors past the span: the mark was engine-held.
      expect(added).toEqual([2, 0, 0, 0, 2]);
      // A refused begin drops an open gesture in both engines: after it, a
      // shrink and regrow inside the old mark is billed again, alike.
      for (const bad of [[lift + 0.5], [String(lift)], [stairs], []]) {
        expect(beginTs(lift)).toBe(true);
        expect(begin(engine, lift)).toBe(true);
        const steps: Call[] = [
          { name: "a paid floor", ts: (s) => s.extendTransport(lift, "up", 6), rust: (e) => e.extendTransport(lift, "up", 6) },
          { name: "back down", ts: (s) => s.extendTransport(lift, "up", 5), rust: (e) => e.extendTransport(lift, "up", 5) },
        ];
        for (const c of steps) expect(JSON.parse(c.rust(engine)), c.name).toEqual(c.ts(sim));
        expect(beginTs(...bad)).toBe(false);
        expect(begin(engine, ...bad)).toBe(false);
        const ts = sim.extendTransport(lift, "up", 6);
        expect(ts, `regrow after beginExtend(${String(bad[0])})`).toMatchObject({ ok: true, added: 1 });
        expect(JSON.parse(engine.extendTransport(lift, "up", 6))).toEqual(ts);
        expect(engine.stateDigest()).toBe(tsDigest());
        expect(sim.extendTransport(lift, "up", 5).ok).toBe(true);
        expect(JSON.parse(engine.extendTransport(lift, "up", 5)).ok).toBe(true);
      }
      const events = drained(sim, engine);
      expect(events.rust).toEqual(events.ts);
    } finally {
      engine.free();
    }
  });

  it("hand end and method to Rust as they are, so the glue cannot throw on a non-string", () => {
    // A `&str` parameter is converted in the JS glue (passStringToWasm0),
    // which throws on a non-string before Rust could refuse. The charge
    // commands take `JsValue` instead. A number parameter is coerced at the
    // wasm call rather than in the glue, so the numeric half of the contract
    // is pinned by behavior above (a numeric string id would buy a car).
    // setTowerName, which takes a string, shows the check bites.
    const proto = loose<Record<string, unknown>>(wasm().Engine.prototype);
    const glue = (name: string) => String(proto[name]);
    expect(glue("setTowerName")).toMatch(/passStringToWasm0/);
    for (const name of ["addCar", "removeCar", "beginExtend", "extendTransport", "endExtend", "removeFacility"]) {
      expect(glue(name), name).not.toMatch(/passStringToWasm0/);
    }
  });
});

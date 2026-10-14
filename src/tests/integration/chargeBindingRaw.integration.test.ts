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
 * Intentionally unsupported: the binding's mark is JSON text, so a mark
 * passed as an object is refused where TypeScript (taking the object) would
 * extend, and a mark field written as a JSON float (`2.0`, `1e1`,
 * `9007199254740990.5`) is refused though an f64 would read it as a whole
 * floor. Neither moves anything.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type Raw = (...args: unknown[]) => string;
type Engine = Record<string, Raw> & { stateDigest(): string; drainGameplayEvents(): string; free(): void };
type Call = { name: string; ts: (sim: Simulation) => unknown; rust: (engine: Engine) => string };

/** A lobby, a floor over it, an elevator on floors 1 and 2 and an office,
 *  with money to spend: the same tower in both engines, through one save. */
function tower(): { sim: Simulation; engine: Engine; lift: number; office: number } {
  const built = Simulation.newGame(7, "classic");
  built.money = 1e7;
  for (let x = 170; x < 200; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 200; x++) expect(built.build("floor", 2, x).ok).toBe(true);
  expect(built.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
  expect(built.build("office", 2, 180).ok).toBe(true);
  const save = JSON.stringify(built.serialize());
  const sim = Simulation.deserialize(JSON.parse(save) as SerializedGame);
  const engine = loose<Engine>(wasm().Engine.fromSave(save));
  return { sim, engine, lift: sim.tower.transportAt(1, 172)!.id, office: sim.tower.unitAt(2, 180)!.id };
}

const loose = <T>(v: unknown) => v as T;
const call = (f: unknown, self: Simulation, ...args: unknown[]) => loose<(...a: unknown[]) => unknown>(f).call(self, ...args);

function cases(lift: number, office: number): Call[] {
  const list: Call[] = [];
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
    list.push({ name: `extendTransport(${what} id)`, ts: (s) => s.extendTransport(loose(id), "up", 3), rust: (e) => e.extendTransport(id, "up", 3, null) });
    list.push({ name: `extendTransport(target ${what})`, ts: (s) => s.extendTransport(lift, "up", loose(id)), rust: (e) => e.extendTransport(lift, "up", id, null) });
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
    list.push({ name: `extendTransport(end ${what})`, ts: (s) => s.extendTransport(lift, loose(end), 3), rust: (e) => e.extendTransport(lift, end, 3, null) });
  }
  const methods: [string, unknown][] = [["Sell", "Sell"], ["BULLDOZE", "BULLDOZE"], ["empty", ""], ["burn", "burn"], ["null", null], ["undefined", undefined], ["7", 7], ["false", false], ["an array", ["sell"]], ["a boxed String", new String("sell")]];
  for (const [what, method] of methods) {
    list.push({ name: `removeFacility(method ${what})`, ts: (s) => s.removeFacility(office, loose(method)), rust: (e) => e.removeFacility(office, method) });
  }
  // Marks. TypeScript takes the object; the binding takes its JSON text.
  const marks: [string, unknown, unknown][] = [
    ["a fractional top", { bottom: 1, top: 2.5 }, '{"bottom":1,"top":2.5}'],
    ["a top past 2^53", { bottom: 1, top: 2 ** 53 }, '{"bottom":1,"top":9007199254740992}'],
    ["a string bottom", { bottom: "1", top: 2 }, '{"bottom":"1","top":2}'],
    ["a NaN bottom, stringified", { bottom: Number.NaN, top: 2 }, JSON.stringify({ bottom: Number.NaN, top: 2 })],
    ["a NaN bottom, written raw", { bottom: Number.NaN, top: 2 }, '{"bottom":NaN,"top":2}'],
    ["a missing top", { bottom: 1 }, '{"bottom":1}'],
    ["an array", [1, 2], "[1,2]"],
    ["a number", 0, 0],
    ["a boolean", false, false],
    ["empty text", "", ""],
    ["text that is not JSON", "{oops", "{oops"],
  ];
  for (const [what, tsMark, rustMark] of marks) {
    list.push({ name: `extendTransport(mark ${what})`, ts: (s) => s.extendTransport(lift, "up", 3, loose(tsMark)), rust: (e) => e.extendTransport(lift, "up", 3, rustMark) });
  }
  return list;
}

/** Whole numbers the boundary accepts that name nothing in the tower: the
 *  engines refuse them with their own reason, and must agree on it. */
function unknownIds(): Call[] {
  const list: Call[] = [];
  for (const [what, id] of [["-0", -0], ["-1", -1], ["2^53 - 1", Number.MAX_SAFE_INTEGER], ["-(2^53 - 1)", -Number.MAX_SAFE_INTEGER]] as const) {
    list.push({ name: `addCar(${what})`, ts: (s) => s.addCar(id), rust: (e) => e.addCar(id) });
    list.push({ name: `removeCar(${what})`, ts: (s) => s.removeCar(id), rust: (e) => e.removeCar(id) });
    list.push({ name: `removeFacility(${what}, sell)`, ts: (s) => s.removeFacility(id, "sell"), rust: (e) => e.removeFacility(id, "sell") });
    list.push({ name: `extendTransport(${what} id)`, ts: (s) => s.extendTransport(id, "up", 3), rust: (e) => e.extendTransport(id, "up", 3, null) });
  }
  return list;
}

const drained = (sim: Simulation, engine: Engine) => ({ ts: JSON.parse(JSON.stringify(sim.drainGameplayEvents())) as unknown, rust: JSON.parse(engine.drainGameplayEvents()) as unknown });

describe.skipIf(!hasWasmPackage())("charge commands called raw through the binding (#923)", () => {
  it("refuse every malformed argument exactly as TypeScript does, moving nothing", () => {
    const { sim, engine, lift, office } = tower();
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
          expect(JSON.parse(raw), c.name).toEqual(ts);
          expect(tsDigest(), `${c.name}: TypeScript moved`).toBe(start);
          expect(engine.stateDigest(), `${c.name}: Rust moved`).toBe(start);
        }
      };
      const list = cases(lift, office);
      expect(list).toHaveLength(118);
      run(list, true);
      const unknown = unknownIds();
      expect(unknown).toHaveLength(16);
      run(unknown, false);
      expect(drained(sim, engine), "a refusal emitted an event").toEqual({ ts: [], rust: [] });

      // Intentionally unsupported: a mark passed as an object, or with a field
      // written as a JSON float, is refused by the binding without moving.
      // The last has no TypeScript twin: as a JS number it is already the
      // whole 9007199254740990, which an f64 parse would also have taken.
      for (const mark of [{ bottom: 1, top: 2 }, '{"bottom":1,"top":2.0}', '{"bottom":1,"top":1e1}', '{"bottom":1,"top":9007199254740990.5}']) {
        const refused = JSON.parse(engine.extendTransport(lift, "up", 3, mark));
        expect(refused, JSON.stringify(mark)).toEqual({ ok: false, reason: INVALID_REQUEST, delta: 0, bottom: 1, top: 2, added: 0 });
        expect(engine.stateDigest(), `Rust moved on ${JSON.stringify(mark)}`).toBe(start);
      }
      expect(JSON.parse(engine.drainGameplayEvents())).toEqual([]);

      // Well-formed calls still land in both, with the same answers, events
      // and state: a JSON mark, the text `null` as no mark, a three-argument
      // call, and a car.
      const good: Call[] = [
        { name: "extendTransport with a mark", ts: (s) => s.extendTransport(lift, "up", 3, { bottom: 1, top: 2 }), rust: (e) => e.extendTransport(lift, "up", 3, '{"bottom":1,"top":2}') },
        { name: "extendTransport with the text null", ts: (s) => s.extendTransport(lift, "up", 4, null), rust: (e) => e.extendTransport(lift, "up", 4, "null") },
        { name: "extendTransport with three arguments", ts: (s) => s.extendTransport(lift, "up", 5), rust: (e) => e.extendTransport(lift, "up", 5) },
        { name: "addCar", ts: (s) => s.addCar(lift), rust: (e) => e.addCar(lift) },
      ];
      for (const c of good) {
        const ts = c.ts(sim) as { ok: boolean };
        expect(ts.ok, c.name).toBe(true);
        expect(JSON.parse(c.rust(engine)), c.name).toEqual(ts);
        expect(engine.stateDigest(), `${c.name}: the engines split`).toBe(tsDigest());
      }
      const events = drained(sim, engine);
      expect(events.rust).toEqual(events.ts);
    } finally {
      engine.free();
    }
  });
});

import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { INVALID_REQUEST } from "../../engine/sim/charges";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The charge commands' malformed-input boundary (#923), called raw: straight
 * into the wasm-bindgen glue, with no mirror in between. Every case below is
 * one a second frontend could send. The binding must answer each exactly as
 * the TypeScript engine does (the same structured refusal, with
 * `extendTransport`'s ends as the shaft stands) and move nothing, instead of
 * coercing a value (`"5"` to 5, `null` to 0) or throwing in the glue.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type Raw = (...args: unknown[]) => string;
type Call = { name: string; ts: (sim: Simulation) => unknown; rust: (engine: Record<string, Raw>) => string };

/** A lobby, a floor over it, an elevator on floors 1 and 2 and an office,
 *  with money to spend: the same tower in both engines, through a save. */
function tower(): { sim: Simulation; lift: number; office: number } {
  const sim = Simulation.newGame(7, "classic");
  sim.money = 1e7;
  for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
  expect(sim.build("office", 2, 180).ok).toBe(true);
  return { sim, lift: sim.tower.transportAt(1, 172)!.id, office: sim.tower.unitAt(2, 180)!.id };
}

const loose = <T>(v: unknown) => v as T;

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
  list.push({ name: "addCar()", ts: (s) => loose<(...a: unknown[]) => unknown>(s.addCar).call(s), rust: (e) => e.addCar() });
  list.push({ name: "removeFacility(id)", ts: (s) => loose<(...a: unknown[]) => unknown>(s.removeFacility).call(s, office), rust: (e) => e.removeFacility(office) });
  list.push({ name: "extendTransport(id, up)", ts: (s) => loose<(...a: unknown[]) => unknown>(s.extendTransport).call(s, lift, "up"), rust: (e) => e.extendTransport(lift, "up") });
  // Enums: only the exact strings.
  for (const end of ["UP", "Down", "", " up", null, undefined, 5, true, {}]) {
    list.push({ name: `extendTransport(end ${JSON.stringify(end) ?? "undefined"})`, ts: (s) => s.extendTransport(lift, loose(end), 3), rust: (e) => e.extendTransport(lift, end, 3, null) });
  }
  for (const method of ["Sell", "BULLDOZE", "", "burn", null, undefined, 7, false, ["sell"]]) {
    list.push({ name: `removeFacility(method ${JSON.stringify(method) ?? "undefined"})`, ts: (s) => s.removeFacility(office, loose(method)), rust: (e) => e.removeFacility(office, method) });
  }
  // Marks. TypeScript takes the object; the binding takes its JSON text,
  // so a mark that is not text (a number, a boolean, an object) is refused.
  const marks: [string, unknown, unknown][] = [
    ["a fractional top", { bottom: 1, top: 2.5 }, '{"bottom":1,"top":2.5}'],
    ["a string bottom", { bottom: "1", top: 2 }, '{"bottom":"1","top":2}'],
    ["a NaN bottom", { bottom: Number.NaN, top: 2 }, JSON.stringify({ bottom: Number.NaN, top: 2 })],
    ["a missing top", { bottom: 1 }, '{"bottom":1}'],
    ["an array", [1, 2], "[1,2]"],
    ["a number", 0, 0],
    ["a boolean", false, false],
    ["text that is not JSON", "{oops", "{oops"],
  ];
  for (const [what, tsMark, rustMark] of marks) {
    list.push({ name: `extendTransport(mark ${what})`, ts: (s) => s.extendTransport(lift, "up", 3, loose(tsMark)), rust: (e) => e.extendTransport(lift, "up", 3, rustMark) });
  }
  return list;
}

describe.skipIf(!hasWasmPackage())("charge commands called raw through the binding (#923)", () => {
  it("refuse every malformed argument exactly as TypeScript does, moving nothing", () => {
    const { sim, lift, office } = tower();
    const engine = loose<Record<string, Raw> & { stateDigest(): string; free(): void }>(wasm().Engine.fromSave(JSON.stringify(sim.serialize())));
    try {
      const tsBefore = JSON.stringify(sim.serialize());
      const rustBefore = engine.stateDigest();
      const list = cases(lift, office);
      expect(list.length).toBeGreaterThan(80);
      for (const c of list) {
        const ts = c.ts(sim) as { ok: boolean; reason?: string };
        let raw = "";
        expect(() => { raw = c.rust(engine); }, c.name).not.toThrow();
        expect(ts.ok, `${c.name}: TypeScript accepted it`).toBe(false);
        expect(ts.reason, c.name).toBe(INVALID_REQUEST);
        expect(JSON.parse(raw), c.name).toEqual(ts);
      }
      expect(JSON.stringify(sim.serialize()), "TypeScript moved").toBe(tsBefore);
      expect(engine.stateDigest(), "Rust moved").toBe(rustBefore);
      // Intentionally unsupported: the binding's mark is JSON text, so a
      // well-formed mark passed as a raw object is refused, cleanly and
      // without moving, where TypeScript (taking the object) would extend.
      const objectMark = JSON.parse(engine.extendTransport(lift, "up", 3, { bottom: 1, top: 2 }));
      expect(objectMark).toEqual({ ok: false, reason: INVALID_REQUEST, delta: 0, bottom: 1, top: 2, added: 0 });
      expect(engine.stateDigest(), "Rust moved on an object mark").toBe(rustBefore);
      // The same well-formed calls still land in both, from equal states.
      const tsOk = sim.extendTransport(lift, "up", 3, { bottom: 1, top: 2 });
      expect(JSON.parse(engine.extendTransport(lift, "up", 3, '{"bottom":1,"top":2}'))).toEqual(tsOk);
      expect(tsOk.ok).toBe(true);
      expect(JSON.parse(engine.addCar(lift))).toEqual(sim.addCar(lift));
    } finally {
      engine.free();
    }
  });
});

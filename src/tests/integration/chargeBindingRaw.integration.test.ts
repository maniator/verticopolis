import { describe, expect, it } from "vitest";
import { INVALID_COMMAND } from "../../simport/request";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { draftTower } from "../portKit/portSim";

/**
 * The charge commands' malformed-input boundary (#923), called raw: straight
 * into the wasm-bindgen glue, with no mirror in between. Every case below is
 * one a second frontend could send. The binding must refuse each with the
 * structured refusal (`extendTransport`'s carries the ends of whatever the
 * id names), move nothing and emit no gameplay event, instead of coercing a
 * value (`"5"` to 5, `null` to 0) or throwing in the glue. Until #1875 the
 * TypeScript engine answered every case alongside it; its answers are the
 * expectations below.
 *
 * Since #990 the extend gesture's high-water mark is engine-held
 * (`beginExtend` and `endExtend`), so the engine takes no mark from the
 * caller: `extendTransport` has three arguments, and a fourth is ignored, an
 * inflated one included.
 */

type Raw = (...args: unknown[]) => string;
type Engine = Record<string, Raw> & { stateDigest(): string; drainGameplayEvents(): string; free(): void };
type Call = { name: string; rust: (engine: Engine) => string; ends?: [number, number] };
type Answer = { ok: boolean; reason?: string; added?: number; bottom?: number; top?: number };

/** A lobby, a floor over it, an elevator on floors 1 and 2, an office and
 *  stairs, with money to spend, reopened from its save as the game opens one. */
function tower(): { engine: Engine; lift: number; office: number; stairs: number } {
  const built = draftTower(7, "classic");
  built.money = 1e7;
  for (let x = 170; x < 200; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 200; x++) expect(built.build("floor", 2, x).ok).toBe(true);
  expect(built.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
  expect(built.build("office", 2, 180).ok).toBe(true);
  expect(built.buildTransport("stairs", 190, 1, 2).ok).toBe(true);
  const engine = loose<Engine>(wasm().Engine.fromSave(built.saveText()));
  return {
    engine,
    lift: built.tower.transportAt(1, 172)!.id as number,
    office: built.tower.unitAt(2, 180)!.id as number,
    stairs: built.tower.transportAt(1, 190)!.id as number,
  };
}

const loose = <T>(v: unknown) => v as T;

/** The ends a refused extend reports: the shaft's own, and 0 and 0 for an id
 *  that names no shaft. */
const SHAFT: [number, number] = [1, 2];
const NONE: [number, number] = [0, 0];

function cases(lift: number, office: number, stairs: number): Call[] {
  const list: Call[] = [];
  list.push({ name: "extendTransport(stairs, end sideways)", rust: (e) => e.extendTransport(stairs, "sideways", 3), ends: SHAFT });
  list.push({ name: "extendTransport(a unit's id, a fractional floor)", rust: (e) => e.extendTransport(office, "up", 3.5), ends: NONE });
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
    list.push({ name: `addCar(${what})`, rust: (e) => e.addCar(id) });
    list.push({ name: `removeCar(${what})`, rust: (e) => e.removeCar(id) });
    list.push({ name: `removeFacility(${what}, sell)`, rust: (e) => e.removeFacility(id, "sell") });
    list.push({ name: `extendTransport(${what} id)`, rust: (e) => e.extendTransport(id, "up", 3), ends: NONE });
    list.push({ name: `extendTransport(target ${what})`, rust: (e) => e.extendTransport(lift, "up", id), ends: SHAFT });
  }
  // Missing arguments: the glue reads them as undefined.
  list.push({ name: "addCar()", rust: (e) => e.addCar() });
  list.push({ name: "removeCar()", rust: (e) => e.removeCar() });
  list.push({ name: "removeFacility()", rust: (e) => e.removeFacility() });
  list.push({ name: "removeFacility(id)", rust: (e) => e.removeFacility(office) });
  list.push({ name: "extendTransport()", rust: (e) => e.extendTransport(), ends: NONE });
  list.push({ name: "extendTransport(id)", rust: (e) => e.extendTransport(lift), ends: SHAFT });
  list.push({ name: "extendTransport(id, up)", rust: (e) => e.extendTransport(lift, "up"), ends: SHAFT });
  // Enums: only the exact strings.
  const ends: [string, unknown][] = [["UP", "UP"], ["Down", "Down"], ["empty", ""], ["padded", " up"], ["null", null], ["undefined", undefined], ["5", 5], ["true", true], ["an object", {}], ["a boxed String", new String("up")]];
  for (const [what, end] of ends) {
    list.push({ name: `extendTransport(end ${what})`, rust: (e) => e.extendTransport(lift, end, 3), ends: SHAFT });
  }
  const methods: [string, unknown][] = [["Sell", "Sell"], ["BULLDOZE", "BULLDOZE"], ["empty", ""], ["burn", "burn"], ["null", null], ["undefined", undefined], ["7", 7], ["false", false], ["an array", ["sell"]], ["a boxed String", new String("sell")]];
  for (const [what, method] of methods) {
    list.push({ name: `removeFacility(method ${what})`, rust: (e) => e.removeFacility(office, method) });
  }
  return list;
}

/** Whole numbers the boundary accepts that name nothing in the tower, or a
 *  floor at the edge of the safe range: the engine refuses them with its own
 *  reason, not as malformed. */
function acceptedEdges(lift: number): Call[] {
  const max = Number.MAX_SAFE_INTEGER;
  const list: Call[] = [
    { name: "extendTransport(up to 2^53 - 1)", rust: (e) => e.extendTransport(lift, "up", max), ends: SHAFT },
    { name: "extendTransport(down to -(2^53 - 1))", rust: (e) => e.extendTransport(lift, "down", -max), ends: SHAFT },
    // Floor 3 plus or minus 2^32 was floor 3 to the old i32 binding.
    { name: "extendTransport(up to 3 + 2^32)", rust: (e) => e.extendTransport(lift, "up", 3 + 2 ** 32), ends: SHAFT },
    { name: "extendTransport(down to 3 - 2^32)", rust: (e) => e.extendTransport(lift, "down", 3 - 2 ** 32), ends: SHAFT },
  ];
  // The shaft's id plus or minus 2^32 named the shaft itself when the binding
  // truncated to i32; now each names nothing.
  const aliases = [["the id + 2^32", lift + 2 ** 32], ["the id - 2^32", lift - 2 ** 32]] as const;
  for (const [what, id] of [["-0", -0], ["-1", -1], ["2^53 - 1", Number.MAX_SAFE_INTEGER], ["-(2^53 - 1)", -Number.MAX_SAFE_INTEGER], ...aliases] as const) {
    list.push({ name: `addCar(${what})`, rust: (e) => e.addCar(id) });
    list.push({ name: `removeCar(${what})`, rust: (e) => e.removeCar(id) });
    list.push({ name: `removeFacility(${what}, sell)`, rust: (e) => e.removeFacility(id, "sell") });
    list.push({ name: `extendTransport(${what} id)`, rust: (e) => e.extendTransport(id, "up", 3), ends: NONE });
  }
  return list;
}

const events = (engine: Engine) => (JSON.parse(engine.drainGameplayEvents()) as { name: string }[]).map((e) => e.name);

describe.skipIf(!hasWasmPackage())("charge commands called raw through the binding (#923)", () => {
  it("refuses every malformed argument, moving nothing", () => {
    const { engine, lift, office, stairs } = tower();
    try {
      const start = engine.stateDigest();
      events(engine);
      const run = (list: Call[], malformed: boolean) => {
        for (const c of list) {
          let raw = "";
          expect(() => { raw = c.rust(engine); }, `${c.name}: the binding threw`).not.toThrow();
          const answer = JSON.parse(raw) as Answer;
          expect(answer.ok, `${c.name}: accepted`).toBe(false);
          if (malformed) expect(answer.reason, c.name).toBe(INVALID_COMMAND);
          else expect(answer.reason, `${c.name}: refused as malformed`).not.toBe(INVALID_COMMAND);
          if (c.ends) expect([answer.bottom, answer.top], `${c.name}: the ends`).toEqual(c.ends);
          expect(engine.stateDigest(), `${c.name}: the tower moved`).toBe(start);
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
      expect(events(engine), "a refusal emitted an event").toEqual([]);

      // beginExtend takes its id raw too: anything but a whole JS number
      // naming an elevator opens no gesture, and moves nothing.
      const begin = (...a: unknown[]) => loose<(...b: unknown[]) => boolean>(engine.beginExtend).apply(engine, a);
      const badIds: unknown[][] = [[String(lift)], [null], [undefined], [true], [lift + 0.5], [Number.NaN], [Infinity], [2 ** 53], [BigInt(lift)], [{ id: lift }], [new Number(lift)], [], [office], [stairs], [lift + 2 ** 32], [-0]];
      for (const args of badIds) {
        const name = `beginExtend(${args.map((v) => typeof v === "bigint" ? `${v}n` : String(v)).join(", ")})`;
        expect(begin(...args), name).toBe(false);
      }
      expect(engine.stateDigest(), "beginExtend moved the tower").toBe(start);
      expect(events(engine), "beginExtend emitted an event").toEqual([]);

      // Well-formed calls still land: a gesture that wiggles inside its mark
      // for free, a press after it closes, a caller's inflated fourth argument
      // that buys nothing, and the car and removal commands.
      const extend = (...a: unknown[]) => loose<(...b: unknown[]) => string>(engine.extendTransport).apply(engine, a);
      expect(begin(lift)).toBe(true);
      expect(engine.stateDigest(), "the open gesture was hashed").toBe(start);
      const good: Call[] = [
        { name: "extendTransport in a gesture", rust: (e) => e.extendTransport(lift, "up", 4) },
        { name: "extendTransport back inside the mark", rust: (e) => e.extendTransport(lift, "up", 3) },
        { name: "extendTransport regrown inside the mark", rust: (e) => e.extendTransport(lift, "up", 4) },
        { name: "endExtend, then a shrink", rust: (e) => (e.endExtend(), e.extendTransport(lift, "up", 3)) },
        { name: "extendTransport with an inflated caller mark", rust: () => extend(lift, "up", 5, '{"bottom":1,"top":50}') },
        { name: "addCar", rust: (e) => e.addCar(lift) },
        { name: "removeCar", rust: (e) => e.removeCar(lift) },
        { name: "removeFacility", rust: (e) => e.removeFacility(office, "sell") },
      ];
      const added: number[] = [];
      for (const c of good) {
        const answer = JSON.parse(c.rust(engine)) as Answer;
        expect(answer.ok, c.name).toBe(true);
        if (answer.added !== undefined) added.push(answer.added);
      }
      // Two floors billed out, none back in, none regrown, and the press after
      // the gesture bills its floors past the span: the mark was engine-held.
      expect(added).toEqual([2, 0, 0, 0, 2]);
      // Each span change and each car reports its capacity (five extends, a car
      // bought and one sold), then the sale reports its removal.
      expect(events(engine)).toEqual([...Array<string>(7).fill("capacity_changed"), "facility_removed"]);
      // A refused begin drops an open gesture: after it, a shrink and regrow
      // inside the old mark is billed again.
      for (const bad of [[lift + 0.5], [String(lift)], [stairs], []]) {
        expect(begin(lift)).toBe(true);
        expect(JSON.parse(engine.extendTransport(lift, "up", 6))).toMatchObject({ ok: true });
        expect(JSON.parse(engine.extendTransport(lift, "up", 5))).toMatchObject({ ok: true });
        expect(begin(...bad)).toBe(false);
        expect(JSON.parse(engine.extendTransport(lift, "up", 6)), `regrow after beginExtend(${String(bad[0])})`).toMatchObject({ ok: true, added: 1 });
        expect(JSON.parse(engine.extendTransport(lift, "up", 5)).ok).toBe(true);
      }
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

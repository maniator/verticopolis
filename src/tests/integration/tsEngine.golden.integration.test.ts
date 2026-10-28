import { afterEach, describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import { VIEW_LAYOUT, VIEW_LAYOUT_TEXT, codeOf, KIND_CODES } from "../../engine/port/layout";
import { TsEngine } from "../../engine/port/tsEngine";
import type { EnginePort } from "../../simport/enginePort";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

/**
 * The golden arrays (facade slice 7, PR 3): the Rust `Engine` and `TsEngine`
 * on the same tower answer the same records, slot for slot, so the shared
 * reader and every caller can hold either. Each check runs one call on both
 * engines and compares the answers, a refusal's text included; the tower is
 * then moved the same way on both and checked again.
 *
 * The meta revision is each engine's own count (the Rust setters log a
 * change, the TypeScript log finds it by comparing), so the frame header's
 * `metaRevision` slot is compared only for moving together, and listings by
 * the ids they name.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

type RustEngine = EnginePort & { free(): void };

const freed: RustEngine[] = [];
afterEach(() => {
  for (const e of freed.splice(0)) e.free();
});

const code = (kind: string): number => codeOf(KIND_CODES, kind);
const META = VIEW_LAYOUT.header.metaRevision;

/** A lobby and two floors, offices, a hotel room, a cinema, two fast food
 *  places (they carry a subtype), a renamed office, an elevator and stairs.
 *  One save loaded into both engines. */
function pair(mode: "classic" | "modern" = "modern"): [EnginePort, EnginePort] {
  const built = Simulation.newGame(11, mode);
  built.money = 1e8;
  built.star = 3;
  for (let x = 160; x < 280; x++) expect(built.build("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 160; x < 280; x++) expect(built.build("floor", floor, x).ok).toBe(true);
  for (const x of [170, 180]) expect(built.build("office", 2, x).ok).toBe(true);
  for (const floor of [2, 3]) expect(built.build("fastFood", floor, 190).ok).toBe(true);
  if (mode === "modern") {
    expect(built.build("hotelSingle", 3, 170).ok).toBe(true);
    expect(built.build("cinema", 2, 220).ok).toBe(true);
  }
  expect(built.buildTransport("elevatorStandard", 162, 1, 3).ok).toBe(true);
  expect(built.buildTransport("stairs", 275, 1, 2).ok).toBe(true);
  built.tower.unitAt(2, 170)!.label = "Corner Office";
  const save = JSON.stringify(built.serialize());
  const ts = new TsEngine(Simulation.deserialize(JSON.parse(save) as SerializedGame));
  const rust = wasm().Engine.fromSave(save) as unknown as RustEngine;
  freed.push(rust);
  return [rust, ts];
}

/** One call on both engines: the same answer and the same refusal text. */
function same<T>([rust, ts]: [EnginePort, EnginePort], call: (e: EnginePort) => T, what = "", reason = true): T {
  const a = call(rust);
  const b = call(ts);
  const plain = (v: T) => (v instanceof Float64Array ? Array.from(v) : v);
  expect(plain(b), what).toEqual(plain(a));
  if (reason) expect(ts.lastReason(), `${what} reason`).toBe(rust.lastReason());
  return a;
}

function sameFrame(p: [EnginePort, EnginePort], full: boolean): void {
  const [a, b] = p.map((e) => Array.from(e.viewFrame(full)));
  a[META] = b[META] = 0;
  expect(b).toEqual(a);
}

const units = (e: EnginePort): number[] => {
  const s = e.viewStructure();
  const l = VIEW_LAYOUT;
  const ids: number[] = [];
  for (let i = 0, at = l.structureWidth; i < s[l.structure.rooms]; i++, at += l.roomWidth) ids.push(s[at + l.room.id]);
  return ids;
};

/** Everything a panel or the HUD reads, on both engines. */
function sameReads(p: [EnginePort, EnginePort]): void {
  same(p, (e) => e.viewStructure(), "structure");
  sameFrame(p, true);
  same(p, (e) => e.statsStrip(), "statsStrip");
  same(p, (e) => e.hotspot(), "hotspot");
  same(p, (e) => e.onboarding(), "onboarding");
  same(p, (e) => e.crewCoverage(), "crewCoverage");
  for (let m = 0; m < VIEW_LAYOUT.heatModes.length; m++) same(p, (e) => e.heatCells(m), `heat ${m}`);
  for (const id of units(p[0])) {
    same(p, (e) => e.unitCard(id), `unit ${id}`);
    same(p, (e) => e.unitLabel(id), `label ${id}`);
    same(p, (e) => e.unitSubtype(id), `subtype ${id}`);
  }
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 200, 201, 202]) same(p, (e) => e.shaftCard(id), `shaft ${id}`);
  same(p, (e) => e.towerName(), "towerName");
  // Parsed: a camera past the safe integers is spelled `.0` by the Rust
  // writer and reads back as the same number.
  same(p, (e) => JSON.parse(e.view() ?? "null") as unknown, "view");
  same(p, (e) => e.logAfter(0), "log");
}

describe("TsEngine against the Rust Engine", () => {
  it.skipIf(!hasWasmPackage())("hands over the package's layout", () => {
    const [rust, ts] = pair();
    expect(ts.viewLayout()).toBe(rust.viewLayout());
    expect(JSON.parse(rust.viewLayout())).toEqual(JSON.parse(VIEW_LAYOUT_TEXT));
  });

  it.skipIf(!hasWasmPackage())("reads the same tower the same way, before and after play", () => {
    for (const mode of ["classic", "modern"] as const) {
      const p = pair(mode);
      sameReads(p);
      for (let i = 0; i < 6; i++) {
        p.forEach((e) => e.tick(90));
        sameFrame(p, false);
      }
      sameReads(p);
    }
  });

  it.skipIf(!hasWasmPackage())("answers every command with the same record", () => {
    const p = pair();
    const ids = (e: EnginePort) => units(e);
    const office = ids(p[0]).find((id) => p[0].unitCard(id)[1] === code("office"))!;
    const cinema = ids(p[0]).find((id) => p[0].unitCard(id)[1] === code("cinema"))!;
    const food = ids(p[0]).find((id) => p[0].unitCard(id)[1] === code("fastFood"))!;
    const tiles = Float64Array.from({ length: 6 }, (_, i) => 160 + i);
    const elevator = (e: EnginePort) => {
      for (let id = 1; id < 400; id++) if (e.shaftCard(id)[1] === code("elevatorStandard")) return id;
      throw new Error("no elevator");
    };
    const lift = elevator(p[0]);
    const schedule = new Float64Array(VIEW_LAYOUT.scheduleSlots);
    schedule[0] = 1;
    schedule.fill(2, 1, 25);
    schedule[50] = 3;
    schedule[51] = NaN;
    schedule[52] = 1;
    schedule[53] = 1;
    const steps: [string, (e: EnginePort) => unknown][] = [
      ["quoteBuild", (e) => e.quoteBuild(code("office"), 2, 255)],
      ["quoteBuild taken", (e) => e.quoteBuild(code("office"), 2, 170)],
      ["buildAt", (e) => e.buildAt(code("office"), 2, 255)],
      ["paintTiles", (e) => e.paintTiles(code("floor"), 4, tiles)],
      ["quoteShaft", (e) => e.quoteShaft(code("elevatorStandard"), 215, 1, 3)],
      ["buildShaft", (e) => e.buildShaft(code("elevatorStandard"), 215, 1, 3)],
      ["changeCars", (e) => e.changeCars(lift, true)],
      ["startExtend", (e) => e.startExtend(lift)],
      ["extendShaft", (e) => e.extendShaft(lift, true, 4)],
      ["stopExtend", (e) => e.stopExtend()],
      ["markStop", (e) => e.markStop(lift, 2, false)],
      ["expressStops", (e) => e.expressStops(lift)],
      ["dropStops", (e) => e.dropStops(lift)],
      ["scheduleShaft", (e) => e.scheduleShaft(lift, schedule)],
      ["labelUnit", (e) => e.labelUnit(office, "Big Office")],
      ["stepRent", (e) => e.stepRent(office, 1)],
      ["setRent", (e) => e.setRent(office, 5000)],
      ["noRate", (e) => e.noRate(office)],
      ["rentBatch", (e) => e.rentBatch(code("office"), NaN, false)],
      ["setFilm", (e) => e.setFilm(cinema, 2)],
      ["rerollUnit", (e) => e.rerollUnit(food)],
      ["bookExterminator", (e) => e.bookExterminator()],
      ["answerChoice", (e) => e.answerChoice(true)],
      ["chooseAutoBridge", (e) => e.chooseAutoBridge(false)],
      ["flipAutoBridge", (e) => e.flipAutoBridge()],
      ["nameTower", (e) => e.nameTower("Spire")],
      ["setCamera", (e) => e.setCamera(180.5, 2, 1.5)],
      ["logLine", (e) => e.logLine("Hello", 1)],
      ["demolish", (e) => e.demolish(food, false)],
    ];
    // A taken cell, No Rate in Modern (its prices are free, with no
    // off-market rung), no emergency pending and no room infested: refused
    // on both.
    const refused = new Set(["quoteBuild taken", "noRate", "bookExterminator", "answerChoice"]);
    for (const [what, step] of steps) {
      const r = same(p, step as (e: EnginePort) => Float64Array, what);
      // A refusal on both is still a match, so the script says which steps
      // must go through.
      expect(r[0], what).toBe(refused.has(what) ? 0 : 1);
      sameReads(p);
    }
    same(p, (e) => e.undoSignature() !== "", "undoSignature");
    same(p, (e) => e.nameTower(null), "nameTower cleared");
    same(p, (e) => e.towerName(), "no name");
  });

  it.skipIf(!hasWasmPackage())("refuses the same malformed requests with the same text", () => {
    const p = pair();
    const bad = [NaN, Infinity, 1.5, -0.5, 2 ** 53];
    const tiles = Float64Array.of(160, 1.5);
    const calls: [string, (e: EnginePort, v: number) => unknown][] = [
      ["buildAt kind", (e, v) => e.buildAt(v, 3, 200)],
      ["buildAt floor", (e, v) => e.buildAt(code("office"), v, 200)],
      ["paintTiles kind", (e, v) => e.paintTiles(v, 4, tiles)],
      ["paintTiles floor", (e, v) => e.paintTiles(code("floor"), v, tiles)],
      ["buildShaft", (e, v) => e.buildShaft(code("stairs"), v, 1, 2)],
      ["demolish", (e, v) => e.demolish(v, true)],
      ["changeCars", (e, v) => e.changeCars(v, true)],
      ["extendShaft", (e, v) => e.extendShaft(1, true, v)],
      ["markStop", (e, v) => e.markStop(v, 2, true)],
      ["expressStops", (e, v) => e.expressStops(v)],
      ["dropStops", (e, v) => e.dropStops(v)],
      ["labelUnit", (e, v) => e.labelUnit(v, "x")],
      ["stepRent", (e, v) => e.stepRent(1, v)],
      ["noRate", (e, v) => e.noRate(v)],
      ["setRent", (e, v) => e.setRent(1, v)],
      ["setFilm", (e, v) => e.setFilm(1, v)],
      ["rerollUnit", (e, v) => e.rerollUnit(v)],
      ["setCamera", (e, v) => e.setCamera(v, 2, 1)],
      ["logLine", (e, v) => e.logLine("x", v)],
      ["quoteBuild", (e, v) => e.quoteBuild(code("office"), v, 1)],
      ["quoteShaft", (e, v) => e.quoteShaft(v, 1, 1, 2)],
      ["heatCells", (e, v) => e.heatCells(v)],
      ["unitCard", (e, v) => e.unitCard(v)],
      ["shaftCard", (e, v) => e.shaftCard(v)],
      ["unitLabel", (e, v) => e.unitLabel(v)],
      ["logAfter", (e, v) => e.logAfter(v)],
      ["scheduleShaft", (e, v) => e.scheduleShaft(1, Float64Array.of(v))],
    ];
    for (const [what, call] of calls) for (const v of bad) same(p, (e) => call(e, v) as Float64Array, `${what} ${v}`);
    // NaN is the batch's "default" and the camera's "no zoom", so these two
    // take their own bad values.
    for (const v of [Infinity, -0.5, -2]) same(p, (e) => e.rentBatch(code("office"), v, false), `rentBatch ${v}`);
    for (const v of [0, -1, Infinity]) same(p, (e) => e.setCamera(1, 2, v), `setCamera zoom ${v}`);
    for (const id of [999, -1]) {
      same(p, (e) => e.demolish(id, false), `demolish ${id}`);
      same(p, (e) => e.changeCars(id, true), `changeCars ${id}`);
      same(p, (e) => e.setRent(id, 10), `setRent ${id}`);
      same(p, (e) => e.startExtend(id), `startExtend ${id}`);
    }
    sameReads(p);
  });

  it.skipIf(!hasWasmPackage())("logs label and subtype edits the same way", () => {
    const p = pair();
    // The ids each listing names, sorted, and whether it is full: the
    // revision numbers are each engine's own count.
    const listing = (e: EnginePort, since: number) => {
      const r = Array.from(e.unitMetaChanged(since));
      return [r[1], ...r.slice(2).sort((a, b) => a - b)];
    };
    same(p, (e) => listing(e, 0), "full listing");
    const rooms = units(p[0]);
    const office = rooms.find((id) => p[0].unitCard(id)[1] === code("office"))!;
    const food = rooms.find((id) => p[0].unitCard(id)[1] === code("fastFood"))!;
    const tile = (p[1] as TsEngine).sim.tower.unitAt(1, 230)!.id;
    // Before any frame: the edits are logged at once.
    const at = p.map((e) => e.unitMetaChanged(0)[0]);
    same(p, (e) => e.labelUnit(office, "Big Office"), "label");
    same(p, (e) => e.labelUnit(tile, "Front Desk"), "a tile's label");
    same(p, (e) => e.labelUnit(office, "Big Office"), "the same label again");
    same(p, (e) => e.rerollUnit(food), "reroll");
    const since = same(p, (e) => listing(e, at[p.indexOf(e)]), "the edits since");
    expect(since).toEqual([0, ...[office, tile, food].sort((a, b) => a - b)]);
    same(p, (e) => [e.unitLabel(tile), e.unitLabel(office), e.unitSubtype(food)], "the text");
    sameFrame(p, true);
    same(p, (e) => listing(e, 0), "full listing after");
    same(p, (e) => listing(e, 1e9), "a since past the revision");
    // The log's text and the drained events' text.
    p.forEach((e) => e.tick(720));
    const seqs = Array.from(p[0].logAfter(0)).filter((_, i) => i % 3 === 0);
    for (const seq of seqs) same(p, (e) => e.logText(seq), `log ${seq}`);
    const n = same(p, (e) => e.drainEvents(), "drain")[1];
    for (let i = 0; i <= n; i++) same(p, (e) => JSON.parse(e.eventText(i) ?? "null") as unknown, `event ${i}`);
  });

  it.skipIf(!hasWasmPackage())("swaps towers the same way", () => {
    const p = pair();
    const save = p[0].serialize();
    // A frame before the swaps, so the frame count after each is compared.
    sameFrame(p, false);
    same(p, (e) => e.setCamera(170, 2, 2), "camera");
    same(p, (e) => e.restore(save), "restore");
    same(p, (e) => e.view(), "restore keeps the live camera");
    same(p, (e) => e.loadSave(save), "loadSave");
    same(p, (e) => e.view(), "a load takes the saved camera");
    // The parse error's text is each engine's own.
    same(p, (e) => e.loadSave("{"), "a refused load", false);
    expect(p[1].lastReason()).toBeTruthy();
    same(p, (e) => e.generation(), "generation", false);
    same(p, (e) => e.foundTower(7, 1, 0, false), "foundTower");
    same(p, (e) => e.foundTower(-1, 1, 0, false), "a refused founding");
    same(p, (e) => e.foundTower(7, 2, 0, false), "an unknown mode");
    sameReads(p);
    p.forEach((e) => e.tick(600));
    same(p, (e) => e.drainEvents(), "drain");
    sameFrame(p, true);
  });
});

import { describe, expect, it } from "vitest";
import type { SimView } from "./view";
import {
  type MakeEngine,
  type Subject,
  delta,
  done,
  drain,
  expectUnmoved,
  furnish,
  kind,
  lobbyCenter,
  lobbyRight,
  logKind,
  must,
  mustFind,
  reasonOf,
  run,
  saved,
  slot,
  subject,
  LOT_WIDTH,
} from "./engineSubject.fixture";
import { scheduleSlots } from "./scheduleSlots";

/**
 * The command contract of `EnginePort`, run on either engine (PR 5e part 4
 * moved it here from the retired `SimPort` contracts). Each case starts from
 * a freshly founded Modern tower on its starter lobby and builds what it
 * needs through the port, asserting each step: an accepted command answers
 * its record with `delta` the balance's change and its effect on the reader
 * or in the save; a refusal moves nothing (no balance change, the same save,
 * no gameplay event); the brush lays exactly what its passes' builds, issued
 * one by one, lay.
 *
 * The towers the port cannot found (an emergency, an infested room, 3 stars,
 * Classic rules) are set up on the TypeScript `Simulation` first and handed
 * to the engine as a save, which `make` loads on either engine.
 */
export function describeEngineContract(name: string, make: MakeEngine): void {
  describe(`${name}: the engine port's commands`, () => {
    it("runs a scripted session, answering in the documented records, with each effect on the reader", () => {
      const s = subject(make);
      const { reader } = s;
      const mid = lobbyCenter(s);
      const revision = reader.header.revision;

      const office = must(s, (p) => p.buildAt(kind("office"), 2, mid - 4), "office");
      expect(delta(office)).toBeLessThan(0);
      expect(reader.header.revision).toBeGreaterThan(revision);
      const officeUnit = mustFind(reader.tower.units, (u) => u.kind === "office" && u.floor === 2);
      expect(reader.tower.unitAt(2, mid - 4)?.id).toBe(officeUnit.id);

      for (const floor of [2, 3]) for (let x = mid + 5; x < mid + 16; x++) must(s, (p) => p.buildAt(kind("floor"), floor, x), `floor ${floor} at ${x}`);
      expect(reader.tower.structureKindAt(3, mid + 8)).toBe("floor");

      must(s, (p) => p.buildShaft(kind("elevatorStandard"), mid + 8, 1, 2), "shaft");
      const shaft = mustFind(reader.tower.transports, (t) => t.kind === "elevatorStandard");
      expect([shaft.bottom, shaft.top, shaft.cars]).toEqual([1, 2, 1]);

      const minutes = reader.header.minutes;
      for (let i = 0; i < 5; i++) s.port.tick(1);
      reader.update();
      expect(reader.header.minutes).toBeGreaterThan(minutes);

      const car = must(s, (p) => p.changeCars(shaft.id, true), "a car");
      expect([Math.sign(delta(car)), slot("changeCars", car, "cars")]).toEqual([-1, 2]);
      expect(reader.tower.getTransport(shaft.id)?.cars).toBe(2);

      must(s, (p) => p.startExtend(shaft.id), "begin the extend");
      const extend = must(s, (p) => p.extendShaft(shaft.id, true, 3), "extend up");
      expect(Math.sign(delta(extend))).toBe(-1);
      expect(["bottom", "top", "added"].map((n) => slot("extendShaft", extend, n))).toEqual([1, 3, 1]);
      must(s, (p) => p.stopExtend(), "end the extend");
      expect(reader.tower.getTransport(shaft.id)?.top).toBe(3);

      const rent = must(s, (p) => p.stepRent(officeUnit.id, 1), "a rent step");
      expect(Number.isFinite(slot("stepRent", rent, "rent"))).toBe(true);

      // No room is infested on a new tower.
      const exterminator = run(s, (p) => p.bookExterminator(), "the exterminator");
      expect(done(exterminator)).toBe(false);
      expect(["unavailable", "pending", "none", "funds"]).toContain(reasonOf(exterminator));

      must(s, (p) => p.labelUnit(officeUnit.id, "Contract Office"), "a label");
      expect(reader.tower.getUnit(officeUnit.id)?.label).toBe("Contract Office");

      expect(Math.sign(delta(must(s, (p) => p.changeCars(shaft.id, false), "a car off")))).toBe(1);
      expect(Math.sign(delta(must(s, (p) => p.demolish(officeUnit.id, false), "the office sold")))).toBe(1);
      expect(reader.tower.getUnit(officeUnit.id)).toBeUndefined();
    });

    it("carries each command's arguments to the engine, as its save and events show", () => {
      const s = subject(make);
      const mid = lobbyCenter(s);
      for (const floor of [2, 3]) for (let x = mid + 5; x < mid + 16; x++) must(s, (p) => p.buildAt(kind("floor"), floor, x), `floor ${floor} at ${x}`);
      must(s, (p) => p.buildShaft(kind("elevatorStandard"), mid + 8, 1, 3), "shaft");
      const shaft = mustFind(s.reader.tower.transports, (t) => t.kind === "elevatorStandard").id;
      const savedShaft = () => mustFind(saved(s).transports, (t) => t.id === shaft);

      must(s, (p) => p.markStop(shaft, 2, false), "skip floor 2");
      expect(savedShaft().skipFloors).toEqual([2]);
      must(s, (p) => p.markStop(shaft, 2, true), "serve floor 2");
      expect(savedShaft().skipFloors ?? []).toEqual([]);

      must(s, (p) => p.scheduleShaft(shaft, scheduleSlots({ waitingCarResponse: 7 })), "a schedule");
      expect(savedShaft().schedule).toMatchObject({ waitingCarResponse: 7 });

      must(s, (p) => p.logLine("Contract notice", logKind("good")), "a bulletin");
      expect(saved(s).log?.find((e) => e.text === "Contract notice")?.kind).toBe("good");

      // Sell and the bulldozer refund the same; the method shows in the event.
      must(s, (p) => p.buildAt(kind("office"), 2, mid - 4), "office on 2");
      must(s, (p) => p.buildAt(kind("office"), 3, mid - 4), "office on 3");
      const offices = s.reader.tower.units.filter((u) => u.kind === "office");
      drain(s.port);
      must(s, (p) => p.demolish(offices[0].id, true), "bulldoze");
      must(s, (p) => p.demolish(offices[1].id, false), "sell");
      s.port.tick(1);
      expect(drain(s.port).filter((e) => e.name === "facility_removed").map((e) => e.payload)).toEqual([
        { kind: "office", method: "bulldoze" },
        { kind: "office", method: "sell" },
      ]);
    });

    it("lists the rooms, and the structure as runs, each kept until the revision moves", () => {
      const s = subject(make);
      const { reader } = s;
      const mid = lobbyCenter(s);
      // Bridging off (a Modern tower's choice), so the gap at `mid + 10`
      // stays open until the case builds it.
      expect(slot("chooseAutoBridge", must(s, (p) => p.chooseAutoBridge(false), "bridging off"), "value")).toBe(0);
      for (let x = mid + 5; x < mid + 16; x++) if (x !== mid + 10) must(s, (p) => p.buildAt(kind("floor"), 2, x), `floor at ${x}`);
      expect(runsOn(reader, 2)).toEqual([
        ["floor", mid + 5, 1, 5],
        ["floor", mid + 11, 1, 5],
      ]);
      // The office lays floor under its own nine cells, `mid - 4` to `mid + 4`.
      must(s, (p) => p.buildAt(kind("office"), 2, mid - 4), "office");
      expectRoomsAndStructure(reader);
      const office = mustFind(reader.rooms, (u) => u.kind === "office").id;
      expect(runsOn(reader, 2)).toEqual([
        ["floor", mid - 4, 1, 14],
        ["floor", mid + 11, 1, 5],
      ]);

      const [rooms, structure, revision] = [reader.rooms, reader.structure, reader.header.revision];
      s.port.tick(1);
      must(s, (p) => p.labelUnit(office, "Kept"), "a label");
      expect(reader.header.revision, "a tick and a label move no revision").toBe(revision);
      expect(reader.rooms === rooms && reader.structure === structure, "the same arrays while the revision holds").toBe(true);
      expect(mustFind(reader.rooms, (u) => u.id === office).label, "a kept entry reads current").toBe("Kept");

      must(s, (p) => p.buildAt(kind("floor"), 2, mid + 10), "the gap");
      expect(reader.header.revision).toBeGreaterThan(revision);
      expect(runsOn(reader, 2)).toEqual([["floor", mid - 4, 1, 20]]);
      // A tile that joins the run on its right as well as the one on its left.
      for (const x of [mid + 5, mid + 7]) must(s, (p) => p.buildAt(kind("floor"), 3, x), `floor 3 at ${x}`);
      expect(runsOn(reader, 3)).toEqual([
        ["floor", mid + 5, 1, 1],
        ["floor", mid + 7, 1, 1],
      ]);
      must(s, (p) => p.buildAt(kind("floor"), 3, mid + 6), "the joining tile");
      expect(runsOn(reader, 3)).toEqual([["floor", mid + 5, 1, 3]]);
      expectRoomsAndStructure(reader);

      must(s, (p) => p.demolish(office, false), "the office sold");
      expect(reader.rooms.some((u) => u.id === office)).toBe(false);
      expectRoomsAndStructure(reader);
    });

    it("quotes a build, and refuses the build once the cell is taken", () => {
      const s = subject(make);
      const mid = lobbyCenter(s);
      const free = s.port.quoteBuild(kind("office"), 2, mid - 4);
      expect(slot("quoteBuild", free, "ok")).toBe(1);
      expect(slot("quoteBuild", free, "cost")).toBeGreaterThan(0);
      must(s, (p) => p.buildAt(kind("office"), 2, mid - 4), "office");
      expect(slot("quoteBuild", s.port.quoteBuild(kind("office"), 2, mid - 4), "ok")).toBe(0);
      expect(typeof s.port.lastReason()).toBe("string");
      expect([s.reader.unlocked("office"), s.reader.unlocked("hotelSingle")]).toEqual([true, false]);
    });

    it("writes the tower's save as engine-format JSON", () => {
      const s = subject(make);
      const save = saved(s);
      expect(typeof save.version).toBe("number");
      expect(save.money).toBe(s.reader.header.money);
    });

    it("drains each gameplay event once, oldest first", () => {
      const s = subject(make);
      const mid = lobbyCenter(s);
      drain(s.port);
      must(s, (p) => p.buildAt(kind("office"), 2, mid - 4), "office on 2");
      must(s, (p) => p.buildAt(kind("office"), 3, mid - 4), "office on 3");
      s.port.tick(1);
      expect(drain(s.port).filter((e) => e.name === "facility_placed").map((e) => e.payload)).toEqual([
        { kind: "office", floor: 2, count: 1 },
        { kind: "office", floor: 3, count: 1 },
      ]);
      expect(drain(s.port)).toEqual([]);
    });

    it("answers the stop presets, the rent tools, the subtype and the tower settings", () => {
      const s = subject(make);
      const t = furnish(s);
      const { reader } = s;
      const rent = () => mustFind(saved(s).units, (u) => u.id === t.office).rent;
      const priced = must(s, (p) => p.setRent(t.office, rent() === 3000 ? 3500 : 3000), "a price");
      expect(delta(priced)).toBe(0);
      expect(rent()).toBe(slot("setRent", priced, "rent"));

      const batch = must(s, (p) => p.rentBatch(kind("office"), NaN, false), "a rent batch");
      expect(["matched", "eligible", "changed"].map((n) => slot("rentBatch", batch, n))).toEqual([1, 1, 1]);
      expect(rent()).not.toBe(slot("setRent", priced, "rent"));

      const subtype = reader.tower.getUnit(t.fastFood)?.subtype;
      must(s, (p) => p.rerollUnit(t.fastFood), "a reroll");
      expect(reader.tower.getUnit(t.fastFood)?.subtype).not.toBe(subtype);
      expect(s.port.unitSubtype(t.fastFood)).toBe(reader.tower.getUnit(t.fastFood)?.subtype);

      must(s, (p) => p.expressStops(t.shaft), "express stops");
      expect(reader.tower.getTransport(t.shaft)?.skipFloors).toEqual([2]);
      must(s, (p) => p.dropStops(t.shaft), "the stops cleared");
      expect(reader.tower.getTransport(t.shaft)?.skipFloors ?? []).toEqual([]);
      // An endpoint always stops: skipping it is answered as done and
      // changes nothing, so the undo history records no step for it.
      const unskipped = s.port.serialize();
      expect(delta(must(s, (p) => p.markStop(t.shaft, 3, false), "skip an endpoint"))).toBe(0);
      expect(s.port.serialize()).toBe(unskipped);

      expect(slot("flipAutoBridge", must(s, (p) => p.flipAutoBridge(), "bridging flipped"), "value")).toBe(0);
      expect(saved(s).autoBridge).toBe(false);
      expect(slot("chooseAutoBridge", must(s, (p) => p.chooseAutoBridge(true), "bridging on"), "value")).toBe(1);
      expect(saved(s).autoBridge ?? true).toBe(true);

      must(s, (p) => p.nameTower("Contract Tower"), "a name");
      expect(saved(s).towerName).toBe("Contract Tower");
      // Half of an emoji's surrogate pair is kept as U+FFFD.
      must(s, (p) => p.nameTower("Tower \uD83C"), "a broken name");
      expect(saved(s).towerName).toBe("Tower �");
      must(s, (p) => p.logLine("Bulletin \uDF06", logKind("info")), "a broken bulletin");
      const log = saved(s).log ?? [];
      expect(log[log.length - 1]?.text).toBe("Bulletin �");

      must(s, (p) => p.setCamera(t.mid, 3, 2), "a camera");
      expect(saved(s).view).toEqual({ tile: t.mid, floor: 3, zoom: 2 });
      must(s, (p) => p.setCamera(t.mid, 2, NaN), "a camera with no zoom");
      expect(saved(s).view).toEqual({ tile: t.mid, floor: 2 });
    });

    it("refuses each command it cannot run, and moves nothing", () => {
      const s = subject(make);
      const t = furnish(s);
      const refusals: [string, (p: Subject["port"]) => Float64Array, string?][] = [
        ["a taken cell", (p) => p.buildAt(kind("office"), 2, t.mid - 4), "string"],
        ["a brush in the air", (p) => p.paintTiles(kind("floor"), 9, Float64Array.of(t.mid, t.mid + 1)), "string"],
        ["a brush on built floor", (p) => p.paintTiles(kind("floor"), 2, Float64Array.of(t.mid + 6, t.mid + 7))],
        ["a shaft through rooms", (p) => p.buildShaft(kind("elevatorStandard"), t.mid - 4, 1, 6), "string"],
        ["no such room", (p) => p.demolish(-1, false), "string"],
        ["extend a room", (p) => p.startExtend(t.office)],
        ["extend past the lot", (p) => p.extendShaft(t.shaft, false, -40), "string"],
        ["a car on a room", (p) => p.changeCars(t.office, true), "string"],
        ["the last car off", (p) => p.changeCars(t.shaft, false), "string"],
        ["a stop off the shaft", (p) => p.markStop(t.shaft, 7, false)],
        ["express on a room", (p) => p.expressStops(t.office)],
        ["clear no shaft", (p) => p.dropStops(-1)],
        ["schedule a room", (p) => p.scheduleShaft(t.office, scheduleSlots({}))],
        ["label nobody", (p) => p.labelUnit(-1, "Nobody")],
        ["rent on a shaft", (p) => p.stepRent(t.shaft, 1)],
        ["No Rate on Modern", (p) => p.noRate(t.office)],
        ["price nobody", (p) => p.setRent(-1, 3000)],
        ["batch floor tiles", (p) => p.rentBatch(kind("floor"), NaN, false)],
        ["a film for an office", (p) => p.setFilm(t.office, 1)],
        ["reroll an office", (p) => p.rerollUnit(t.office)],
        ["the exterminator, with nothing to treat", (p) => p.bookExterminator(), "none"],
        ["an answer with no emergency", (p) => p.answerChoice(true)],
      ];
      for (const [label, call, want] of refusals) {
        const rec = expectUnmoved(s, call, label);
        if (want === "string") expect(typeof reasonOf(rec), label).toBe("string");
        else if (want !== undefined) expect(reasonOf(rec), label).toBe(want);
      }
      const extend = s.port.extendShaft(t.shaft, false, -40);
      expect(["bottom", "top", "added"].map((n) => slot("extendShaft", extend, n))).toEqual([1, 3, 0]);
    });

    it("refuses malformed arguments with a reason, without a throw, and moves nothing", () => {
      const s = subject(make);
      const t = furnish(s);
      const malformed: [string, (p: Subject["port"]) => Float64Array][] = [
        ["no such kind", (p) => p.buildAt(999, 4, t.mid)],
        ["a negative kind", (p) => p.buildAt(-1, 4, t.mid)],
        ["a NaN kind", (p) => p.buildAt(NaN, 4, t.mid)],
        ["a NaN floor", (p) => p.buildAt(kind("office"), NaN, t.mid - 4)],
        ["a fractional tile", (p) => p.buildAt(kind("office"), 2, t.mid + 0.5)],
        ["a tile past 32 bits", (p) => p.buildAt(kind("office"), 2, 2 ** 31)],
        ["a fractional brush tile", (p) => p.paintTiles(kind("floor"), 4, Float64Array.of(t.mid, 1.5))],
        ["a NaN brush tile", (p) => p.paintTiles(kind("floor"), 4, Float64Array.of(NaN))],
        ["a room kind as a shaft", (p) => p.buildShaft(kind("office"), t.mid + 14, 1, 3)],
        ["a NaN stop", (p) => p.markStop(t.shaft, NaN, false)],
        ["a NaN rent", (p) => p.setRent(t.office, NaN)],
      ];
      for (const [label, call] of malformed) {
        const rec = expectUnmoved(s, call, label);
        expect(typeof reasonOf(rec), label).toBe("string");
      }
    });
  });

  describe(`${name}: the engine port's brush`, () => {
    it("lays a brush as the same builds issued one by one: the tiles, the charge and the events", () => {
      const brushed = subject(make);
      const oneByOne = subject(make);
      const mid = lobbyCenter(brushed);
      const right = lobbyRight(brushed, mid);
      // Two tiles over the lobby and two past its end, where floor 2 has
      // nothing to stand on: the brush lays two. A brush that lays a tile is
      // done, so like any done command it gives no refusal text.
      const tiles = [right - 2, right - 1, right, right + 1];
      drain(brushed.port);
      drain(oneByOne.port);
      const brush = run(brushed, (p) => p.paintTiles(kind("floor"), 2, Float64Array.from(tiles)), "the brush");
      const builds = tiles.map((x) => run(oneByOne, (p) => p.buildAt(kind("floor"), 2, x), `floor at ${x}`));
      expect(slot("paintTiles", brush, "placed")).toBe(2);
      expect(done(brush)).toBe(true);
      expect(builds.map(done)).toEqual([true, true, false, false]);
      expect(reasonOf(brush)).toBeUndefined();
      expect(delta(brush)).toBe(builds.reduce((sum, b) => sum + delta(b), 0));
      expect(drain(brushed.port)).toEqual(drain(oneByOne.port));
      expect(brushed.port.serialize()).toBe(oneByOne.port.serialize());
      for (const x of tiles.slice(0, 2)) expect(brushed.reader.tower.structureKindAt(2, x)).toBe("floor");
    });

    it("lays a lobby brush on the ground floor", () => {
      const s = subject(make);
      const right = lobbyRight(s, lobbyCenter(s));
      const tiles = [right, right + 1, right + 2];
      const laid = must(s, (p) => p.paintTiles(kind("lobby"), 1, Float64Array.from(tiles)), "the lobby brush");
      expect(slot("paintTiles", laid, "placed")).toBe(3);
      expect(delta(laid)).toBeLessThan(0);
      for (const x of tiles) expect(s.reader.tower.structureKindAt(1, x)).toBe("lobby");
    });

    it("repeats its passes while one lays a tile, and lays a repeated column once", () => {
      const brushed = subject(make);
      const oneByOne = subject(make);
      const right = lobbyRight(brushed, lobbyCenter(brushed));
      for (const s of [brushed, oneByOne]) must(s, (p) => p.chooseAutoBridge(false), "bridging off");
      drain(brushed.port);
      drain(oneByOne.port);
      // Without bridging, a lobby tile must touch the tower: each pass lays
      // the one tile next to the last, so three passes lay all three.
      const lobby = run(brushed, (p) => p.paintTiles(kind("lobby"), 1, Float64Array.of(right + 2, right + 1, right)), "the lobby brush");
      const passes = [right + 2, right + 1, right, right + 2, right + 1, right + 2];
      const builds = passes.map((x) => run(oneByOne, (p) => p.buildAt(kind("lobby"), 1, x), `lobby at ${x}`));
      expect(builds.map(done)).toEqual([false, false, true, false, true, true]);
      expect([done(lobby), slot("paintTiles", lobby, "placed")]).toEqual([true, 3]);
      expect(delta(lobby)).toBe(builds.reduce((sum, b) => sum + delta(b), 0));

      const floor = must(brushed, (p) => p.paintTiles(kind("floor"), 2, Float64Array.of(right - 1, right - 1, right - 2)), "the floor brush");
      const single = [right - 1, right - 2].map((x) => must(oneByOne, (p) => p.buildAt(kind("floor"), 2, x), `floor at ${x}`));
      expect([slot("paintTiles", floor, "placed"), delta(floor)]).toEqual([2, delta(single[0]) + delta(single[1])]);
      expect(drain(brushed.port)).toEqual(drain(oneByOne.port));
      expect(brushed.port.serialize()).toBe(oneByOne.port.serialize());
    });

    // A lobby over plain floor takes the tile's place in the unit list, and
    // the save, which keeps that order, must match the builds one by one.
    it("upgrades plain floor to a sky lobby as the same builds issued one by one do", () => {
      const brushed = subject(make);
      const oneByOne = subject(make);
      const right = lobbyRight(brushed, lobbyCenter(brushed));
      const column = Float64Array.of(right - 4, right - 3, right - 2, right - 1);
      for (const s of [brushed, oneByOne]) {
        for (let floor = 2; floor <= 15; floor++) expect(slot("paintTiles", must(s, (p) => p.paintTiles(kind("floor"), floor, column), `floor ${floor}`), "placed")).toBe(4);
        drain(s.port);
      }
      // Two tiles of plain floor, then one with nothing under it, refused on
      // both passes.
      const tiles = [right - 2, right - 4, right];
      const lobby = run(brushed, (p) => p.paintTiles(kind("lobby"), 15, Float64Array.from(tiles)), "the sky lobby brush");
      const builds = [...tiles, right].map((x) => run(oneByOne, (p) => p.buildAt(kind("lobby"), 15, x), `lobby at ${x}`));
      expect(builds.map(done)).toEqual([true, true, false, false]);
      expect([done(lobby), slot("paintTiles", lobby, "placed")]).toEqual([true, 2]);
      expect(delta(lobby)).toBe(builds.reduce((sum, b) => sum + delta(b), 0));
      for (const x of [right - 2, right - 4]) expect(brushed.reader.tower.structureKindAt(15, x)).toBe("lobby");
      expect(brushed.reader.tower.structureKindAt(15, right - 3)).toBe("floor");
      expect(drain(brushed.port)).toEqual(drain(oneByOne.port));
      expect(brushed.port.serialize()).toBe(oneByOne.port.serialize());
    });
  });
}

/** Floor `floor`'s runs as `[kind, x, width, count]`. */
function runsOn(view: SimView, floor: number): [string, number, number, number][] {
  return view.structure.filter((r) => r.floor === floor).map((r) => [r.kind, r.x, r.width, r.count]);
}

/** Check `rooms` against the tower's units and `structure` against
 *  `structureKindAt` over every cell of every floor: `rooms` is every unit
 *  but the tiles, in `units` order; the runs cover each structure cell once,
 *  in order of floor and then x, and no two could join. */
function expectRoomsAndStructure(view: SimView): void {
  const { tower } = view;
  const isRoom = (k: string) => k !== "floor" && k !== "lobby";
  expect(view.rooms.map((u) => u.id)).toEqual(tower.units.filter((u) => isRoom(u.kind)).map((u) => u.id));
  const covered = new Map<string, string>();
  const twice: string[] = [];
  for (const r of view.structure) {
    for (let cell = r.x; cell < r.x + r.count * r.width; cell++) {
      const key = `${r.floor}:${cell}`;
      if (covered.has(key)) twice.push(key);
      covered.set(key, r.kind);
    }
  }
  expect(twice, "cells in two runs").toEqual([]);
  const scanned = new Map<string, string>();
  for (let floor = tower.lowestFloor; floor <= tower.highestFloor; floor++) {
    for (let x = 0; x < LOT_WIDTH; x++) {
      const k = tower.structureKindAt(floor, x);
      if (k) scanned.set(`${floor}:${x}`, k);
    }
  }
  expect(covered).toEqual(scanned);
  const runs = view.structure;
  for (let i = 1; i < runs.length; i++) {
    const [a, b] = [runs[i - 1], runs[i]];
    const end = a.x + a.count * a.width;
    expect(a.floor < b.floor || (a.floor === b.floor && end <= b.x), `runs ${i - 1} and ${i} in order`).toBe(true);
    expect(a.floor === b.floor && a.kind === b.kind && a.width === b.width && end === b.x, `runs ${i - 1} and ${i} would join`).toBe(false);
  }
}

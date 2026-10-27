import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Command, CommandResult } from "./commands";
import type { SimPort } from "./port";
import type { SimView } from "./view";

/**
 * The port's contract, run over any adapter: `TsSim` now, `RustSim` from
 * slice 7. `makePort` returns a port on a freshly founded Modern tower that
 * stands on its starter lobby (a ground-floor strip of lobby tiles), and the
 * suite builds the rest through the port alone, asserting each step, so the
 * same session runs on either engine.
 *
 * Each case ticks once before its first command and once after its last, so
 * the `unitWasm` parity project's Rust host, which attaches at the first tick
 * and compares the two engines around each one, sees every command here.
 * Before a tower has people, that setup restarts the engine from the
 * instance's save when the two disagree, so a caller on that project passes
 * `restarts` (`parityRestarts` in `src/tests/parity/typescriptOnly.ts`) and
 * each case fails if it moved.
 */
export function describePortContract(name: string, makePort: () => SimPort, opts: { restarts?: () => number | undefined } = {}): void {
  describe(`${name}: the SimPort contract`, () => {
    let restartsBefore: number | undefined;
    beforeEach(() => {
      restartsBefore = opts.restarts?.();
    });
    afterEach(() => {
      expect(opts.restarts?.(), "the engines disagreed on a command, and the parity setup restarted the engine").toBe(restartsBefore);
    });

    it("runs a scripted session, answering in the documented shapes, with each effect on the view", async () => {
      const port = start(makePort);
      const { view } = port;
      const mid = lobbyCenter(port);
      const send = sender(port);
      const before = view.header;

      const office = await send({ op: "build", kind: "office", floor: 2, x: mid - 4 });
      expect(office).toMatchObject({ ok: true });
      expect(office.delta).toBeLessThan(0);
      expect(view.header.revision).toBeGreaterThan(before.revision);
      const officeUnit = mustFind(view.tower.units, (u) => u.kind === "office" && u.floor === 2);
      expect(view.tower.unitAt(2, mid - 4)?.id).toBe(officeUnit.id);

      for (const floor of [2, 3]) {
        for (let x = mid + 5; x < mid + 16; x++) expect(await send({ op: "build", kind: "floor", floor, x }), `floor ${floor} at ${x}`).toMatchObject({ ok: true });
      }
      expect(view.tower.structureKindAt(3, mid + 8)).toBe("floor");

      const shaft = await expectRevision(port, async () => {
        expect(await send({ op: "buildTransport", kind: "elevatorStandard", x: mid + 8, bottom: 1, top: 2 })).toMatchObject({ ok: true });
        return mustFind(view.tower.transports, (t) => t.kind === "elevatorStandard");
      });
      expect([shaft.bottom, shaft.top, shaft.cars]).toEqual([1, 2, 1]);
      expect(view.tower.getTransport(shaft.id)?.id).toBe(shaft.id);

      const minutes = view.header.minutes;
      for (let i = 0; i < 5; i++) port.tick(1);
      expect(view.header.minutes).toBeGreaterThan(minutes);

      await expectRevision(port, () => expectCharge(send({ op: "addCar", id: shaft.id }), -1));
      expect(view.tower.getTransport(shaft.id)?.cars).toBe(2);

      expect(await send({ op: "beginExtend", id: shaft.id })).toMatchObject({ ok: true });
      const extend = await expectRevision(port, () => expectCharge(send({ op: "extendTransport", id: shaft.id, end: "up", targetFloor: 3 }), -1));
      expect([extend.bottom, extend.top, extend.added]).toEqual([1, 3, 1]);
      expect(await send({ op: "endExtend" })).toMatchObject({ ok: true });
      expect(view.tower.getTransport(shaft.id)?.top).toBe(3);

      const rent = await send({ op: "adjustRent", id: officeUnit.id, dir: 1 });
      expect(rent.ok).toBe(true);
      expect(typeof rent.rent).toBe("number");

      // No room is infested on a new tower; `TsSim`'s own test books one.
      const exterminator = await send({ op: "callExterminator" });
      if (exterminator.ok) {
        expect(typeof exterminator.cost).toBe("number");
        expect(typeof exterminator.rooms).toBe("number");
      } else {
        expect(["unavailable", "pending", "none", "funds"]).toContain(exterminator.reason);
      }

      expect(await send({ op: "setLabel", id: officeUnit.id, label: "Contract Office" })).toMatchObject({ ok: true });
      expect(view.tower.getUnit(officeUnit.id)?.label).toBe("Contract Office");

      await expectRevision(port, () => expectCharge(send({ op: "removeCar", id: shaft.id }), 1));
      await expectRevision(port, () => expectCharge(send({ op: "removeFacility", id: officeUnit.id, method: "sell" }), 1));
      expect(view.tower.getUnit(officeUnit.id)).toBeUndefined();
      port.tick(1);
    });

    it("carries each command's arguments to the engine, as its save and events show", async () => {
      const port = start(makePort);
      const mid = lobbyCenter(port);
      const send = sender(port);
      for (const floor of [2, 3]) {
        for (let x = mid + 5; x < mid + 16; x++) expect(await send({ op: "build", kind: "floor", floor, x }), `floor ${floor} at ${x}`).toMatchObject({ ok: true });
      }
      expect(await send({ op: "buildTransport", kind: "elevatorStandard", x: mid + 8, bottom: 1, top: 3 })).toMatchObject({ ok: true });
      const shaft = mustFind(port.view.tower.transports, (t) => t.kind === "elevatorStandard").id;
      const saved = async () => JSON.parse(await port.save()) as SavedTower;
      const savedShaft = async () => mustFind((await saved()).transports, (t) => t.id === shaft);

      expect(await send({ op: "setStop", id: shaft, floor: 2, stop: false })).toMatchObject({ ok: true });
      expect((await savedShaft()).skipFloors).toEqual([2]);
      expect(await send({ op: "setStop", id: shaft, floor: 2, stop: true })).toMatchObject({ ok: true });
      expect((await savedShaft()).skipFloors ?? []).toEqual([]);

      expect(await send({ op: "setSchedule", id: shaft, schedule: { waitingCarResponse: 7 } })).toMatchObject({ ok: true });
      expect((await savedShaft()).schedule).toMatchObject({ waitingCarResponse: 7 });

      expect(await send({ op: "emit", text: "Contract notice", kind: "good" })).toMatchObject({ ok: true });
      expect((await saved()).log?.find((e) => e.text === "Contract notice")?.kind).toBe("good");

      // Sell and the bulldozer refund the same; the method shows in the event.
      expect(await send({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
      expect(await send({ op: "build", kind: "office", floor: 3, x: mid - 4 })).toMatchObject({ ok: true });
      const offices = port.view.tower.units.filter((u) => u.kind === "office");
      port.drainEvents({ release: true });
      expect(await send({ op: "removeFacility", id: offices[0].id, method: "bulldoze" })).toMatchObject({ ok: true });
      expect(await send({ op: "removeFacility", id: offices[1].id, method: "sell" })).toMatchObject({ ok: true });
      port.tick(1);
      const removed = port.drainEvents({ release: true }).filter((e) => e.name === "facility_removed");
      expect(removed.map((e) => e.payload)).toEqual([
        { kind: "office", method: "bulldoze" },
        { kind: "office", method: "sell" },
      ]);
    });

    it("lists the rooms, and the structure as runs, each kept until the revision moves", async () => {
      const port = start(makePort);
      const { view } = port;
      const mid = lobbyCenter(port);
      const send = sender(port);
      // Bridging off (the founded tower is Modern, where it is the player's
      // choice), so the gap at `mid + 10` stays open until the case builds it.
      expect(await send({ op: "setAutoBridge", value: false })).toMatchObject({ ok: true, value: false });
      for (let x = mid + 5; x < mid + 16; x++) {
        if (x !== mid + 10) expect(await send({ op: "build", kind: "floor", floor: 2, x }), `floor at ${x}`).toMatchObject({ ok: true });
      }
      expect(runsOn(view, 2)).toEqual([
        ["floor", mid + 5, 1, 5],
        ["floor", mid + 11, 1, 5],
      ]);
      // The office lays floor under its own nine cells, `mid - 4` to `mid + 4`.
      expect(await send({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
      expectRoomsAndStructure(view);
      const office = mustFind(view.rooms, (u) => u.kind === "office").id;
      expect(runsOn(view, 2)).toEqual([
        ["floor", mid - 4, 1, 14],
        ["floor", mid + 11, 1, 5],
      ]);

      const [rooms, structure, revision] = [view.rooms, view.structure, view.header.revision];
      port.tick(1);
      expect(await send({ op: "setLabel", id: office, label: "Kept" })).toMatchObject({ ok: true });
      expect(view.header.revision, "a tick and a label move no revision").toBe(revision);
      expect(view.rooms === rooms && view.structure === structure, "the same arrays while the revision holds").toBe(true);
      expect(mustFind(view.rooms, (u) => u.id === office).label, "a kept entry reads current").toBe("Kept");
      expect(view.tower.getUnit(office)?.label).toBe("Kept");

      await expectRevision(port, () => send({ op: "build", kind: "floor", floor: 2, x: mid + 10 }));
      expect(runsOn(view, 2)).toEqual([["floor", mid - 4, 1, 20]]);
      // A tile that joins the run on its right as well as the one on its left.
      for (const x of [mid + 5, mid + 7]) expect(await send({ op: "build", kind: "floor", floor: 3, x }), `floor 3 at ${x}`).toMatchObject({ ok: true });
      expect(runsOn(view, 3)).toEqual([
        ["floor", mid + 5, 1, 1],
        ["floor", mid + 7, 1, 1],
      ]);
      expect(await send({ op: "build", kind: "floor", floor: 3, x: mid + 6 })).toMatchObject({ ok: true });
      expect(runsOn(view, 3)).toEqual([["floor", mid + 5, 1, 3]]);
      expectRoomsAndStructure(view);

      await expectRevision(port, () => send({ op: "removeFacility", id: office, method: "sell" }));
      expect(view.rooms.some((u) => u.id === office)).toBe(false);
      expectRoomsAndStructure(view);
      port.tick(1);
    });

    it("refuses a command it cannot run with ok false, and moves no money", async () => {
      const port = start(makePort);
      const money = port.view.header.money;
      const result = await port.command({ op: "addCar", id: -1 });
      expect(result.ok).toBe(false);
      expect(typeof result.reason).toBe("string");
      expect(result.delta).toBe(0);
      expect(port.view.header.money).toBe(money);
      port.tick(1);
    });

    it("runs commands, queries and saves issued back to back in issue order", async () => {
      const port = start(makePort);
      const mid = lobbyCenter(port);
      expect(await port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
      const id = mustFind(port.view.tower.units, (u) => u.kind === "office").id;
      // On a synchronous adapter the promises settle in registration order
      // whatever ran first, so `settled` binds an asynchronous adapter only;
      // the label, the answer and the save bind both.
      const settled: string[] = [];
      const first = port.command({ op: "setLabel", id, label: "First" }).then(() => settled.push("First"));
      const second = port.command({ op: "setLabel", id, label: "Second" }).then(() => settled.push("Second"));
      const build = port.command({ op: "build", kind: "office", floor: 2, x: mid + 6 });
      const answer = port.query({ op: "canBuild", kind: "office", floor: 2, x: mid + 6 });
      const save = port.save();
      await Promise.all([first, second]);
      expect(settled).toEqual(["First", "Second"]);
      expect(port.view.tower.getUnit(id)?.label).toBe("Second");
      expect(await build).toMatchObject({ ok: true });
      expect((await answer).ok).toBe(false);
      const saved = JSON.parse(await save) as { units: { kind: string; x: number; label?: string }[] };
      const offices = saved.units.filter((u) => u.kind === "office");
      expect(offices.map((u) => u.x).sort((a, b) => a - b)).toEqual([mid - 4, mid + 6]);
      expect(JSON.stringify(saved)).toContain('"Second"');
      port.tick(1);
    });

    it("answers queries, and cached returns the last answer to an equal query", async () => {
      const port = start(makePort);
      const mid = lobbyCenter(port);
      const free = { op: "canBuild", kind: "office", floor: 2, x: mid - 4 } as const;
      expect(port.cached(free)).toBeUndefined();
      const answer = await port.query(free);
      expect(answer).toMatchObject({ ok: true });
      expect(answer.cost).toBeGreaterThan(0);
      expect(port.cached({ x: mid - 4, floor: 2, kind: "office", op: "canBuild" })).toEqual(answer);

      expect(await port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
      const taken = await port.query(free);
      expect(taken.ok).toBe(false);
      expect(typeof taken.reason).toBe("string");
      expect(port.cached(free)).toEqual(taken);

      expect(await port.query({ op: "isUnlocked", kind: "office" })).toBe(true);
      expect(await port.query({ op: "isUnlocked", kind: "hotelSingle" })).toBe(false);
      expect(port.cached({ op: "isUnlocked", kind: "hotelSingle" })).toBe(false);
      port.tick(1);
    });

    it("writes the tower's save as engine-format JSON", async () => {
      const port = start(makePort);
      const save = JSON.parse(await port.save()) as { version?: unknown; money?: unknown };
      expect(typeof save.version).toBe("number");
      expect(save.money).toBe(port.view.header.money);
      port.tick(1);
    });

    it("drains each gameplay event once, oldest first", async () => {
      const port = start(makePort);
      const mid = lobbyCenter(port);
      port.drainEvents({ release: true });
      expect(await port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
      expect(await port.command({ op: "build", kind: "office", floor: 3, x: mid - 4 })).toMatchObject({ ok: true });
      port.tick(1);
      // `release` hands over a command's events on a host that holds them
      // for its next restore point; elsewhere it changes nothing.
      const placed = port.drainEvents({ release: true }).filter((e) => e.name === "facility_placed");
      expect(placed.map((e) => e.payload)).toEqual([
        { kind: "office", floor: 2, count: 1 },
        { kind: "office", floor: 3, count: 1 },
      ]);
      expect(port.drainEvents({ release: true })).toEqual([]);
    });
  });
}

/** A port from `makePort`, ticked once so a parity host is attached before
 *  the case's first command. */
export function start(makePort: () => SimPort): SimPort {
  const port = makePort();
  port.tick(1);
  return port;
}

/** `port.command`, checking that each result's `delta` is the balance's
 *  change (nothing else runs between the command and the check). */
export function sender(port: SimPort): <C extends Command>(c: C) => Promise<CommandResult<C>> {
  return async (c) => {
    const before = port.view.header.money;
    const result = await port.command(c);
    expect(port.view.header.money - before, JSON.stringify(c)).toBe(result.delta);
    return result;
  };
}

/** The middle of the ground-floor lobby the founded tower stands on, checked
 *  to span the cells the session builds over (`mid - 4` to `mid + 15`). Read
 *  through `structureKindAt`, so the contract does not depend on `units`
 *  listing structure tiles. */
export function lobbyCenter(port: SimPort): number {
  const lobby: number[] = [];
  for (let x = 0; x < LOT_WIDTH; x++) if (port.view.tower.structureKindAt(1, x) === "lobby") lobby.push(x);
  expect(lobby.length, "the founded tower's starter lobby").toBeGreaterThan(0);
  const left = lobby[0];
  const right = lobby[lobby.length - 1] + 1;
  const mid = Math.floor((left + right) / 2);
  expect([left <= mid - 4, right >= mid + 16, right - left === lobby.length], `the starter lobby spans ${left} to ${right} in one run`).toEqual([true, true, true]);
  return mid;
}

/** Floor `floor`'s runs as `[kind, x, width, count]`. */
function runsOn(view: SimView, floor: number): [string, number, number, number][] {
  return view.structure.filter((r) => r.floor === floor).map((r) => [r.kind, r.x, r.width, r.count]);
}

/** Check `rooms` against the tower's units and `structure` against
 *  `structureKindAt` over every cell of every floor, so neither depends on
 *  `units` listing the structure tiles: `rooms` is every unit but the tiles,
 *  in `units` order; the runs cover each structure cell once, in order of
 *  floor and then x, and no two could join. */
function expectRoomsAndStructure(view: SimView): void {
  const { tower } = view;
  const isRoom = (kind: string) => kind !== "floor" && kind !== "lobby";
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
      const kind = tower.structureKindAt(floor, x);
      if (kind) scanned.set(`${floor}:${x}`, kind);
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

/** The lot's width in tiles (`GRID.width`, the 1994 map's 375 segments). */
const LOT_WIDTH = 375;

/** The parts of a save the contract reads back. */
interface SavedTower {
  transports: { id: number; skipFloors?: number[]; schedule?: Record<string, unknown> }[];
  log?: { text: string; kind: string }[];
}

export function mustFind<T>(items: ReadonlyArray<T>, match: (item: T) => boolean): T {
  const found = items.find(match);
  if (found === undefined) throw new Error("contract: expected item not found");
  return found;
}

/** Run a structural change and check it moved `header.revision`. */
async function expectRevision<T>(port: SimPort, run: () => Promise<T>): Promise<T> {
  const before = port.view.header.revision;
  const result = await run();
  expect(port.view.header.revision).toBeGreaterThan(before);
  return result;
}

/** Check a charged command applied and moved the balance in the expected
 *  direction, and return its result. */
async function expectCharge<R extends { ok: boolean; delta: number }>(pending: Promise<R>, sign: 1 | -1): Promise<R> {
  const result = await pending;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(Math.sign(result.delta)).toBe(sign);
  return result;
}

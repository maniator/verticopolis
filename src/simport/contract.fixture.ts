import { describe, expect, it } from "vitest";
import type { SimPort } from "./port";

/**
 * The port's contract, run over any adapter: `TsSim` now, `RustSim` from
 * slice 7. `makePort` returns a port on a freshly founded Modern tower that
 * stands on its starter lobby (a ground-floor strip of lobby tiles), and the
 * suite builds the rest through the port alone, asserting each step, so the
 * same session runs on either engine.
 */
export function describePortContract(name: string, makePort: () => SimPort): void {
  describe(`${name}: the SimPort contract`, () => {
    it("runs a scripted session, answering in the documented shapes, with each effect on the view", async () => {
      const port = makePort();
      const { view } = port;
      const mid = lobbyCenter(port);
      const start = view.header;

      const office = await port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 });
      expect(office).toMatchObject({ ok: true });
      expect(view.header.revision).toBeGreaterThan(start.revision);
      expect(view.header.money).toBeLessThan(start.money);
      const officeUnit = mustFind(view.tower.units, (u) => u.kind === "office" && u.floor === 2);
      expect(view.tower.unitAt(2, mid - 4)?.id).toBe(officeUnit.id);

      for (const floor of [2, 3]) {
        for (let x = mid + 5; x < mid + 16; x++) expect(await port.command({ op: "build", kind: "floor", floor, x }), `floor ${floor} at ${x}`).toMatchObject({ ok: true });
      }
      expect(view.tower.structureKindAt(3, mid + 8)).toBe("floor");

      const revision = view.header.revision;
      expect(await port.command({ op: "buildTransport", kind: "elevatorStandard", x: mid + 8, bottom: 1, top: 2 })).toMatchObject({ ok: true });
      expect(view.header.revision).toBeGreaterThan(revision);
      const shaft = mustFind(view.tower.transports, (t) => t.kind === "elevatorStandard");
      expect([shaft.bottom, shaft.top, shaft.cars]).toEqual([1, 2, 1]);
      expect(view.tower.getTransport(shaft.id)?.id).toBe(shaft.id);

      // The engine runs from here on (the parity host attaches at the first tick).
      const minutes = view.header.minutes;
      for (let i = 0; i < 5; i++) port.tick(1);
      expect(view.header.minutes).toBeGreaterThan(minutes);

      await expectCharge(port, () => port.command({ op: "addCar", id: shaft.id }), -1);
      expect(view.tower.getTransport(shaft.id)?.cars).toBe(2);

      expect(await port.command({ op: "beginExtend", id: shaft.id })).toEqual({ ok: true });
      const extend = await expectCharge(port, () => port.command({ op: "extendTransport", id: shaft.id, end: "up", targetFloor: 3 }), -1);
      expect([extend.bottom, extend.top, extend.added]).toEqual([1, 3, 1]);
      expect(await port.command({ op: "endExtend" })).toEqual({ ok: true });
      expect(view.tower.getTransport(shaft.id)?.top).toBe(3);

      const rent = await port.command({ op: "adjustRent", id: officeUnit.id, dir: 1 });
      expect(rent.ok).toBe(true);
      expect(typeof rent.rent).toBe("number");

      const exterminator = await port.command({ op: "callExterminator" });
      if (exterminator.ok) {
        expect(typeof exterminator.cost).toBe("number");
        expect(typeof exterminator.rooms).toBe("number");
      } else {
        expect(["unavailable", "pending", "none", "funds"]).toContain(exterminator.reason);
      }

      expect(await port.command({ op: "setLabel", id: officeUnit.id, label: "Contract Office" })).toEqual({ ok: true });
      expect(view.tower.getUnit(officeUnit.id)?.label).toBe("Contract Office");

      await expectCharge(port, () => port.command({ op: "removeCar", id: shaft.id }), 1);
      const beforeSale = view.header.revision;
      await expectCharge(port, () => port.command({ op: "removeFacility", id: officeUnit.id, method: "sell" }), 1);
      expect(view.header.revision).toBeGreaterThan(beforeSale);
      expect(view.tower.getUnit(officeUnit.id)).toBeUndefined();
    });

    it("refuses a command it cannot run with ok false, and moves no money", async () => {
      const port = makePort();
      const money = port.view.header.money;
      const result = await port.command({ op: "addCar", id: -1 });
      expect(result.ok).toBe(false);
      expect(typeof result.reason).toBe("string");
      expect(result.delta).toBe(0);
      expect(port.view.header.money).toBe(money);
    });

    it("applies two commands issued back to back in issue order", async () => {
      const port = makePort();
      const mid = lobbyCenter(port);
      expect(await port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
      const id = mustFind(port.view.tower.units, (u) => u.kind === "office").id;
      const settled: string[] = [];
      const first = port.command({ op: "setLabel", id, label: "First" }).then(() => settled.push("First"));
      const second = port.command({ op: "setLabel", id, label: "Second" }).then(() => settled.push("Second"));
      await Promise.all([first, second]);
      expect(settled).toEqual(["First", "Second"]);
      expect(port.view.tower.getUnit(id)?.label).toBe("Second");
    });

    it("answers queries, and cached returns the last answer to an equal query", async () => {
      const port = makePort();
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
    });

    it("writes the tower's save as engine-format JSON", async () => {
      const port = makePort();
      const save = JSON.parse(await port.save()) as { version?: unknown; money?: unknown };
      expect(typeof save.version).toBe("number");
      expect(save.money).toBe(port.view.header.money);
    });

    it("drains the gameplay events once", async () => {
      const port = makePort();
      const mid = lobbyCenter(port);
      port.drainEvents();
      expect(await port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
      port.tick(1);
      expect(Array.isArray(port.drainEvents())).toBe(true);
      expect(port.drainEvents()).toEqual([]);
    });
  });
}

/** The middle of the ground-floor lobby the founded tower stands on. */
function lobbyCenter(port: SimPort): number {
  const lobby = port.view.tower.units.filter((u) => u.kind === "lobby" && u.floor === 1);
  expect(lobby.length, "the founded tower's starter lobby").toBeGreaterThanOrEqual(30);
  const xs = lobby.map((u) => u.x);
  return Math.floor((Math.min(...xs) + Math.max(...xs) + 1) / 2);
}

function mustFind<T>(items: ReadonlyArray<T>, match: (item: T) => boolean): T {
  const found = items.find(match);
  if (found === undefined) throw new Error("contract: expected item not found");
  return found;
}

/** Run a charged command, check it applied and moved the balance by its
 *  `delta` in the expected direction, and return its result. */
async function expectCharge<R extends { ok: boolean; delta: number }>(port: SimPort, run: () => Promise<R>, sign: 1 | -1): Promise<R> {
  const before = port.view.header.money;
  const result = await run();
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(Math.sign(result.delta)).toBe(sign);
  expect(port.view.header.money - before).toBe(result.delta);
  return result;
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Command, CommandResult } from "./commands";
import { lobbyCenter, mustFind, sender, start } from "./contract.fixture";
import type { SimPort } from "./port";
import { INVALID_COMMAND } from "./request";

/**
 * The player commands' contract (facade slice 2), run over any adapter the
 * way `describePortContract` is: `TsSim` now, on both of today's hosts, and
 * `RustSim` from slice 7. `makePort` returns a port on a freshly founded
 * Modern tower standing on its starter lobby; every case builds what it needs
 * through the port alone.
 *
 * It holds each command to three things. Its accepted path answers in the
 * documented shape, `delta` is the balance's change, and the effect shows on
 * the view or in the save. A refusal moves nothing: `delta` is 0, the save is
 * unchanged and no gameplay event or log line appears. A malformed command
 * (the port's own check, `request.ts`) is refused the same way with the
 * engine's reason, and never throws. The brush lays exactly what the same
 * builds issued one by one lay, and back-to-back commands run in issue order.
 *
 * `describePortContract` already runs the accepted paths of `build`,
 * `buildTransport`, `removeFacility`, the extend gesture, the cars, `setStop`,
 * `setSchedule`, `setLabel`, `adjustRent`, `callExterminator` and `emit`.
 * Three accepted paths need a tower the port cannot found: a pending
 * emergency (`resolveChoice`), a cinema (`setFilmPolicy`, 3 stars) and a
 * Classic tower (`setNoRate`, and the auto-bridge refusals). The adapter's
 * own tests run those (`tsSimCommands.test.ts` for `TsSim`).
 *
 * Each case ticks once before its first command and once after its last, so
 * the parity project's Rust host sees every command, and `restarts` makes a
 * divergence there fail the case, as in `describePortContract`.
 */
export function describeCommandContract(name: string, makePort: () => SimPort, opts: { restarts?: () => number | undefined } = {}): void {
  describe(`${name}: the command contract`, () => {
    let restartsBefore: number | undefined;
    beforeEach(() => {
      restartsBefore = opts.restarts?.();
    });
    afterEach(() => {
      expect(opts.restarts?.(), "the engines disagreed on a command, and the parity setup restarted the engine").toBe(restartsBefore);
    });

    it("answers the brush, the stop presets, the rent tools, the subtype and the tower settings in their shapes", async () => {
      const port = start(makePort);
      const send = sender(port);
      const t = await furnish(port);
      const { view } = port;

      // The view leaves rent to the panel queries (slice 4); the save has it.
      const rent = async () => mustFind((await saved(port)).units, (u) => u.id === t.office).rent;
      const priced = await send({ op: "priceUnit", id: t.office, target: (await rent()) === 3000 ? 3500 : 3000 });
      expect(priced).toMatchObject({ ok: true, delta: 0 });
      expect(await rent()).toBe(priced.rent);

      const batch = await send({ op: "applyRentBatch", kind: "office", target: "default" });
      expect(batch.ok).toBe(true);
      expect(batch.batch).toMatchObject({ matched: 1, eligible: 1, changed: 1 });
      expect(await rent()).not.toBe(priced.rent);

      const subtype = view.tower.getUnit(t.fastFood)?.subtype;
      const reroll = await send({ op: "rerollSubtype", id: t.fastFood });
      expect(reroll.ok).toBe(true);
      expect(typeof reroll.subtype).toBe("string");
      expect(reroll.subtype).not.toBe(subtype);
      expect(view.tower.getUnit(t.fastFood)?.subtype).toBe(reroll.subtype);

      expect(await send({ op: "setExpressStops", id: t.shaft })).toMatchObject({ ok: true });
      expect(view.tower.getTransport(t.shaft)?.skipFloors).toEqual([2]);
      expect(await send({ op: "clearStops", id: t.shaft })).toMatchObject({ ok: true });
      expect(view.tower.getTransport(t.shaft)?.skipFloors ?? []).toEqual([]);

      const off = await send({ op: "toggleAutoBridge" });
      expect(off).toMatchObject({ ok: true, value: false });
      expect((await saved(port)).autoBridge).toBe(false);
      expect(await send({ op: "setAutoBridge", value: true })).toMatchObject({ ok: true, value: true });
      expect((await saved(port)).autoBridge ?? true).toBe(true);

      expect(await send({ op: "setTowerName", name: "Contract Tower" })).toMatchObject({ ok: true });
      expect((await saved(port)).towerName).toBe("Contract Tower");
      const camera = { tile: t.mid, floor: 3, zoom: 2 };
      expect(await send({ op: "setView", view: camera })).toMatchObject({ ok: true });
      expect((await saved(port)).view).toEqual(camera);
      expect(await send({ op: "setView", view: null })).toMatchObject({ ok: true });
      expect((await saved(port)).view ?? null).toBeNull();
      port.tick(1);
    });

    it("lays a brush as the same builds issued one by one: the tiles, the charge, the events and the reason", async () => {
      const brushed = start(makePort);
      const oneByOne = start(makePort);
      const mid = lobbyCenter(brushed);
      expect(lobbyCenter(oneByOne)).toBe(mid);
      const right = lobbyRight(brushed, mid);
      // Two tiles over the lobby and two past its end, where floor 2 has
      // nothing to stand on: the brush lays two and gives the last refusal.
      const tiles = [right - 2, right - 1, right, right + 1];
      brushed.drainEvents({ release: true });
      oneByOne.drainEvents({ release: true });

      const brush = await sender(brushed)({ op: "paintBrush", kind: "floor", floor: 2, tiles });
      const builds: CommandResult<{ op: "build"; kind: "floor"; floor: number; x: number }>[] = [];
      for (const x of tiles) builds.push(await sender(oneByOne)({ op: "build", kind: "floor", floor: 2, x }));

      expect(brush.placed).toBe(2);
      expect(brush.ok).toBe(true);
      expect(builds.map((b) => b.ok)).toEqual([true, true, false, false]);
      expect(brush.reason).toBe(builds[3].reason);
      expect(brush.delta).toBe(builds.reduce((sum, b) => sum + b.delta, 0));
      expect(brushed.drainEvents({ release: true })).toEqual(oneByOne.drainEvents({ release: true }));
      expect(await brushed.save()).toBe(await oneByOne.save());
      for (const x of tiles.slice(0, 2)) expect(brushed.view.tower.structureKindAt(2, x)).toBe("floor");
      brushed.tick(1);
      oneByOne.tick(1);
    });

    it("lays a lobby brush on the ground floor, and a brush issued before a step lands whole before it", async () => {
      const sequenced = start(makePort);
      const queued = start(makePort);
      const mid = lobbyCenter(sequenced);
      const right = lobbyRight(sequenced, mid);
      const tiles = [right, right + 1, right + 2];

      const laid = await sender(sequenced)({ op: "paintBrush", kind: "lobby", floor: 1, tiles });
      expect(laid).toMatchObject({ ok: true, placed: 3 });
      expect(laid.delta).toBeLessThan(0);
      sequenced.tick(1);

      // Not awaited: the step is issued while the brush is still queued.
      const pending = queued.command({ op: "paintBrush", kind: "lobby", floor: 1, tiles });
      queued.tick(1);
      expect(await pending).toEqual(laid);
      expect(await queued.save()).toBe(await sequenced.save());
      for (const x of tiles) expect(queued.view.tower.structureKindAt(1, x)).toBe("lobby");
    });

    it("refuses each command it cannot run, and moves nothing", async () => {
      const port = start(makePort);
      const t = await furnish(port);
      const refusals: Array<[Command, { reason?: "string" | string; extra?: Record<string, unknown> }]> = [
        [{ op: "build", kind: "office", floor: 2, x: t.mid - 4 }, { reason: "string" }],
        [{ op: "paintBrush", kind: "floor", floor: 9, tiles: [t.mid, t.mid + 1] }, { reason: "string", extra: { placed: 0 } }],
        [{ op: "paintBrush", kind: "floor", floor: 2, tiles: [t.mid + 6, t.mid + 7] }, { extra: { placed: 0 } }],
        [{ op: "buildTransport", kind: "elevatorStandard", x: t.mid - 4, bottom: 1, top: 6 }, { reason: "string" }],
        [{ op: "removeFacility", id: -1, method: "sell" }, { reason: "string" }],
        [{ op: "beginExtend", id: t.office }, {}],
        [{ op: "extendTransport", id: t.shaft, end: "down", targetFloor: -40 }, { reason: "string", extra: { bottom: 1, top: 3, added: 0 } }],
        [{ op: "addCar", id: t.office }, { reason: "string" }],
        [{ op: "removeCar", id: t.shaft }, { reason: "string" }],
        [{ op: "setStop", id: t.shaft, floor: 7, stop: false }, {}],
        [{ op: "setExpressStops", id: t.office }, {}],
        [{ op: "clearStops", id: -1 }, {}],
        [{ op: "setSchedule", id: t.office, schedule: {} }, {}],
        [{ op: "setLabel", id: -1, label: "Nobody" }, {}],
        [{ op: "adjustRent", id: t.shaft, dir: 1 }, {}],
        [{ op: "setNoRate", id: t.office }, {}],
        [{ op: "priceUnit", id: -1, target: 3000 }, {}],
        [{ op: "applyRentBatch", kind: "floor", target: "default" }, {}],
        [{ op: "setFilmPolicy", id: t.office, policy: "feature" }, {}],
        [{ op: "rerollSubtype", id: t.office }, {}],
        [{ op: "callExterminator" }, { reason: "none" }],
        [{ op: "resolveChoice", accept: true }, {}],
      ];
      for (const [command, want] of refusals) {
        const result = await expectUnmoved(port, command);
        const label = JSON.stringify(command);
        if (want.reason === "string") expect(typeof result.reason, label).toBe("string");
        else if (want.reason !== undefined) expect(result.reason, label).toBe(want.reason);
        if (want.extra) expect(result, label).toMatchObject(want.extra);
      }
      port.tick(1);
    });

    it("refuses a malformed command with the engine's reason, without a throw, and moves nothing", async () => {
      const port = start(makePort);
      const t = await furnish(port);
      const malformed: unknown[] = [
        null,
        "build",
        { op: "nuke" },
        { op: "toString" },
        { op: 7 },
        { op: "build", kind: "office", floor: Number.NaN, x: t.mid - 4 },
        { op: "build", kind: "office", floor: 4, x: t.mid + 0.5 },
        { op: "build", kind: "office", floor: 4, x: "5" },
        { op: "build", kind: "castle", floor: 4, x: t.mid },
        { op: "paintBrush", kind: "floor", floor: 4, tiles: "abc" },
        { op: "paintBrush", kind: "floor", floor: 4, tiles: [t.mid, 1.5] },
        { op: "paintBrush", kind: "office", floor: 4, tiles: [t.mid] },
        { op: "buildTransport", kind: "elevatorStandard", x: Number.NaN, bottom: 1, top: 2 },
        { op: "buildTransport", kind: "lift", x: t.mid, bottom: 1, top: 2 },
        { op: "removeFacility", id: Number.NaN, method: "sell" },
        { op: "removeFacility", id: t.office, method: "explode" },
        { op: "beginExtend", id: "1" },
        { op: "extendTransport", id: t.shaft, end: "sideways", targetFloor: 4 },
        { op: "extendTransport", id: t.shaft, end: "up", targetFloor: 3.5 },
        { op: "addCar", id: 1.5 },
        { op: "removeCar", id: Number.NaN },
        { op: "setStop", id: t.shaft, floor: 2, stop: "no" },
        { op: "setStop", id: t.shaft, floor: Number.NaN, stop: false },
        { op: "setExpressStops", id: null },
        { op: "clearStops" },
        { op: "setSchedule", id: Number.NaN, schedule: {} },
        { op: "setLabel", id: t.office, label: 5 },
        { op: "adjustRent", id: t.office, dir: 2 },
        { op: "setNoRate", id: Number.POSITIVE_INFINITY },
        { op: "priceUnit", id: t.office, target: Number.NaN },
        { op: "applyRentBatch", kind: "castle", target: "default" },
        { op: "applyRentBatch", kind: "office", target: "highest" },
        { op: "applyRentBatch", kind: "office", target: "default", onlyDefaultPriced: "yes" },
        { op: "setFilmPolicy", id: t.office, policy: "matinee" },
        { op: "rerollSubtype", id: [t.fastFood] },
        { op: "resolveChoice", accept: "yes" },
        { op: "setAutoBridge", value: "yes" },
        { op: "setTowerName", name: 5 },
        { op: "setView", view: 5 },
        { op: "setView", view: { tile: "here", floor: 2 } },
        { op: "emit", text: 5 },
        { op: "emit", text: "Bulletin", kind: "loud" },
      ];
      for (const command of malformed) {
        const result = await expectUnmoved(port, command as Command);
        expect(result.reason, JSON.stringify(command)).toBe(INVALID_COMMAND);
      }
      // The refusals that carry more fields report that nothing changed.
      expect(await port.command({ op: "paintBrush", kind: "floor", floor: 4, tiles: "x" } as unknown as Command)).toMatchObject({ placed: 0 });
      expect(await port.command({ op: "extendTransport", id: t.shaft, end: "sideways" } as unknown as Command)).toMatchObject({ bottom: 1, top: 3, added: 0 });
      expect(await port.command({ op: "setAutoBridge", value: 1 } as unknown as Command)).toMatchObject({ value: true });
      port.tick(1);
    });

    it("runs back-to-back commands in issue order", async () => {
      const port = start(makePort);
      const t = await furnish(port);
      // Each pair undoes the other only in this order: issued the other way
      // round, floor 2 would end skipped and the name would be the first.
      const order = [
        port.command({ op: "setStop", id: t.shaft, floor: 2, stop: false }),
        port.command({ op: "clearStops", id: t.shaft }),
        port.command({ op: "setTowerName", name: "First" }),
        port.command({ op: "setTowerName", name: "Second" }),
        port.command({ op: "toggleAutoBridge" }),
        port.command({ op: "toggleAutoBridge" }),
      ];
      const results = await Promise.all(order);
      expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true, true]);
      expect(results.slice(4).map((r) => (r as { value?: boolean }).value)).toEqual([false, true]);
      expect(port.view.tower.getTransport(t.shaft)?.skipFloors ?? []).toEqual([]);
      const save = await saved(port);
      expect([save.towerName, save.autoBridge ?? true]).toEqual(["Second", true]);
      port.tick(1);
    });
  });
}

/** What `furnish` built, by id. */
interface Furnished {
  mid: number;
  office: number;
  fastFood: number;
  shaft: number;
}

/** Furnish the founded tower through the port, asserting each step: floor 2
 *  and 3 strips by brush, an office on floor 2, a fast-food on floor 3 over
 *  it, and a one-car standard elevator over floors 1 to 3. */
async function furnish(port: SimPort): Promise<Furnished> {
  const mid = lobbyCenter(port);
  const send = sender(port);
  for (const floor of [2, 3]) {
    const tiles = Array.from({ length: 11 }, (_, i) => mid + 5 + i);
    expect(await send({ op: "paintBrush", kind: "floor", floor, tiles }), `floor ${floor}`).toMatchObject({ ok: true, placed: 11 });
  }
  expect(await send({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
  expect(await send({ op: "build", kind: "fastFood", floor: 3, x: mid - 4 })).toMatchObject({ ok: true });
  expect(await send({ op: "buildTransport", kind: "elevatorStandard", x: mid + 12, bottom: 1, top: 3 })).toMatchObject({ ok: true });
  const { tower } = port.view;
  return {
    mid,
    office: mustFind(tower.units, (u) => u.kind === "office").id,
    fastFood: mustFind(tower.units, (u) => u.kind === "fastFood").id,
    shaft: mustFind(tower.transports, (s) => s.kind === "elevatorStandard").id,
  };
}

/** One past the starter lobby's last tile, walking right from `mid`. */
function lobbyRight(port: SimPort, mid: number): number {
  let x = mid;
  while (port.view.tower.structureKindAt(1, x) === "lobby") x++;
  return x;
}

/** The parts of a save this contract reads back. */
interface SavedSettings {
  autoBridge?: boolean;
  towerName?: string;
  view?: unknown;
  units: { id: number; rent?: number }[];
}

async function saved(port: SimPort): Promise<SavedSettings> {
  return JSON.parse(await port.save()) as SavedSettings;
}

/** Send `command`, which must be refused, and check it moved nothing: no
 *  balance change, the same save, no log line and no gameplay event. */
async function expectUnmoved(port: SimPort, command: Command): Promise<{ ok: boolean; reason?: string; delta: number }> {
  const label = JSON.stringify(command);
  const save = await port.save();
  const { money, logSeq } = port.view.header;
  port.drainEvents({ release: true });
  const result = (await port.command(command)) as { ok: boolean; reason?: string; delta: number };
  expect(result.ok, label).toBe(false);
  expect(result.delta, label).toBe(0);
  expect([port.view.header.money, port.view.header.logSeq], label).toEqual([money, logSeq]);
  expect(await port.save(), label).toBe(save);
  expect(port.drainEvents({ release: true }), label).toEqual([]);
  return result;
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SerializedGame } from "../engine/types";
import type { Command, CommandOp } from "./commands";
import { lobbyCenter, mustFind, start } from "./contract.fixture";
import type { SimPort } from "./port";

/** A port to run the lifecycle contract on, and the reference its
 *  `undoSignature` is held to: a function that changes exactly when
 *  `towerStateSig` of the same tower would. `TsSim` passes `towerStateSig`
 *  of its live instance; slice 7's `RustSim` passes a `TsSim` twin fed the
 *  same script. Both follow every load. */
export interface LifecycleSubject {
  port: SimPort;
  reference(): string;
}

/** The parts of a save the contract reads back. */
interface SavedTower {
  mode?: string;
  modernCalendar?: string;
  autoBridge?: boolean;
  founder?: boolean;
  view?: { tile: number; floor: number; zoom?: number };
  units: { kind: string; floor: number }[];
}

const parse = (text: string) => JSON.parse(text) as SavedTower;

/**
 * The port's lifecycle contract (the slice 5 story, AC 3), run over any
 * adapter: loads, saves taken now and later, the undo signature and the
 * tower's generation. `make` returns a subject on a freshly founded Modern
 * tower standing on its starter lobby, as the port's contract does, and the
 * cases reach the tower through the port alone.
 *
 * Like the port's contract, each case ticks before its first command and
 * after its last, and after each load before the loaded tower's first
 * command, so the `unitWasm` parity project's host is attached to every
 * tower that takes a command. `restarts` fails a case the parity setup had
 * to forgive.
 */
export function describeLifecycleContract(name: string, make: () => LifecycleSubject, opts: { restarts?: () => number | undefined } = {}): void {
  describe(`${name}: the SimPort lifecycle contract`, () => {
    let restartsBefore: number | undefined;
    beforeEach(() => {
      restartsBefore = opts.restarts?.();
    });
    afterEach(() => {
      expect(opts.restarts?.(), "the engines disagreed on a command, and the parity setup restarted the engine").toBe(restartsBefore);
    });

    const subject = (): LifecycleSubject => {
      const s = make();
      start(() => s.port);
      return s;
    };

    it("saves the same text now and later, holding every command issued before it", async () => {
      const { port } = subject();
      const mid = lobbyCenter(port);
      // Issued and not awaited: the save still holds it.
      void port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 });
      const now = port.saveNow();
      expect(parse(now).units.filter((u) => u.kind === "office")).toHaveLength(1);
      expect(await port.save()).toBe(now);
      // A copy kept in memory may be the engine's own text; it holds the
      // same tower.
      expect(JSON.parse(port.saveNow({ memory: true }))).toEqual(JSON.parse(now));
      port.tick(1);
    });

    it("puts the camera in the save, and a null keeps the tower's own", async () => {
      const { port } = subject();
      const camera = { tile: 120, floor: 4, zoom: 2 };
      expect(parse(port.saveNow({ view: () => camera })).view).toEqual(camera);
      expect(parse(await port.save({ view: () => null })).view).toEqual(camera);
      const moved = { tile: 90, floor: 1 };
      expect(parse(await port.save({ view: () => moved })).view).toEqual(moved);
      port.tick(1);
    });

    it("loads an earlier save of its own as an undo step: the same signature, the live bridging setting, a new generation", async () => {
      const { port, reference } = subject();
      const mid = lobbyCenter(port);
      expect(await port.command({ op: "build", kind: "office", floor: 2, x: mid - 4 })).toMatchObject({ ok: true });
      const text = port.saveNow({ memory: true });
      const [signature, ref] = [port.undoSignature(), reference()];
      expect(await port.command({ op: "build", kind: "office", floor: 3, x: mid - 4 })).toMatchObject({ ok: true });
      expect(await port.command({ op: "setAutoBridge", value: false })).toMatchObject({ ok: true, value: false });
      expect(port.undoSignature()).not.toBe(signature);
      const generation = port.generation;
      expect(port.generation, "a command keeps the generation").toBe(generation);
      port.tick(1);
      expect(port.generation, "a tick keeps the generation").toBe(generation);

      await port.load({ from: "history", text });
      expect(port.generation).not.toBe(generation);
      expect([port.undoSignature(), reference()]).toEqual([signature, ref]);
      expect(port.view.tower.units.filter((u) => u.kind === "office")).toHaveLength(1);
      expect(parse(port.saveNow()).autoBridge, "the live bridging setting").toBe(false);
      port.tick(1);
      expect(await port.command({ op: "build", kind: "office", floor: 3, x: mid - 4 })).toMatchObject({ ok: true });
      expect(mustFind(port.view.tower.units, (u) => u.kind === "office" && u.floor === 3).floor).toBe(3);
      port.tick(1);
    });

    it("loads the first stored save that loads, with the founder rule", async () => {
      const { port } = subject();
      const saved = JSON.parse(port.saveNow()) as SerializedGame;
      const unloadable = null as unknown as SerializedGame;
      await port.load({ from: "stored", saves: [unloadable, saved] });
      expect(parse(port.saveNow()).founder, "a save with no appVersion stamp predates 2.0").toBe(true);
      port.tick(1);
      await port.load({ from: "stored", saves: [{ ...saved, appVersion: "2.46.0" } as SerializedGame] });
      expect(parse(port.saveNow()).founder).toBeUndefined();
      port.tick(1);
    });

    it("rejects when no stored save loads, and keeps the tower and its generation", async () => {
      const { port } = subject();
      const tower = port.view.tower;
      const generation = port.generation;
      const unloadable = null as unknown as SerializedGame;
      await expect(port.load({ from: "stored", saves: [unloadable, unloadable] })).rejects.toBeInstanceOf(Error);
      await expect(port.load({ from: "stored", saves: [] })).rejects.toBeInstanceOf(Error);
      await expect(port.load({ from: "history", text: "not a save" })).rejects.toBeInstanceOf(Error);
      expect(port.view.tower).toBe(tower);
      expect(port.generation).toBe(generation);
      port.tick(1);
    });

    it("loads a 1994 import with no founder rule", async () => {
      const { port } = subject();
      const saved = JSON.parse(port.saveNow()) as SerializedGame;
      await port.load({ from: "legacy", save: saved });
      expect(parse(port.saveNow()).founder).toBeUndefined();
      port.tick(1);
    });

    it("founds a new tower on an empty lot under the chosen rules", async () => {
      const { port } = subject();
      await port.load({ from: "found", seed: 11, mode: "classic", calendar: "realWorld", unbridged: false });
      expect(parse(port.saveNow())).toMatchObject({ mode: "classic" });
      expect(port.view.tower.units).toEqual([]);
      port.tick(1);
      await port.load({ from: "found", seed: 12, mode: "modern", calendar: "canon", unbridged: true });
      expect(parse(port.saveNow())).toMatchObject({ mode: "modern", modernCalendar: "canon", autoBridge: false });
      port.tick(1);
    });

    it("moves the undo signature on exactly the steps that change what a player can undo", async () => {
      const { port, reference } = subject();
      const mid = lobbyCenter(port);
      const ids = { office: -1, shaft: -1, food: -1 };
      const seen = new Set<CommandOp>();
      for (const step of coverageScript(mid, ids)) {
        const before = [port.undoSignature(), reference()];
        let ok = true;
        if (step.run === "tick") port.tick(1);
        else {
          const c = step.run();
          seen.add(c.op);
          ok = (await port.command(c)).ok;
          step.after?.(port);
        }
        const moved = port.undoSignature() !== before[0];
        expect(moved, `${step.name}: the signature moved as the reference did`).toBe(reference() !== before[1]);
        if (step.moves !== "either") expect(moved, `${step.name} (ok: ${String(ok)})`).toBe(step.moves === "ifOk" ? ok : step.moves);
      }
      expect([...seen].sort(), "the script runs every command").toEqual(Object.keys(EVERY_OP).sort());
      port.tick(1);
    });
  });
}

/** Every command, so the coverage script fails to compile when one is added
 *  without a step. */
const EVERY_OP = {
  build: true, buildTransport: true, removeFacility: true, beginExtend: true, extendTransport: true, endExtend: true,
  addCar: true, removeCar: true, setStop: true, setExpressStops: true, clearStops: true, setSchedule: true,
  setLabel: true, adjustRent: true, setNoRate: true, priceUnit: true, applyRentBatch: true, setFilmPolicy: true,
  rerollSubtype: true, callExterminator: true, resolveChoice: true, toggleAutoBridge: true, setAutoBridge: true,
  setTowerName: true, setView: true, emit: true,
} satisfies Record<CommandOp, true>;

interface Step {
  name: string;
  run: "tick" | (() => Command);
  /** Whether the step changes what a player can undo: always, never, when
   *  the command applied, or either (a tick may move the money). */
  moves: boolean | "ifOk" | "either";
  after?: (port: SimPort) => void;
}

/** One step per command a 1-star Modern tower takes, plus a tick: the
 *  undo signature covers rooms, transports, labels, rents, the No Rate flag,
 *  the film policy, the subtype and the money, and nothing else. `ids` is
 *  filled as the rooms are built. */
function coverageScript(mid: number, ids: { office: number; shaft: number; food: number }): Step[] {
  const unit = (kind: string) => (port: SimPort) => mustFind(port.view.tower.units, (u) => u.kind === kind && u.floor >= 2).id;
  return [
    { name: "an office", run: () => ({ op: "build", kind: "office", floor: 2, x: mid - 4 }), moves: true, after: (p) => (ids.office = unit("office")(p)) },
    ...[2, 3].flatMap((floor) =>
      Array.from({ length: 11 }, (_, i): Step => ({ name: `a floor tile on ${floor} at ${mid + 5 + i}`, run: () => ({ op: "build", kind: "floor", floor, x: mid + 5 + i }), moves: true })),
    ),
    { name: "a shaft", run: () => ({ op: "buildTransport", kind: "elevatorStandard", x: mid + 8, bottom: 1, top: 2 }), moves: true, after: (p) => (ids.shaft = p.view.tower.transports[0].id) },
    { name: "a car", run: () => ({ op: "addCar", id: ids.shaft }), moves: true },
    { name: "a car off", run: () => ({ op: "removeCar", id: ids.shaft }), moves: true },
    { name: "a drag opened", run: () => ({ op: "beginExtend", id: ids.shaft }), moves: false },
    { name: "the shaft extended", run: () => ({ op: "extendTransport", id: ids.shaft, end: "up", targetFloor: 3 }), moves: true },
    { name: "the drag closed", run: () => ({ op: "endExtend" }), moves: false },
    { name: "a skipped stop", run: () => ({ op: "setStop", id: ids.shaft, floor: 2, stop: false }), moves: true },
    { name: "the stops cleared", run: () => ({ op: "clearStops", id: ids.shaft }), moves: true },
    { name: "express stops", run: () => ({ op: "setExpressStops", id: ids.shaft }), moves: "ifOk" },
    { name: "a schedule", run: () => ({ op: "setSchedule", id: ids.shaft, schedule: { waitingCarResponse: 7 } }), moves: true },
    { name: "a label", run: () => ({ op: "setLabel", id: ids.office, label: "Contract Office" }), moves: true },
    { name: "a rent step", run: () => ({ op: "adjustRent", id: ids.office, dir: 1 }), moves: true },
    { name: "a price", run: () => ({ op: "priceUnit", id: ids.office, target: 0 }), moves: "ifOk" },
    { name: "a rent batch", run: () => ({ op: "applyRentBatch", kind: "office", target: "default" }), moves: "ifOk" },
    { name: "No Rate", run: () => ({ op: "setNoRate", id: ids.office }), moves: "ifOk" },
    { name: "a fast food", run: () => ({ op: "build", kind: "fastFood", floor: 3, x: mid - 4 }), moves: true, after: (p) => (ids.food = unit("fastFood")(p)) },
    { name: "a variety reroll", run: () => ({ op: "rerollSubtype", id: ids.food }), moves: "either" },
    { name: "a film policy on a room that has none", run: () => ({ op: "setFilmPolicy", id: ids.food, policy: "feature" }), moves: false },
    { name: "the exterminator, with nothing to treat", run: () => ({ op: "callExterminator" }), moves: "ifOk" },
    { name: "an answer with no emergency", run: () => ({ op: "resolveChoice", accept: true }), moves: false },
    { name: "bridging toggled", run: () => ({ op: "toggleAutoBridge" }), moves: false },
    { name: "bridging set", run: () => ({ op: "setAutoBridge", value: true }), moves: false },
    { name: "a tower name", run: () => ({ op: "setTowerName", name: "Lifecycle" }), moves: false },
    { name: "a camera", run: () => ({ op: "setView", view: { tile: 100, floor: 2 } }), moves: false },
    { name: "a bulletin", run: () => ({ op: "emit", text: "A bulletin." }), moves: false },
    { name: "a tick", run: "tick", moves: "either" },
    { name: "the office sold", run: () => ({ op: "removeFacility", id: ids.office, method: "sell" }), moves: true },
  ];
}

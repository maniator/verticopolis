import { afterEach, describe, expect, it } from "vitest";
import type { GameplayEvent } from "../../engine/gameplayEvents";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";
import { FrameDriver } from "../dualrun/dualRunHarness";
import { freePoisoned, trapAfter } from "./wasmTraps";
import { RESTORED, SET_UP, expectRolledBack, lastGood, offices, pendingCapture, settle, setUp, tally } from "./wasmRollback";

/**
 * What the player sees when an edit's command traps on the real engine
 * (#874; the owner's review of #1101). The command has already answered its
 * caller with the TypeScript instance's result when the engine traps, and the
 * recovery runs before the next frame is drawn, so the edit is never shown.
 * After it: the tower is the last good state (the undo capture's save, read
 * just before the edit, or the newest merge's), its money and rooms are that
 * state's, the undo trail has no step for the lost edit, the log ends with
 * one line saying the changes were undone (the UI toasts it), every event
 * reached the game once and none of a lost command's did, and the save
 * round-trips with the tower's identity. Undo, redo and the capture's own
 * save are in wasmHostRollbackHistory.integration.test.ts.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

afterEach(freePoisoned);

describe.skipIf(!hasWasmPackage())("an edit whose engine command traps is undone (#874)", () => {
  it("undoes a build: no office, the price back, no undo step, one line, no event", async () => {
    const { a, h, engine, delivered, deliver } = setUp(61);
    try {
      const sim = a.sim;
      // A completed edit, then the one that traps, paused, as clicks.
      a.captureUndo("first office");
      expect(sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo();
      deliver();
      a.captureUndo("second office");
      const good = lastGood(sim);
      const point = pendingCapture(a);
      trapAfter(engine(), "build");
      // The caller already has the instance's answer; nothing throws.
      expect(sim.build("office", 2, 190)).toEqual({ ok: true });
      a.commitUndo();
      expect(h.status.lastFallback).toEqual({ reason: "trap-command", stage: "start" });
      deliver(); // the frame loop drains before the recovery runs: nothing of the lost edit
      await settle();
      // The capture's save is the point: the completed office stays.
      expectRolledBack(a, sim, good, undefined, point);
      deliver();
      expect(offices(a)).toEqual([170, 180]);
      // Each event once, the completed office's included, the lost one's not.
      expect(tally(delivered)).toEqual({ ...SET_UP, "facility_placed office": 2 });
      // The lost edit left no undo step; the completed one is next.
      await a.undo();
      expect(a.toasts).toEqual(["Undid: first office"]);
      expect(offices(a)).toEqual([170]);
      // The TypeScript engine runs on and emits none of it again.
      await a.redo();
      expect(a.toasts).toEqual(["Undid: first office", "Redid: first office"]);
      const resumed = a.sim;
      const minutes = resumed.clock.minutes;
      new FrameDriver(resumed, 3).run(30);
      expect(resumed.clock.minutes).toBeGreaterThan(minutes);
      deliver();
      expect(tally(delivered)).toEqual({ ...SET_UP, "facility_placed office": 2 });
    } finally {
      h.stop();
    }
  });

  it.each(["bulldoze", "sell"] as const)("undoes a %s: the room is back with the money it had", async (method) => {
    const { a, h, engine, deliver, delivered } = setUp(62);
    try {
      const sim = a.sim;
      const office = sim.tower.units.find((u) => u.kind === "office")!;
      a.captureUndo(method === "sell" ? "Sell" : "Bulldoze");
      const good = lastGood(sim);
      trapAfter(engine(), "removeFacility");
      const answer = sim.removeFacility(office.id, method);
      expect(answer).toEqual(expect.objectContaining({ ok: true }));
      expect(sim.money).toBe(good.money + answer.delta); // the read model billed it
      a.commitUndo();
      expect(sim.tower.units.some((u) => u.id === office.id)).toBe(false); // the read model ran it
      await settle();
      const fresh = expectRolledBack(a, sim, good);
      expect(fresh.tower.units.find((u) => u.kind === "office")).toMatchObject({ floor: 2, x: 170 });
      await a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP); // no removal reached the game
    } finally {
      h.stop();
    }
  });

  it("undoes a car bought for an elevator: its charge comes back", async () => {
    const { a, h, engine, deliver, delivered } = setUp(63);
    try {
      const sim = a.sim;
      const shaft = sim.tower.transportAt(1, 200)!;
      const cars = shaft.cars;
      a.captureUndo("Add car");
      const good = lastGood(sim);
      trapAfter(engine(), "addCar");
      const answer = sim.addCar(shaft.id);
      expect(answer).toEqual(expect.objectContaining({ ok: true }));
      expect(answer.delta).toBeLessThan(0);
      a.commitUndo();
      expect(sim.money).toBe(good.money + answer.delta); // the read model charged it
      expect(shaft.cars).toBe(cars + 1);
      await settle();
      const fresh = expectRolledBack(a, sim, good);
      expect(fresh.tower.transportAt(1, 200)!.cars).toBe(cars);
      await a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP); // no capacity change reached the game
    } finally {
      h.stop();
    }
  });

  it("undoes a rent change: the old rent is back", async () => {
    const { a, h, engine, deliver, delivered } = setUp(64);
    try {
      const sim = a.sim;
      const office = sim.tower.units.find((u) => u.kind === "office")!;
      const rent = office.rent;
      a.captureUndo("Raise rent");
      const good = lastGood(sim);
      trapAfter(engine(), "adjustRent");
      const answer = sim.adjustRent(office.id, 1);
      expect(answer).not.toBeNull();
      expect(answer).not.toBe(rent);
      a.commitUndo();
      await settle();
      const fresh = expectRolledBack(a, sim, good);
      expect(fresh.tower.getUnit(office.id)?.rent).toBe(rent);
      await a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP); // no price change reached the game
    } finally {
      h.stop();
    }
  });

  it("undoes an elevator resize: the shaft is its old height", async () => {
    const { a, h, engine, deliver, delivered } = setUp(67);
    try {
      const sim = a.sim;
      for (let x = 160; x < 220; x++) expect(sim.build("floor", 3, x).ok).toBe(true);
      new FrameDriver(sim, 3).run(3); // the floor merges
      deliver();
      const shaft = sim.tower.transportAt(1, 200)!;
      a.captureUndo("Resize elevator");
      const good = lastGood(sim);
      trapAfter(engine(), "resizeTransport");
      expect(sim.resizeTransport(shaft.id, 1, 3)).toEqual(expect.objectContaining({ ok: true }));
      expect(shaft.top).toBe(3); // the read model ran it
      a.commitUndo();
      await settle();
      const fresh = expectRolledBack(a, sim, good);
      expect(fresh.tower.transportAt(1, 200)).toMatchObject({ bottom: 1, top: 2 });
      await a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
      deliver();
      expect(tally(delivered)).toEqual({ ...SET_UP, "facility_placed floor": 120 }); // no capacity change
    } finally {
      h.stop();
    }
  });

  it("keeps a running drag's tiles the clock already merged, and the drag stays one undo step", async () => {
    const { a, h, engine, deliver, delivered } = setUp(65);
    try {
      const sim = a.sim;
      const driver = new FrameDriver(sim, 3);
      a.captureUndo("Build Floor");
      expect(sim.build("floor", 3, 160).ok).toBe(true);
      driver.frame(); // the game runs: the sync merges the tile, the newest point
      expect(sim.build("floor", 3, 161).ok).toBe(true);
      driver.frame();
      deliver();
      const good = lastGood(sim); // the second tile's merge, no save of the test's own
      trapAfter(engine(), "build");
      expect(sim.build("floor", 3, 162).ok).toBe(true);
      await settle();
      const fresh = expectRolledBack(a, sim, good);
      const tiles = () => a.sim.tower.units.filter((u) => u.kind === "floor" && u.floor === 3).map((u) => u.x);
      expect(tiles()).toEqual([160, 161]);
      // The drag goes on, on TypeScript, and ends as one step.
      expect(fresh.build("floor", 3, 162).ok).toBe(true);
      a.commitUndo();
      await a.undo();
      expect(a.toasts).toEqual(["Undid: Build Floor"]);
      expect(tiles()).toEqual([]);
      deliver();
      // The two merged tiles once each, the lost one's none, and the tile the
      // drag laid again on TypeScript once.
      expect(tally(delivered)).toEqual({ ...SET_UP, "facility_placed floor": 63 });
    } finally {
      h.stop();
    }
  });

  it("undoes a paused drag whole, and none of its tiles reached the game before the trap", async () => {
    const { a, h, engine, deliver, delivered } = setUp(68);
    try {
      const sim = a.sim;
      a.captureUndo("Build Floor");
      const good = lastGood(sim);
      // Paused: no tick, so no merge, but the frame loop still drains.
      for (let x = 160; x < 170; x++) {
        expect(sim.build("floor", 3, x).ok).toBe(true);
        deliver();
      }
      expect(tally(delivered)).toEqual(SET_UP); // held: no point covers them yet
      trapAfter(engine(), "build");
      expect(sim.build("floor", 3, 170).ok).toBe(true);
      await settle();
      const fresh = expectRolledBack(a, sim, good);
      const tiles = () => a.sim.tower.units.filter((u) => u.kind === "floor" && u.floor === 3).map((u) => u.x);
      expect(tiles()).toEqual([]);
      // The drag lays them again on TypeScript: each counts once.
      for (let x = 160; x <= 170; x++) expect(fresh.build("floor", 3, x).ok).toBe(true);
      a.commitUndo();
      deliver();
      expect(tally(delivered)).toEqual({ ...SET_UP, "facility_placed floor": 71 });
      await a.undo();
      expect(a.toasts).toEqual(["Undid: Build Floor"]);
      expect(tiles()).toEqual([]);
    } finally {
      h.stop();
    }
  });

  it("keeps an edit's held events from the analytics flush when that flush's own drain traps", async () => {
    const { a, h, engine, deliver, delivered } = setUp(75);
    try {
      const sim = a.sim;
      a.captureUndo("office");
      const good = lastGood(sim);
      expect(sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo(); // paused: no point covers it, so its event is held
      trapAfter(engine(), "gameplayEventsPending", false);
      const flush = sim.drainGameplayEvents as (opts?: { release?: boolean }) => GameplayEvent[];
      delivered.push(...flush({ release: true })); // a hide's flush, which traps
      expect(h.status.lastFallback).toEqual({ reason: "trap-tick", stage: "start" });
      await settle();
      expectRolledBack(a, sim, good);
      expect(offices(a)).toEqual([170]);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP); // the office the recovery took away never reached the game
    } finally {
      h.stop();
    }
  });

  it("undoes an action with no undo capture when a tick traps before a point covers it, and its event never leaves", async () => {
    const { a, h, engine, deliver, delivered } = setUp(69);
    try {
      const sim = a.sim;
      new FrameDriver(sim, 3).run(150); // the office is built: it can burn
      deliver();
      sim.serialize(); // the last save the game read (an autosave): the newest point
      const good = lastGood(sim);
      sim.startFire(); // relayed like an emergency answer: no capture
      expect(sim.tower.units.filter((u) => u.kind === "office").map((u) => u.state)).toEqual(["fire"]);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP); // held
      trapAfter(engine(), "tick");
      new FrameDriver(sim, 3).frame();
      expect(h.status.lastFallback).toEqual({ reason: "trap-tick", stage: "start" });
      await settle();
      // Nothing the player sees in the undo signature changed, so the line
      // says only that the tower went back.
      const fresh = expectRolledBack(a, sim, good, RESTORED);
      expect(fresh.tower.units.some((u) => u.state === "fire")).toBe(false);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP); // the fire's event never reached the game
    } finally {
      h.stop();
    }
  });
});

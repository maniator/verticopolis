import { afterEach, describe, expect, it } from "vitest";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";
import { FrameDriver } from "../dualrun/dualRunHarness";
import { freePoisoned, trapAfter } from "./wasmTraps";
import { REPLACED, SET_UP, UNDONE, expectRolledBack, lastGood, offices, settle, setUp, tally } from "./wasmRollback";

/**
 * Undo, redo and the undo capture when the engine traps inside them, on the
 * real engine (#874; the owner's review of #1101): the tower, the undo and
 * redo trails, the line the player gets and the events the game received.
 * A trap in a capture's or an undo's own save makes the snapshot the newest
 * restore point, which for an edit no point covers yet is the state before
 * that edit: the recovery loses it too, and the trails drop the steps that
 * would then change nothing.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

afterEach(freePoisoned);

describe.skipIf(!hasWasmPackage())("a trap in an undo, a redo or an undo capture (#874)", () => {
  it("codes a trap in the undo capture's own save as a command, and undoes the edit it began", async () => {
    const { a, h, engine, deliver, delivered } = setUp(66);
    try {
      const sim = a.sim;
      h.current()!.syncStructure(); // a merge: the newest point
      const good = lastGood(sim);
      trapAfter(engine(), "serialize", false);
      a.captureUndo("Build office");
      expect(h.status.lastFallback).toEqual({ reason: "trap-command", stage: "start" });
      // The command runs on the frozen host, and the recovery takes it away.
      expect(sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo();
      await settle();
      expectRolledBack(a, sim, good);
      a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP);
    } finally {
      h.stop();
    }
  });

  it("loses the edit before too when it had not merged and the next capture's save traps", async () => {
    const { a, h, engine, deliver, delivered } = setUp(70);
    try {
      const sim = a.sim;
      // Paused, as clicks: the first edit's capture is the newest point.
      a.captureUndo("first office");
      const good = lastGood(sim);
      expect(sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo();
      deliver();
      trapAfter(engine(), "serialize", false);
      a.captureUndo("second office");
      expect(sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo();
      await settle();
      // Both offices go, the line says so, and neither step is left.
      expectRolledBack(a, sim, good);
      expect(offices(a)).toEqual([170]);
      a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP); // neither office reached the game
    } finally {
      h.stop();
    }
  });

  it("drops the redo step an undo took from a frozen tower, when it would redo nothing", async () => {
    const { a, h, engine, deliver, delivered } = setUp(71);
    try {
      const sim = a.sim;
      a.captureUndo("office");
      expect(sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo(); // paused: no point covers it
      trapAfter(engine(), "serialize", false);
      a.undo(); // its redo snapshot traps: the newest point, the state before the office
      expect(h.status.lastFallback).toEqual({ reason: "trap-undo", stage: "start" });
      expect(offices(a)).toEqual([170]);
      await settle();
      expect(a.sim.log[a.sim.log.length - 1]).toEqual(expect.objectContaining({ text: REPLACED, kind: "bad" }));
      a.redo();
      expect(a.toasts).toEqual(["Undid: office", "Nothing to redo."]);
      expect(offices(a)).toEqual([170]);
      deliver();
      // The office was built and undone; no point ever covered it, so its
      // event went with the frozen engine.
      expect(tally(delivered)).toEqual(SET_UP);
    } finally {
      h.stop();
    }
  });

  it("keeps the redo step an undo took from a frozen tower when a merge covered the edit", async () => {
    const { a, h, engine, deliver, delivered } = setUp(72);
    try {
      const sim = a.sim;
      a.captureUndo("office");
      expect(sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo();
      new FrameDriver(sim, 3).frame(); // the merge covers the office
      deliver();
      trapAfter(engine(), "serialize", false);
      a.undo();
      expect(h.status.lastFallback).toEqual({ reason: "trap-undo", stage: "start" });
      await settle();
      a.redo();
      expect(a.toasts).toEqual(["Undid: office", "Redid: office"]);
      expect(offices(a)).toEqual([170, 180]);
      deliver();
      expect(tally(delivered)).toEqual({ ...SET_UP, "facility_placed office": 2 });
    } finally {
      h.stop();
    }
  });

  it("redoes on TypeScript when the redo's own snapshot traps, and undo still goes back", async () => {
    const { a, h, engine, deliver, delivered } = setUp(73);
    try {
      const sim = a.sim;
      a.captureUndo("office");
      expect(sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo();
      a.undo(); // healthy: the undo hosts the restored tower on a new engine
      expect(h.status.starts).toBe(2);
      trapAfter(engine(), "serialize", false);
      a.redo();
      expect(h.status.lastFallback).toEqual({ reason: "trap-undo", stage: "undo" });
      expect(offices(a)).toEqual([170, 180]);
      await settle();
      expect(a.sim.log[a.sim.log.length - 1].text).toBe(REPLACED);
      a.undo();
      expect(offices(a)).toEqual([170]);
      expect(a.toasts).toEqual(["Undid: office", "Redid: office", "Undid: office"]);
      deliver();
      // The office's build reached the game once, at the healthy undo's hand-off.
      expect(tally(delivered)).toEqual({ ...SET_UP, "facility_placed office": 2 });
    } finally {
      h.stop();
    }
  });

  it("leaves no redo trail after a trapped edit, as an edit on TypeScript clears it", async () => {
    const { a, h, engine } = setUp(74);
    try {
      a.captureUndo("first office");
      expect(a.sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo();
      a.undo(); // a redo trail, on a new engine
      const sim = a.sim;
      a.captureUndo("second office");
      const good = lastGood(sim);
      trapAfter(engine(), "build");
      expect(sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo();
      await settle();
      expectRolledBack(a, sim, good, UNDONE);
      expect(offices(a)).toEqual([170]);
      a.redo();
      a.undo();
      expect(a.toasts).toEqual(["Undid: first office", "Nothing to redo.", "Nothing to undo."]);
    } finally {
      h.stop();
    }
  });
});

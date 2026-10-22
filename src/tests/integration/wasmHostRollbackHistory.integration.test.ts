import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";
import { FrameDriver } from "../dualrun/dualRunHarness";
import { freePoisoned, trapAfter } from "./wasmTraps";
import { CLEARED, LOST, OLDER, REPLACED, SET_UP, UNDONE, expectRolledBack, lastGood, offices, settle, setUp, tally } from "./wasmRollback";

/**
 * Undo, redo and the undo capture when the engine traps inside them, on the
 * real engine (#874; the owner's review of #1101): the tower, the undo and
 * redo trails, the line the player gets and the events the game received.
 * A trap in a capture's or an undo's own save makes the snapshot the newest
 * restore point, which for an edit no point covers yet is the state before
 * that edit: the recovery loses it too, and the trails drop the steps that
 * would then change nothing. A gesture whose press trapped can end after the
 * recovery, and a load can let go of a tower whose engine traps.
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

  it("leaves no step for a press whose capture's save traps when its release comes after the recovery", async () => {
    const { a, h, engine, deliver, delivered } = setUp(77);
    try {
      const sim = a.sim;
      a.captureUndo("first office");
      const good = lastGood(sim);
      expect(sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo(); // paused: no point covers it
      trapAfter(engine(), "serialize", false);
      a.captureUndo("second office"); // the mouse press
      await settle(); // the recovery runs before the release
      expectRolledBack(a, sim, good);
      a.commitUndo(); // the release, with nothing done on the restored tower
      a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
      expect(offices(a)).toEqual([170]);
      deliver();
      expect(tally(delivered)).toEqual(SET_UP);
    } finally {
      h.stop();
    }
  });

  it("keeps the redo trail the lost edit held when that release comes after the recovery", async () => {
    const { a, h, engine } = setUp(78);
    try {
      a.captureUndo("zero");
      expect(a.sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo();
      a.undo(); // a redo trail, on a new engine
      const sim = a.sim;
      a.captureUndo("first office");
      expect(sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo(); // paused: no point covers it, and it holds the trail it cleared
      trapAfter(engine(), "serialize", false);
      a.captureUndo("second office");
      await settle();
      expect(offices(a)).toEqual([170]);
      a.commitUndo();
      a.redo();
      expect(offices(a)).toEqual([170, 180]);
      expect(a.toasts).toEqual(["Undid: zero", "Redid: zero"]);
    } finally {
      h.stop();
    }
  });

  it("gives a gesture that goes on over the restored tower one step, which undoes what it did there", async () => {
    const { a, h, engine } = setUp(79);
    try {
      a.captureUndo("first office");
      expect(a.sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo();
      trapAfter(engine(), "serialize", false);
      a.captureUndo("second office");
      await settle();
      expect(a.sim.build("office", 2, 190).ok).toBe(true); // the drag goes on, on TypeScript
      a.commitUndo();
      expect(offices(a)).toEqual([170, 190]);
      a.undo();
      expect(offices(a)).toEqual([170]);
      a.undo();
      expect(a.toasts).toEqual(["Undid: second office", "Nothing to undo."]);
    } finally {
      h.stop();
    }
  });

  it("says only that the engine stopped when a load lets go of a tower whose engine traps, though edits went with it", async () => {
    const { a, h, engine } = setUp(80);
    try {
      a.captureUndo("office");
      expect(a.sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo(); // paused: no point covers it
      trapAfter(engine(), "commuteStress", false);
      a.adoptSim(Simulation.newGame(81, "classic")); // a load: letting the old tower go traps
      expect(h.status.lastFallback).toEqual({ reason: "other", stage: "start" });
      await settle();
      // The load dropped the old tower's changes itself, so the line does not
      // say the engine lost them.
      expect(a.sim.log[a.sim.log.length - 1]).toEqual(expect.objectContaining({ text: REPLACED, kind: "bad" }));
      expect(a.sim.log.filter((e) => e.text.startsWith("The WASM engine stopped"))).toHaveLength(1);
      a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
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
      // The undo itself is the player's, but its redo step is gone, so the
      // line says changes were lost.
      expect(a.sim.log[a.sim.log.length - 1]).toEqual(expect.objectContaining({ text: LOST, kind: "bad" }));
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
      expect(a.sim.log[a.sim.log.length - 1]).toEqual(expect.objectContaining({ text: REPLACED, kind: "bad" }));
      a.redo();
      expect(a.toasts).toEqual(["Undid: office", "Redid: office"]);
      expect(offices(a)).toEqual([170, 180]);
      deliver();
      expect(tally(delivered)).toEqual({ ...SET_UP, "facility_placed office": 2 });
    } finally {
      h.stop();
    }
  });

  it("says changes were lost when an undo's own snapshot traps after a rename no point covers", async () => {
    const { a, h, engine } = setUp(76);
    try {
      const sim = a.sim;
      a.captureUndo("office");
      expect(sim.build("office", 2, 180).ok).toBe(true);
      a.commitUndo();
      new FrameDriver(sim, 3).frame(); // the merge covers the office
      sim.tower.towerName = "Sky Plaza"; // a rename: no undo capture, and no point after it
      trapAfter(engine(), "serialize", false);
      a.undo();
      expect(h.status.lastFallback).toEqual({ reason: "trap-undo", stage: "start" });
      await settle();
      expect(a.sim.log[a.sim.log.length - 1]).toEqual(expect.objectContaining({ text: LOST, kind: "bad" }));
      expect(a.sim.tower.towerName).toBe("Tower One");
      expect(offices(a)).toEqual([170]);
      // The redo step is the merge's point: the office, under the old name.
      a.redo();
      expect(a.toasts).toEqual(["Undid: office", "Redid: office"]);
      expect(offices(a)).toEqual([170, 180]);
      expect(a.sim.tower.towerName).toBe("Tower One");
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

  it("keeps the redo trail a trapped edit cleared, so the trails show nothing of the lost edit", async () => {
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
      a.commitUndo(); // clears the redo trail, which the history holds
      await settle();
      expectRolledBack(a, sim, good, UNDONE);
      expect(offices(a)).toEqual([170]);
      a.redo();
      expect(offices(a)).toEqual([170, 180]);
      a.undo();
      a.undo();
      expect(a.toasts).toEqual(["Undid: first office", "Redid: first office", "Undid: first office", "Nothing to undo."]);
    } finally {
      h.stop();
    }
  });

  it("clears the undo trail when the recovery goes back past the newest point (#1126)", async () => {
    const { a, h, engine } = setUp(75);
    const load = vi.spyOn(Simulation, "deserialize");
    try {
      const sim = a.sim;
      a.captureUndo("Build office");
      expect(sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo();
      h.current()!.syncStructure(); // a merge covers the office: the older point
      expect(sim.build("office", 2, 180).ok).toBe(true);
      sim.serialize(); // a hosted save covers the second: the newest point
      trapAfter(engine(), "tick");
      sim.tick(1);
      load.mockImplementationOnce(() => {
        throw new Error("the newest point does not load");
      });
      await settle();
      expect(h.status.restorePoint).toEqual({ point: "merge", skipped: 1 });
      expect(a.sim.log[a.sim.log.length - 1].text).toBe(OLDER);
      expect(offices(a)).toEqual([170, 190]);
      // The trail is gone, the step older than the tower with it.
      a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
      expect(offices(a)).toEqual([170, 190]);
    } finally {
      load.mockRestore();
      h.stop();
    }
  });

  it("clears the undo trail when an undo's own snapshot goes back past the newest point (#1126)", async () => {
    const { a, h, engine } = setUp(77);
    const load = vi.spyOn(Simulation, "deserialize");
    try {
      const sim = a.sim;
      a.captureUndo("Build office");
      expect(sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo();
      h.current()!.syncStructure(); // a merge covers the office: the older point
      sim.tower.towerName = "Sky Plaza";
      sim.serialize(); // a hosted save covers the rename: the newest point
      trapAfter(engine(), "serialize", false);
      load.mockImplementationOnce(() => {
        throw new Error("the newest point does not load");
      });
      a.undo(); // the snapshot for its redo step goes back to the merge
      await settle();
      expect(h.status.restorePoint).toEqual({ point: "merge", skipped: 1 });
      // The tower is the undo's target, as the player asked; only the trail goes.
      expect(a.sim.log[a.sim.log.length - 1].text).toBe(CLEARED);
      expect(offices(a)).toEqual([170]);
      // Kept, that redo step would bring back the merge's tower, without the rename.
      a.redo();
      expect(a.toasts).toEqual(["Undid: Build office", "Nothing to redo."]);
      expect(offices(a)).toEqual([170]);
    } finally {
      load.mockRestore();
      h.stop();
    }
  });

  it("goes back to the point an undo capture's save answered with, though the newest would load now (#1126)", async () => {
    const { a, h, engine } = setUp(79);
    const load = vi.spyOn(Simulation, "deserialize");
    try {
      const sim = a.sim;
      h.current()!.syncStructure(); // a merge: the older point
      sim.tower.towerName = "Sky Plaza";
      sim.serialize(); // a hosted save covers the rename: the newest point
      trapAfter(engine(), "serialize", false);
      load.mockImplementationOnce(() => {
        throw new Error("the newest point does not load");
      });
      a.captureUndo("Build office"); // its save traps and answers with the merge
      expect(sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo();
      await settle();
      // The recovery lands where the capture's step does, without the rename.
      expect(h.status.restorePoint).toEqual({ point: "merge", skipped: 1 });
      expect(a.sim.log[a.sim.log.length - 1].text).toBe(OLDER);
      expect(a.sim.tower.towerName).toBe("Tower One");
      expect(offices(a)).toEqual([170]);
      a.undo();
      expect(a.toasts).toEqual(["Nothing to undo."]);
    } finally {
      load.mockRestore();
      h.stop();
    }
  });

  it("clears the undo trail when a redo's own snapshot goes back past the newest point (#1126)", async () => {
    const { a, h, engine } = setUp(78);
    const load = vi.spyOn(Simulation, "deserialize");
    try {
      a.captureUndo("Build office");
      expect(a.sim.build("office", 2, 190).ok).toBe(true);
      a.commitUndo();
      a.undo(); // healthy: a redo trail, on a new engine
      const sim = a.sim;
      h.current()!.syncStructure(); // a merge: the older point
      sim.tower.towerName = "Sky Plaza";
      sim.serialize(); // a hosted save covers the rename: the newest point
      trapAfter(engine(), "serialize", false);
      load.mockImplementationOnce(() => {
        throw new Error("the newest point does not load");
      });
      a.redo(); // the snapshot for its undo step goes back to the merge
      await settle();
      expect(h.status.restorePoint).toEqual({ point: "merge", skipped: 1 });
      expect(a.sim.log[a.sim.log.length - 1].text).toBe(CLEARED);
      expect(offices(a)).toEqual([170, 190]);
      // Kept, that undo step would bring back the merge's tower, without the rename.
      a.undo();
      expect(a.toasts).toEqual(["Undid: Build office", "Redid: Build office", "Nothing to undo."]);
      expect(offices(a)).toEqual([170, 190]);
    } finally {
      load.mockRestore();
      h.stop();
    }
  });
});

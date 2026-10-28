import { describe, it, expect } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import { UndoHistory, towerStateSig } from "../../engine/UndoHistory";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { createAppHistory } from "../../game/appHistory";
import { TsEngine } from "../../engine/port/tsEngine";

// A tiny in-memory "world" so the stack logic can be exercised with no
// simulation at all — the snapshot is just the JSON of a single number.
function fakeHistory() {
  let world = { v: 0 };
  const notes: string[] = [];
  const hist = new UndoHistory({
    snapshot: () => JSON.stringify(world),
    restore: (s) => {
      world = JSON.parse(s) as { v: number };
      return Promise.resolve();
    },
    signature: () => String(world.v),
    notify: (m) => notes.push(m),
  });
  return { hist, notes, set: (v: number) => (world.v = v), get: () => world.v };
}

// The fake world fingerprints a snapshot as its number.
const sigOf = (s: string) => String((JSON.parse(s) as { v: number }).v);

describe("UndoHistory — stack semantics", () => {
  it("commits a step only when the signature actually changed", async () => {
    const { hist, notes, set } = fakeHistory();
    hist.capture("noop");
    hist.commit(); // nothing changed → no step recorded
    await hist.undo();
    expect(notes[notes.length - 1]).toBe("Nothing to undo.");

    hist.capture("change");
    set(1);
    hist.commit(); // changed → one step
    await hist.undo();
    expect(notes[notes.length - 1]).toBe("Undid: change");
  });

  it("undoes then redoes in order, restoring each snapshot", async () => {
    const { hist, set, get } = fakeHistory();
    hist.capture("a");
    set(5);
    hist.commit();
    hist.capture("b");
    set(9);
    hist.commit();
    expect(get()).toBe(9);
    await hist.undo();
    expect(get()).toBe(5);
    await hist.undo();
    expect(get()).toBe(0);
    await hist.undo(); // nothing left: the value stays put
    expect(get()).toBe(0);
    await hist.redo();
    expect(get()).toBe(5);
    await hist.redo();
    expect(get()).toBe(9);
  });

  it("a fresh action invalidates the redo trail", async () => {
    const { hist, notes, set, get } = fakeHistory();
    hist.capture("a");
    set(1);
    hist.commit();
    await hist.undo(); // back to 0, redo now available
    expect(get()).toBe(0);
    hist.capture("b");
    set(2);
    hist.commit(); // fresh action clears redo
    await hist.redo();
    expect(notes[notes.length - 1]).toBe("Nothing to redo.");
    expect(get()).toBe(2);
  });

  it("caps the trail at 40 steps", async () => {
    const { hist, set, get } = fakeHistory();
    for (let i = 1; i <= 45; i++) {
      hist.capture(`s${i}`);
      set(i);
      hist.commit();
    }
    // Values were strictly increasing, so each successful undo lowers the value;
    // once the trail is exhausted the value stops changing.
    let undos = 0;
    let prev = get();
    for (;;) {
      await hist.undo();
      if (get() === prev) break;
      prev = get();
      undos++;
    }
    expect(undos).toBe(40);
  });

  it("clear() drops the whole trail (a different tower must not be undoable)", async () => {
    const { hist, notes, set, get } = fakeHistory();
    hist.capture("a");
    set(7);
    hist.commit();
    hist.clear();
    await hist.undo();
    expect(notes[notes.length - 1]).toBe("Nothing to undo.");
    expect(get()).toBe(7); // no restore happened
  });
});

describe("UndoHistory.dropUnchanged (#874)", () => {
  function withSigOf() {
    let world = { v: 0 };
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(world),
      restore: (s) => {
        world = JSON.parse(s) as { v: number };
        return Promise.resolve();
      },
      signature: () => String(world.v),
      notify: (m) => notes.push(m),
    });
    return { hist, notes, set: (v: number) => (world.v = v) };
  }

  // The redo trails the history holds, on either stack: what the hold costs.
  function heldTrails(hist: UndoHistory): number {
    const stacks = hist as unknown as { undoStack: { cleared?: unknown }[]; redoStack: { cleared?: unknown }[] };
    return [...stacks.undoStack, ...stacks.redoStack].filter((e) => e.cleared).length;
  }

  it("drops the newest steps that would change nothing now, and keeps the rest", async () => {
    const { hist, notes, set } = withSigOf();
    hist.capture("a");
    set(1);
    hist.commit();
    hist.capture("b");
    set(2);
    hist.commit();
    // A fallback put the world back to the state "b" captured, before "b".
    set(1);
    hist.dropUnchanged(sigOf);
    await hist.undo();
    expect(notes).toEqual(["Undid: a"]);
    await hist.undo();
    expect(notes[notes.length - 1]).toBe("Nothing to undo.");
  });

  it("drops a redo step that would redo nothing, and keeps one that would not", async () => {
    let world = { v: 0 };
    // A frozen host's snapshot answers with its newest restore point.
    let point: string | null = null;
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => point ?? JSON.stringify(world),
      restore: (s) => {
        world = JSON.parse(s) as { v: number };
        return Promise.resolve();
      },
      signature: () => String(world.v),
      notify: (m) => notes.push(m),
    });
    hist.capture("a");
    world.v = 1;
    hist.commit();
    // The undo's own snapshot traps: its redo step is the point, the state
    // before "a", which is where the undo goes.
    point = JSON.stringify({ v: 0 });
    await hist.undo();
    hist.dropUnchanged(sigOf);
    await hist.redo();
    expect(notes).toEqual(["Undid: a", "Nothing to redo."]);
    // A point from after "a" redoes it.
    point = null;
    hist.capture("b");
    world.v = 2;
    hist.commit();
    point = JSON.stringify({ v: 2 });
    await hist.undo();
    hist.dropUnchanged(sigOf);
    await hist.redo();
    expect(notes.slice(2)).toEqual(["Undid: b", "Redid: b"]);
    expect(world.v).toBe(2);
  });

  it("fingerprints a gesture's capture again from its own snapshot, so a release after the fallback leaves no empty step", async () => {
    let world = { v: 0 };
    // A frozen host's snapshot answers with its newest restore point.
    let point: string | null = null;
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => point ?? JSON.stringify(world),
      restore: (s) => {
        world = JSON.parse(s) as { v: number };
        return Promise.resolve();
      },
      signature: () => String(world.v),
      notify: (m) => notes.push(m),
    });
    hist.capture("a");
    world.v = 1;
    hist.commit();
    // A press: its capture's save traps, so it takes the point from before
    // "a", while the frozen tower still shows "a".
    point = JSON.stringify({ v: 0 });
    hist.capture("b");
    point = null;
    world.v = 0; // the fallback goes back to that point
    expect(hist.dropUnchanged(sigOf)).toBe(1);
    hist.commit(); // the release, with nothing done since
    await hist.undo();
    expect(notes).toEqual(["Nothing to undo."]);
    // A capture that read the tower itself keeps its fingerprint, so what
    // the gesture does after the tidy is one step.
    hist.capture("c");
    world.v = 2;
    expect(hist.dropUnchanged(sigOf)).toBe(0);
    hist.commit();
    await hist.undo();
    expect(notes.slice(1)).toEqual(["Undid: c"]);
    expect(world.v).toBe(0);
  });

  it("puts back the redo steps a dropped step's commit cleared, while the hold is on", async () => {
    const { hist, notes, set } = withSigOf();
    hist.holdClearedRedo = true;
    hist.capture("a");
    set(1);
    hist.commit();
    await hist.undo(); // a redo trail: "a"
    hist.capture("b");
    set(2);
    hist.commit(); // clears it, and holds it with "b"
    set(0); // a fallback put the world back to the state "b" captured
    expect(hist.dropUnchanged(sigOf)).toBe(1);
    await hist.redo();
    expect(notes).toEqual(["Undid: a", "Redid: a"]);
    expect(notes).toHaveLength(2);
  });

  it("puts back the cleared redo steps under two dropped steps", async () => {
    const { hist, notes, set } = withSigOf();
    hist.holdClearedRedo = true;
    hist.capture("a");
    set(1);
    hist.commit();
    await hist.undo();
    hist.capture("b");
    set(2);
    hist.commit(); // holds the "a" redo step
    // The next capture's save traps: its snapshot is the point "b" captured.
    set(0);
    hist.capture("c");
    set(3);
    hist.commit();
    set(0); // the fallback goes back to that point
    expect(hist.dropUnchanged(sigOf)).toBe(2);
    await hist.redo();
    expect(notes).toEqual(["Undid: a", "Redid: a"]);
  });

  it("forgets the held redo steps when the player undoes the step that holds them", async () => {
    const { hist, notes, set } = withSigOf();
    hist.holdClearedRedo = true;
    hist.capture("a");
    set(1);
    hist.commit();
    await hist.undo();
    hist.capture("b");
    set(2);
    hist.commit();
    expect(heldTrails(hist)).toBe(1);
    await hist.undo();
    expect(heldTrails(hist)).toBe(0); // the undone step's trail goes with it
    expect(hist.dropUnchanged(sigOf)).toBe(0);
    await hist.redo();
    await hist.redo();
    expect(notes).toEqual(["Undid: a", "Undid: b", "Redid: b", "Nothing to redo."]);
  });

  it("holds one cleared trail at a time: a later commit that clears a trail lets the older one go", async () => {
    const { hist, notes, set } = withSigOf();
    hist.holdClearedRedo = true;
    hist.capture("a");
    set(1);
    hist.commit();
    await hist.undo(); // a redo trail: "a"
    hist.capture("b");
    set(2);
    hist.commit(); // holds the "a" redo step
    hist.capture("c");
    set(3);
    hist.commit();
    await hist.undo(); // a redo trail: "c"
    hist.capture("d");
    set(4);
    hist.commit(); // holds the "c" redo step, and lets "a" go
    expect(heldTrails(hist)).toBe(1);
    await hist.undo();
    // Put the world back to before "b" by hand: no fallback reaches that far
    // back, since the undo of "c" read a point after "b".
    set(0);
    expect(hist.dropUnchanged(sigOf)).toBe(1);
    await hist.redo();
    await hist.redo();
    expect(notes).toEqual(["Undid: a", "Undid: c", "Undid: d", "Redid: d", "Nothing to redo."]);
  });

  it("lets the held trail go when the hold turns off", async () => {
    const { hist, notes, set } = withSigOf();
    hist.holdClearedRedo = true;
    hist.capture("a");
    set(1);
    hist.commit();
    await hist.undo();
    hist.capture("b");
    set(2);
    hist.commit(); // holds the "a" redo step
    hist.holdClearedRedo = false;
    expect(hist.holdClearedRedo).toBe(false);
    expect(heldTrails(hist)).toBe(0);
    set(0);
    expect(hist.dropUnchanged(sigOf)).toBe(1);
    await hist.redo();
    expect(notes).toEqual(["Undid: a", "Nothing to redo."]);
  });

  it("clears the redo trail for good while the hold is off, as main does", async () => {
    const { hist, notes, set } = withSigOf();
    hist.capture("a");
    set(1);
    hist.commit();
    await hist.undo();
    hist.capture("b");
    set(2);
    hist.commit();
    set(0);
    expect(hist.dropUnchanged(sigOf)).toBe(1);
    await hist.redo();
    expect(notes).toEqual(["Undid: a", "Nothing to redo."]);
  });

  it("keeps every step when the world differs from the newest one", async () => {
    const { hist, notes, set } = withSigOf();
    hist.capture("a");
    set(1);
    hist.commit();
    set(5);
    hist.dropUnchanged(sigOf);
    await hist.undo();
    expect(notes).toEqual(["Undid: a"]);
  });
});

describe("UndoHistory + Simulation — round-trip", () => {
  it("restores the exact serialized sim on undo", async () => {
    let sim = newSeededGame(7);
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(sim.serialize()),
      restore: (s) => {
        sim = Simulation.deserialize(JSON.parse(s));
        return Promise.resolve();
      },
      signature: () => towerStateSig(sim.tower, sim.money),
      notify: (m) => notes.push(m),
    });

    const before = sim.serialize();
    const cx = Math.floor(GRID.width / 2);
    hist.capture("Build");
    expect(sim.tower.place("floor", 2, cx).ok).toBe(true);
    hist.commit();
    expect(sim.serialize()).not.toEqual(before); // mutated

    await hist.undo();
    expect(sim.serialize()).toEqual(before); // restored exactly
    expect(notes[notes.length - 1]).toBe("Undid: Build");
  });

  it("undo of a build preserves a bridging toggle changed afterward (a setting, not a build step)", async () => {
    // The app's history through the port: `restore` carries the live
    // autoBridge across, so undoing a BUILD never silently flips a Settings
    // toggle the player changed after that build (Codex P2).
    const enginePort = new TsEngine(Simulation.newGame(3, "modern", "realWorld"));
    const hist = createAppHistory({ enginePort, ui: { toast: () => {} }, followSwap: () => {} });
    const cx = Math.floor(GRID.width / 2);
    hist.capture("Build"); // snapshot taken while bridging is on
    expect(enginePort.sim.tower.place("lobby", 1, cx).ok).toBe(true); // ground lobby: the first valid placement
    hist.commit();
    enginePort.sim.autoBridge = false; // player turns bridging off AFTER the build
    await hist.undo();
    expect(enginePort.sim.tower.unitAt(1, cx)).toBeUndefined(); // the build is undone
    expect(enginePort.sim.autoBridge).toBe(false); // preserved, not reverted to the snapshot's on
  });

});

import { describe, it, expect } from "vitest";
import { UndoHistory } from "../../engine/UndoHistory";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { createAppHistory } from "../../game/appHistory";
import { createTsSim } from "../../simport/tsSim";

// How an undo or a redo behaves when its restore settles late or fails
// (slice 5, #1212): the steps pop in order before anything settles, a step
// that cannot load goes, and the way back stays only when the tower moved.
// Each case wires a small in-memory world, as the stack tests beside it do.

describe("UndoHistory: restores that settle late or fail (slice 5)", () => {
  it("starts each restore inside its call, says the notice once it settles, and none when it fails", async () => {
    let world = { v: 0 };
    const notes: string[] = [];
    let fail = false;
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(world),
      restore: (s) => {
        if (fail) return Promise.reject(new Error("no load"));
        world = JSON.parse(s) as { v: number };
        return Promise.resolve();
      },
      signature: () => String(world.v),
      notify: (m) => notes.push(m),
    });
    hist.capture("a");
    world.v = 1;
    hist.commit();
    hist.capture("b");
    world.v = 2;
    hist.commit();
    // Two undos in one task pop two steps, in order, before either settles.
    const first = hist.undo();
    const second = hist.undo();
    expect(world.v).toBe(0);
    expect(notes).toEqual([]);
    await Promise.all([first, second]);
    expect(notes).toEqual(["Undid: b", "Undid: a"]);
    fail = true;
    await expect(hist.redo()).rejects.toThrow("no load");
    expect(notes).toEqual(["Undid: b", "Undid: a"]);
    // The step that cannot load is gone, and no step of the unchanged tower
    // took its place on the other trail: the next redo is "b", and one undo
    // from there reaches the start.
    expect(world.v).toBe(0);
    fail = false;
    await hist.redo();
    expect(world.v).toBe(2);
    await hist.undo();
    expect(world.v).toBe(0);
    await hist.undo();
    expect(notes.slice(2)).toEqual(["Redid: b", "Undid: b", "Nothing to undo."]);
  });

  it("drops a failed step's unchanged way back even when a later undo sits on it", async () => {
    let world = { v: 0 };
    const notes: string[] = [];
    const fails: boolean[] = [];
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(world),
      restore: (s) => {
        if (fails.shift()) return Promise.reject(new Error("no load"));
        world = JSON.parse(s) as { v: number };
        return Promise.resolve();
      },
      signature: () => String(world.v),
      notify: (m) => notes.push(m),
    });
    for (const [label, v] of [["a", 1], ["b", 2], ["c", 3]] as const) {
      hist.capture(label);
      world.v = v;
      hist.commit();
    }
    // Two undos in one task: the first cannot load and leaves the tower at 3,
    // the second goes back to 1.
    fails.push(true, false);
    const first = hist.undo();
    const second = hist.undo();
    await expect(first).rejects.toThrow("no load");
    await second;
    expect(world.v).toBe(1);
    await hist.redo();
    expect(world.v).toBe(3);
    await hist.redo();
    await hist.undo();
    await hist.undo();
    await hist.undo();
    expect(world.v).toBe(0);
    expect(notes).toEqual(["Undid: b", "Redid: b", "Nothing to redo.", "Undid: b", "Undid: a", "Nothing to undo."]);
  });

  it("keeps the way back when a restore swapped the tower before it failed", async () => {
    let world = { v: 0 };
    let generation = 1;
    let fail = false;
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(world),
      restore: (s) => {
        world = JSON.parse(s) as { v: number };
        generation++;
        return fail ? Promise.reject(new Error("no adopt")) : Promise.resolve();
      },
      signature: () => String(world.v),
      generation: () => generation,
      notify: (m) => notes.push(m),
    });
    hist.capture("a");
    world.v = 1;
    hist.commit();
    fail = true;
    await expect(hist.undo()).rejects.toThrow("no adopt");
    expect(world.v).toBe(0);
    fail = false;
    await hist.redo();
    expect(world.v).toBe(1);
    await hist.undo();
    expect(world.v).toBe(0);
    expect(notes).toEqual(["Redid: a", "Undid: a"]);
  });

  it("keeps the step when its snapshot throws, and rejects when its restore throws", async () => {
    let world = { v: 0 };
    let boom: "snapshot" | "restore" | null = null;
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => {
        if (boom === "snapshot") throw new Error("no save");
        return JSON.stringify(world);
      },
      restore: (s) => {
        if (boom === "restore") throw new Error("no load");
        world = JSON.parse(s) as { v: number };
        return Promise.resolve();
      },
      signature: () => String(world.v),
      notify: (m) => notes.push(m),
    });
    hist.capture("a");
    world.v = 1;
    hist.commit();
    boom = "snapshot";
    await expect(hist.undo()).rejects.toThrow("no save");
    expect(world.v).toBe(1);
    boom = "restore";
    let undo!: Promise<void>;
    expect(() => (undo = hist.undo())).not.toThrow();
    await expect(undo).rejects.toThrow("no load");
    boom = null;
    await hist.undo();
    await hist.redo();
    expect(world.v).toBe(1);
    expect(notes).toEqual(["Nothing to undo.", "Nothing to redo."]);
  });

  it("settles a failed restore cleanly after a new step cleared the trail it pushed onto", async () => {
    let world = { v: 0 };
    const notes: string[] = [];
    let settle!: (ok: boolean) => void;
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(world),
      restore: (s) => {
        world = JSON.parse(s) as { v: number };
        return new Promise<void>((resolve, reject) => (settle = (ok) => (ok ? resolve() : reject(new Error("no load")))));
      },
      signature: () => String(world.v),
      notify: (m) => notes.push(m),
    });
    hist.capture("a");
    world.v = 1;
    hist.commit();
    const undo = hist.undo();
    // A new gesture lands while the restore is out; its commit clears the
    // redo trail the undo pushed onto.
    hist.capture("c");
    world.v = 5;
    hist.commit();
    settle(false);
    await expect(undo).rejects.toThrow("no load");
    const next = hist.undo();
    settle(true);
    await next;
    expect(world.v).toBe(0);
    await hist.undo();
    const again = hist.redo();
    settle(true);
    await again;
    expect(world.v).toBe(5);
    expect(notes).toEqual(["Undid: c", "Nothing to undo.", "Redid: c"]);
  });

  it("keeps the way back through the app's history when the adopt throws after the swap", async () => {
    let sim = Simulation.newGame(3, "modern", "realWorld");
    let throwing = false;
    const port = createTsSim(() => sim, {
      adopt: (next) => {
        sim = next;
        if (throwing) throw new Error("no attach");
      },
    });
    const notes: string[] = [];
    const hist = createAppHistory({ port, ui: { toast: (m) => void notes.push(m) } });
    const cx = Math.floor(GRID.width / 2);
    hist.capture("Build");
    expect(sim.tower.place("lobby", 1, cx).ok).toBe(true);
    hist.commit();
    throwing = true;
    await expect(hist.undo()).rejects.toThrow("no attach");
    expect(sim.tower.unitAt(1, cx)).toBeUndefined();
    throwing = false;
    await hist.redo();
    expect(sim.tower.unitAt(1, cx)).toBeDefined();
    expect(notes).toEqual(["Redid: Build"]);
  });
});

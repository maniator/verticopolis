import { describe, it, expect } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import { UndoHistory, towerStateSig } from "../../engine/UndoHistory";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";

// A tiny in-memory "world" so the stack logic can be exercised with no
// simulation at all — the snapshot is just the JSON of a single number.
function fakeHistory() {
  let world = { v: 0 };
  const notes: string[] = [];
  const hist = new UndoHistory({
    snapshot: () => JSON.stringify(world),
    restore: (s) => {
      world = JSON.parse(s) as { v: number };
    },
    signature: () => String(world.v),
    notify: (m) => notes.push(m),
  });
  return { hist, notes, set: (v: number) => (world.v = v), get: () => world.v };
}

describe("UndoHistory — stack semantics", () => {
  it("commits a step only when the signature actually changed", () => {
    const { hist, notes, set } = fakeHistory();
    hist.capture("noop");
    hist.commit(); // nothing changed → no step recorded
    hist.undo();
    expect(notes[notes.length - 1]).toBe("Nothing to undo.");

    hist.capture("change");
    set(1);
    hist.commit(); // changed → one step
    hist.undo();
    expect(notes[notes.length - 1]).toBe("Undid: change");
  });

  it("undoes then redoes in order, restoring each snapshot", () => {
    const { hist, set, get } = fakeHistory();
    hist.capture("a");
    set(5);
    hist.commit();
    hist.capture("b");
    set(9);
    hist.commit();
    expect(get()).toBe(9);
    hist.undo();
    expect(get()).toBe(5);
    hist.undo();
    expect(get()).toBe(0);
    hist.undo(); // nothing left — value stays put
    expect(get()).toBe(0);
    hist.redo();
    expect(get()).toBe(5);
    hist.redo();
    expect(get()).toBe(9);
  });

  it("a fresh action invalidates the redo trail", () => {
    const { hist, notes, set, get } = fakeHistory();
    hist.capture("a");
    set(1);
    hist.commit();
    hist.undo(); // back to 0, redo now available
    expect(get()).toBe(0);
    hist.capture("b");
    set(2);
    hist.commit(); // fresh action clears redo
    hist.redo();
    expect(notes[notes.length - 1]).toBe("Nothing to redo.");
    expect(get()).toBe(2);
  });

  it("caps the trail at 40 steps", () => {
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
      hist.undo();
      if (get() === prev) break;
      prev = get();
      undos++;
    }
    expect(undos).toBe(40);
  });

  it("clear() drops the whole trail (a different tower must not be undoable)", () => {
    const { hist, notes, set, get } = fakeHistory();
    hist.capture("a");
    set(7);
    hist.commit();
    hist.clear();
    hist.undo();
    expect(notes[notes.length - 1]).toBe("Nothing to undo.");
    expect(get()).toBe(7); // no restore happened
  });
});

describe("UndoHistory.dropUnchanged (#874)", () => {
  // The fake world fingerprints a snapshot as its number.
  function withSigOf() {
    let world = { v: 0 };
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(world),
      restore: (s) => {
        world = JSON.parse(s) as { v: number };
      },
      signature: () => String(world.v),
      signatureOf: (s) => String((JSON.parse(s) as { v: number }).v),
      notify: (m) => notes.push(m),
    });
    return { hist, notes, set: (v: number) => (world.v = v) };
  }

  it("drops the newest steps that would change nothing now, and keeps the rest", () => {
    const { hist, notes, set } = withSigOf();
    hist.capture("a");
    set(1);
    hist.commit();
    hist.capture("b");
    set(2);
    hist.commit();
    // A fallback put the world back to the state "b" captured, before "b".
    set(1);
    hist.dropUnchanged();
    hist.undo();
    expect(notes).toEqual(["Undid: a"]);
    hist.undo();
    expect(notes[notes.length - 1]).toBe("Nothing to undo.");
  });

  it("drops a redo step that would redo nothing, and keeps one that would not", () => {
    let world = { v: 0 };
    // A frozen host's snapshot answers with its newest restore point.
    let point: string | null = null;
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => point ?? JSON.stringify(world),
      restore: (s) => {
        world = JSON.parse(s) as { v: number };
      },
      signature: () => String(world.v),
      signatureOf: (s) => String((JSON.parse(s) as { v: number }).v),
      notify: (m) => notes.push(m),
    });
    hist.capture("a");
    world.v = 1;
    hist.commit();
    // The undo's own snapshot traps: its redo step is the point, the state
    // before "a", which is where the undo goes.
    point = JSON.stringify({ v: 0 });
    hist.undo();
    hist.dropUnchanged();
    hist.redo();
    expect(notes).toEqual(["Undid: a", "Nothing to redo."]);
    // A point from after "a" redoes it.
    point = null;
    hist.capture("b");
    world.v = 2;
    hist.commit();
    point = JSON.stringify({ v: 2 });
    hist.undo();
    hist.dropUnchanged();
    hist.redo();
    expect(notes.slice(2)).toEqual(["Undid: b", "Redid: b"]);
    expect(world.v).toBe(2);
  });

  it("keeps every step when the world differs from the newest one", () => {
    const { hist, notes, set } = withSigOf();
    hist.capture("a");
    set(1);
    hist.commit();
    set(5);
    hist.dropUnchanged();
    hist.undo();
    expect(notes).toEqual(["Undid: a"]);
  });

  it("does nothing without a way to fingerprint a snapshot", () => {
    const { hist, notes, set } = fakeHistory();
    hist.capture("a");
    set(1);
    hist.commit();
    set(0);
    hist.dropUnchanged();
    hist.undo();
    expect(notes).toEqual(["Undid: a"]);
  });
});

describe("towerStateSig", () => {
  it("includes money but not the clock", () => {
    const sim = newSeededGame(1);
    const FIXED = 500_000; // hold money constant so we isolate the clock's effect
    const sig0 = towerStateSig(sim.tower, FIXED);
    const units0 = sim.tower.units.length;

    sim.tick(30); // advance only the clock
    expect(sim.tower.units.length).toBe(units0); // structure unchanged
    expect(towerStateSig(sim.tower, FIXED)).toBe(sig0); // clock is not in the sig

    expect(towerStateSig(sim.tower, FIXED + 1)).not.toBe(sig0); // money is
  });

  it("changes when structure is added", () => {
    const sim = newSeededGame(1);
    const cx = Math.floor(GRID.width / 2);
    const sig0 = towerStateSig(sim.tower, sim.money);
    expect(sim.tower.place("floor", 2, cx).ok).toBe(true); // supported by the starter lobby
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });

  it("changes when a unit is renamed", () => {
    const sim = newSeededGame(1);
    const cx = Math.floor(GRID.width / 2);
    for (let x = cx - 10; x <= cx + 10; x++) sim.tower.place("floor", 2, x);
    expect(sim.build("office", 2, cx).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const sig0 = towerStateSig(sim.tower, sim.money);
    office.label = "Penthouse";
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });

  it("changes when a unit's No Rate flag flips (taking it off the market is undoable)", () => {
    // An Average unit keeps rent undefined, so the No Rate toggle can be the
    // ONLY mutation of a gesture; without noRate in the signature, commitUndo
    // would drop that edit as a no-op and Ctrl+Z could not restore the market
    // state. Pin it, like the subtype reroll below.
    const sim = newSeededGame(1, "classic");
    const cx = Math.floor(GRID.width / 2);
    for (let x = cx - 10; x <= cx + 10; x++) sim.tower.place("floor", 2, x);
    expect(sim.build("office", 2, cx).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(office.rent).toBeUndefined(); // precondition: Average, no stored override
    const sig0 = towerStateSig(sim.tower, sim.money);
    office.noRate = true;
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });

  it("changes when a shaft's schedule is set (the Schedule dialog's OK is undoable)", () => {
    // Setting the schedule can be the ONLY mutation of a gesture (the dialog's
    // apply writes nothing else), so a signature blind to it would drop the
    // "Set elevator schedule" undo step as a no-op. Pin it, like noRate above.
    const sim = newSeededGame(1);
    sim.money = 1e12;
    const cx = Math.floor(GRID.width / 2);
    for (let x = cx - 10; x <= cx + 10; x++) sim.tower.place("floor", 2, x);
    expect(sim.buildTransport("elevatorStandard", cx, 1, 2).ok).toBe(true);
    const shaft = sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
    const sig0 = towerStateSig(sim.tower, sim.money);
    expect(sim.tower.setSchedule(shaft.id, { waitingCarResponse: 5 })).toBe(true);
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });

  it("changes when a retail unit's canon subtype rerolls (Change variety is undoable)", () => {
    // Without subtype in the signature, commitUndo would drop the reroll step
    // (see towerStateSig) so the player couldn't undo a Change variety. Pin it.
    const sim = newSeededGame(1);
    sim.money = 1e12;
    sim.star = 5;
    const cx = Math.floor(GRID.width / 2);
    for (let x = cx - 20; x <= cx + 20; x++) sim.tower.place("floor", 2, x);
    sim.buildTransport("elevatorStandard", cx, 1, 2);
    expect(sim.build("shop", 2, cx).ok).toBe(true);
    const shop = sim.tower.units.find((u) => u.kind === "shop")!;
    const sig0 = towerStateSig(sim.tower, sim.money);
    expect(sim.rerollSubtype(shop.id)).toBeDefined();
    expect(towerStateSig(sim.tower, sim.money)).not.toBe(sig0);
  });
});

describe("UndoHistory + Simulation — round-trip", () => {
  it("restores the exact serialized sim on undo", () => {
    let sim = newSeededGame(7);
    const notes: string[] = [];
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(sim.serialize()),
      restore: (s) => {
        sim = Simulation.deserialize(JSON.parse(s));
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

    hist.undo();
    expect(sim.serialize()).toEqual(before); // restored exactly
    expect(notes[notes.length - 1]).toBe("Undid: Build");
  });

  it("undo of a build preserves a bridging toggle changed afterward (a setting, not a build step)", () => {
    // Mirrors GameApp.adoptSim's preserveHistory path: the restore carries the
    // live autoBridge across, so undoing a BUILD never silently flips a Settings
    // toggle the player changed after that build (Codex P2).
    let sim = Simulation.newGame(3, "modern", "realWorld");
    const hist = new UndoHistory({
      snapshot: () => JSON.stringify(sim.serialize()),
      restore: (s) => {
        const autoBridge = sim.autoBridge;
        sim = Simulation.deserialize(JSON.parse(s));
        sim.autoBridge = autoBridge;
      },
      signature: () => towerStateSig(sim.tower, sim.money),
      notify: () => {},
    });
    const cx = Math.floor(GRID.width / 2);
    hist.capture("Build"); // snapshot taken while bridging is on
    expect(sim.tower.place("lobby", 1, cx).ok).toBe(true); // ground lobby: the first valid placement
    hist.commit();
    sim.autoBridge = false; // player turns bridging off AFTER the build
    hist.undo();
    expect(sim.autoBridge).toBe(false); // preserved, not reverted to the snapshot's on
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import type { GameplayEvent } from "../../engine/gameplayEvents";
import { startWasmHost, type WasmHostApp, type WasmHostHandle, type WasmHostOptions } from "../../wasmhost/startWasmHost";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { FIXTURES, FrameDriver, loadFixture } from "../dualrun/dualRunHarness";
import { freePoisoned, trapAfter } from "./wasmTraps";

/**
 * The runtime fallback (#874; spec-874-runtime-fallback.md) on the real
 * engine, with traps injected at the binding boundary (`wasmTraps.ts`).
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

afterEach(freePoisoned);

/** GameApp's adopt as far as the host sees it: the new tower inherits what
 *  the old one still owed. Undo and redo snapshot the tower, as GameApp's
 *  history does. */
function app(sim: Simulation): WasmHostApp & { adopted: Simulation[]; undoSnapshots: unknown[] } {
  const a = {
    sim,
    adopted: [] as Simulation[],
    undoSnapshots: [] as unknown[],
    adoptSim(next: Simulation) {
      next.gameplayEvents.inherit(a.sim.gameplayEvents);
      a.sim = next;
      a.adopted.push(next);
    },
    undo() {
      a.undoSnapshots.push(a.sim.serialize());
    },
    redo() {
      a.undoSnapshots.push(a.sim.serialize());
    },
  };
  return a;
}

const quiet = () => ({ info: vi.fn(), error: vi.fn() });
const settle = () => new Promise((r) => setTimeout(r, 0));

function host(a: WasmHostApp, opts: WasmHostOptions = {}): WasmHostHandle & { fallbacks: unknown[] } {
  const fallbacks: unknown[] = [];
  const h = startWasmHost(a, wasm(), quiet(), { ...opts, onFallback: (f) => fallbacks.push(f) });
  return Object.assign(h, { fallbacks });
}

/** A small Classic tower with a lobby, built through the host. */
function smallTower(sim: Simulation): void {
  sim.money = 1e9;
  for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
}

const ownSerialize = (sim: Simulation) => Object.prototype.hasOwnProperty.call(sim, "serialize");

describe.skipIf(!hasWasmPackage())("WASM host runtime fallback (#874)", () => {
  it("falls back from a command that traps after the engine changed, to the last merge", async () => {
    const a = app(Simulation.newGame(41, "classic"));
    const h = host(a);
    try {
      const sim = a.sim;
      smallTower(sim);
      new FrameDriver(sim, 3).run(30);
      const before = { minutes: sim.clock.minutes, units: sim.tower.units.length };
      const merges = h.current()!.merges;
      expect(merges).toBeGreaterThan(0);
      trapAfter(h.current()!.engine, "build");
      // The caller gets the instance's answer, and nothing throws.
      expect(sim.build("office", 2, 175).ok).toBe(true);
      expect(h.status).toMatchObject({ hosted: false, fallbacks: 1, lastFallback: { reason: "trap-command", stage: "start" } });
      expect(h.status.lastError).toMatch(/failed during a command: unreachable/);
      expect(h.fallbacks).toEqual([{ reason: "trap-command", stage: "start" }]);
      // Frozen until the call returns: a tick moves nothing, and a save is
      // the restore point, the last merge's save, without the office.
      sim.tick(1);
      expect(sim.clock.minutes).toBe(before.minutes);
      const save = sim.serialize();
      expect(save.units).toHaveLength(before.units);
      await settle();
      expect(a.adopted).toHaveLength(1);
      const fresh = a.sim;
      expect(fresh).not.toBe(sim);
      expect(ownSerialize(fresh)).toBe(false);
      // The tower is the save's, and the rollback is at most one game hour
      // (the engine's hour pass merges every hour).
      expect(fresh.clock.minutes).toBe(save.minutes);
      expect(fresh.money).toBe(save.money);
      expect(before.minutes - fresh.clock.minutes).toBeGreaterThanOrEqual(0);
      expect(before.minutes - fresh.clock.minutes).toBeLessThanOrEqual(60);
      expect(fresh.tower.units).toHaveLength(before.units);
      expect(fresh.log[fresh.log.length - 1]).toMatchObject({
        text: "The WASM engine stopped, so the tower went back to its last good state and your recent changes were undone. It runs on the TypeScript engine now.",
        kind: "bad",
      });
      // The TypeScript engine runs it now.
      new FrameDriver(fresh, 3).run(60);
      expect(fresh.clock.minutes).toBeGreaterThan(before.minutes);
      expect(h.current()).toBeNull();
    } finally {
      h.stop();
    }
  });

  it("falls back from a tick that traps with a live crowd, and keeps none of the read model's people", async () => {
    const a = app(loadFixture(FIXTURES[0]));
    const h = host(a);
    try {
      const sim = a.sim;
      const driver = new FrameDriver(sim, 3);
      for (let i = 0; i < 40 && sim.crowd.people.length === 0; i++) driver.run(60);
      const people = new Set(sim.crowd.people);
      expect(people.size).toBeGreaterThan(0);
      const frozenAt = sim.clock.minutes;
      trapAfter(h.current()!.engine, "tick");
      driver.frame(); // the first step traps; the frame's later steps do nothing
      driver.frame();
      expect(sim.clock.minutes).toBe(frozenAt);
      expect(h.status.lastFallback).toEqual({ reason: "trap-tick", stage: "start" });
      await settle();
      const fresh = a.sim;
      expect(fresh).not.toBe(sim);
      expect(fresh.clock.minutes).toBeLessThanOrEqual(frozenAt);
      expect(frozenAt - fresh.clock.minutes).toBeLessThanOrEqual(60); // at most a game hour back
      expect(fresh.crowd.people.some((p) => people.has(p))).toBe(false);
      expect(fresh.crowd.people).toHaveLength(0); // a save carries no crowd
      const resume = new FrameDriver(fresh, 3);
      for (let i = 0; i < 40 && fresh.crowd.people.length === 0; i++) resume.run(60);
      expect(fresh.crowd.people.length).toBeGreaterThan(0);
    } finally {
      h.stop();
    }
  }, 120_000);

  it("records one fallback and one recovery however many paths fault after it", async () => {
    const a = app(Simulation.newGame(42, "classic"));
    const h = host(a);
    try {
      const sim = a.sim;
      smallTower(sim);
      const engine = h.current()!.engine;
      trapAfter(engine, "tick");
      sim.tick(1);
      // Every path on the frozen instance answers without reaching the engine.
      expect(sim.build("office", 2, 175).ok).toBe(true);
      expect(() => sim.serialize()).not.toThrow();
      expect(() => sim.drainGameplayEvents()).not.toThrow();
      expect(() => sim.gameplayEventsDropped).not.toThrow();
      expect(() => h.current()!.flush()).not.toThrow();
      expect(() => h.current()!.syncStructure()).not.toThrow();
      sim.tick(1);
      expect(h.status.fallbacks).toBe(1);
      expect(h.fallbacks).toHaveLength(1);
      await settle();
      await settle();
      expect(a.adopted).toHaveLength(1);
      // The fresh tower stays on TypeScript, and later towers do too.
      a.adoptSim(Simulation.newGame(43, "classic"));
      expect(h.status.hosted).toBe(false);
      expect(h.current()).toBeNull();
      expect(ownSerialize(a.sim)).toBe(false);
    } finally {
      h.stop();
    }
  });

  it("delivers every event once, a lost command's none, and goes back to the last merge", async () => {
    const a = app(Simulation.newGame(44, "classic"));
    const h = host(a);
    try {
      const sim = a.sim;
      const delivered: GameplayEvent[] = [...sim.drainGameplayEvents()];
      sim.money = 1e9;
      expect(sim.build("lobby", 1, 180).ok).toBe(true);
      sim.tick(1); // merges the lobby
      delivered.push(...sim.drainGameplayEvents());
      expect(sim.build("lobby", 1, 181).ok).toBe(true); // emitted, held for a point
      trapAfter(h.current()!.engine, "tick");
      sim.tick(1);
      // A save between the fault and the recovery is the last merge's: the
      // first lobby only. The second is lost with the fallback.
      const save = sim.serialize();
      expect(save.units.filter((u) => u.kind === "lobby")).toHaveLength(1);
      await settle();
      const fresh = a.sim;
      delivered.push(...fresh.drainGameplayEvents());
      // Its event never comes out: the fallback undid the build, and the
      // player's next try counts once.
      expect(delivered.filter((e) => e.name === "facility_placed")).toHaveLength(1);
      expect(delivered.filter((e) => e.name === "tower_founded")).toHaveLength(1);
      expect(fresh.gameplayEventsDropped).toBe(0);
      expect(fresh.tower.units.filter((u) => u.kind === "lobby")).toHaveLength(1);
      // The TypeScript engine replays from the merge and emits none of them
      // again.
      new FrameDriver(fresh, 3).run(30);
      expect(fresh.drainGameplayEvents().filter((e) => e.name === "facility_placed" || e.name === "tower_founded")).toEqual([]);
    } finally {
      h.stop();
    }
  });

  it("stops a wasm-only build through onFatal, once, and adopts no TypeScript tower", async () => {
    const a = app(Simulation.newGame(45, "classic"));
    const onFatal = vi.fn();
    const h = host(a, { strict: true, onFatal });
    try {
      const sim = a.sim;
      smallTower(sim);
      trapAfter(h.current()!.engine, "tick");
      sim.tick(1);
      sim.tick(1);
      expect(sim.build("office", 2, 175).ok).toBe(true);
      await settle();
      expect(onFatal).toHaveBeenCalledTimes(1);
      expect(onFatal.mock.calls[0][1]).toBe("trap-tick");
      expect(a.adopted).toHaveLength(0);
      expect(a.sim).toBe(sim);
      expect(h.status).toMatchObject({ hosted: false, fallbacks: 1 });
    } finally {
      h.stop();
    }
  });

  it("codes a fault inside an undo or a redo as trap-undo, and a plain save fault as other", async () => {
    for (const [run, reason] of [["undo", "trap-undo"], ["redo", "trap-undo"], ["save", "other"]] as const) {
      const a = app(Simulation.newGame(46, "classic"));
      const h = host(a);
      try {
        smallTower(a.sim);
        trapAfter(h.current()!.engine, "serialize", false);
        if (run === "save") a.sim.serialize();
        else a[run]!();
        expect(h.status.lastFallback, run).toEqual({ reason, stage: "start" });
        await settle();
        expect(a.adopted, run).toHaveLength(1);
      } finally {
        h.stop();
      }
    }
  });

  it("falls back from a trap in the coalesced host's flush", async () => {
    const a = app(Simulation.newGame(47, "classic"));
    const h = host(a, { sync: "frame" });
    try {
      const sim = a.sim;
      smallTower(sim);
      sim.tick(1);
      trapAfter(h.current()!.engine, "frameView", false);
      h.current()!.flush();
      expect(h.status.lastFallback).toEqual({ reason: "trap-tick", stage: "start" });
      await settle();
      expect(a.adopted).toHaveLength(1);
    } finally {
      h.stop();
    }
  });

  it("skips the recovery when a load replaced the faulted tower first", async () => {
    const a = app(Simulation.newGame(48, "classic"));
    const h = host(a);
    try {
      trapAfter(h.current()!.engine, "tick");
      a.sim.tick(1);
      const loaded = Simulation.newGame(49, "classic");
      a.adoptSim(loaded); // the player loads a tower before the microtask runs
      await settle();
      expect(a.sim).toBe(loaded);
      expect(a.adopted).toEqual([loaded]);
      expect(h.status.hosted).toBe(false);
    } finally {
      h.stop();
    }
  });
});

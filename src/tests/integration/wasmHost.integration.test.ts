import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { canonicalJson } from "../../engine/canonicalJson";
import { stateView } from "../../engine/conformanceView";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { FIXTURES, FrameDriver, loadFixture } from "../dualrun/dualRunHarness";

/**
 * The read-model gate of story-engine-wasm-switch: with the WASM engine
 * ticking and the TypeScript instance refreshed from it, the instance's own
 * state view (what the renderer, the panels and the save see) equals the
 * engine's at every hour of a day, on every fixture, and the crowd the
 * renderer draws matches the engine's people.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const DAY = 24 * 60;

/** The instance's own view of itself, from its fields (its `serialize` is
 *  the engine's while hosted, so the prototype's is used here). */
function ownStateView(sim: Simulation): string {
  const own = Object.getOwnPropertyDescriptor(sim, "serialize");
  if (own) delete (sim as Partial<Simulation>).serialize;
  try {
    return canonicalJson(stateView(sim));
  } finally {
    if (own) Object.defineProperty(sim, "serialize", own);
  }
}

function peopleOf(sim: Simulation): unknown[] {
  return sim.crowd.people.map((p) => ({ id: p.id, seed: p.seed, state: p.state, floor: p.floor, x: p.x, fy: p.fy, staff: p.staff ?? false }));
}

function enginePeople(json: string): unknown[] {
  const view = JSON.parse(json) as { people: { id: number; seed: number; state: string; floor: number; x: number; fy: number; staff?: boolean }[] };
  return view.people.map((p) => ({ id: p.id, seed: p.seed, state: p.state, floor: p.floor, x: p.x, fy: p.fy, staff: p.staff ?? false }));
}

function day(sim: Simulation, speed: number): void {
  const host = attachWasmHost(sim, wasm());
  const driver = new FrameDriver(sim, speed);
  let lastHour = -1;
  let lastLogSeq = sim.logSeq;
  let compared = 0;
  const from = sim.clock.minutes;
  while (sim.clock.minutes - from < DAY) {
    driver.frame();
    const hour = Math.floor(sim.clock.minutes / 60);
    if (hour !== lastHour) {
      lastHour = hour;
      // The log as the frames appended it, before a merge: the engine's ring
      // entry for entry, and the instance's cursor never moving backwards.
      const ring = (JSON.parse(host.engine.serialize()) as { log: unknown[] }).log;
      expect(sim.log, `hour ${hour} log`).toEqual(ring);
      expect(sim.logSeq, `hour ${hour} logSeq`).toBeGreaterThanOrEqual(lastLogSeq);
      lastLogSeq = sim.logSeq;
      host.syncStructure();
      expect(ownStateView(sim), `hour ${hour}`).toBe(host.engine.stateView());
      expect(peopleOf(sim), `hour ${hour} people`).toEqual(enginePeople(host.engine.crowdView()));
      compared++;
    }
  }
  expect(compared).toBeGreaterThanOrEqual(24);
  expect(host.frames).toBeGreaterThan(0);
  expect(host.merges).toBeGreaterThanOrEqual(24);
  host.detach();
}

describe.skipIf(!hasWasmPackage())("WASM host: the read model follows the engine", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture} for a day at the fastest speed`, () => day(loadFixture(fixture), 3), 120_000);
  }
  it("a new game of each mode", () => {
    day(Simulation.newGame(11, "classic"), 3);
    day(Simulation.newGame(12, "modern"), 3);
  }, 120_000);

  it("relays the host's edits and answers them as the TypeScript engine does", () => {
    const sim = Simulation.newGame(31, "classic");
    const host = attachWasmHost(sim, wasm());
    sim.money = 1e9;
    for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
    expect(sim.build("office", 2, 175).ok).toBe(true);
    expect(sim.buildTransport("stairs", 170, 1, 2).ok).toBe(true);
    expect(sim.build("office", 1, 175).ok).toBe(false);
    sim.tower.towerName = "Hosted";
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(sim.tower.setLabel(office.id, "  Corner  ")).toBe(true);
    sim.emit("a note from the host", "info");
    new FrameDriver(sim, 3).run(90);
    // The lines the instance logged for its own commands and the engine's
    // lines for the same commands are one log, not two.
    expect(sim.log).toEqual((JSON.parse(host.engine.serialize()) as { log: unknown[] }).log);
    host.syncStructure();
    expect(ownStateView(sim)).toBe(host.engine.stateView());
    // The instance's save is the engine's.
    expect(canonicalJson(sim.serialize())).toBe(canonicalJson(JSON.parse(host.engine.serialize())));
    host.detach();
    // Detached, the instance is a plain TypeScript simulation again.
    expect(Object.getOwnPropertyDescriptor(sim, "serialize")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(sim, "money")?.value).toBeDefined();
  });

  it("refuses a tower whose crowd already exists", () => {
    const sim = loadFixture("src/tests/fixtures/towerone-star4.vctower");
    sim.tick(60);
    expect(sim.crowd.people.length).toBeGreaterThan(0);
    expect(() => attachWasmHost(sim, wasm())).toThrow(/crowd/);
    expect(Object.getOwnPropertyDescriptor(sim, "money")?.value).toBeDefined();
  });
});

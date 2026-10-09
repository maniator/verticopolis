import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Simulation } from "../../engine/Simulation";
import type { SerializedGame } from "../../engine/serializedGame";
import type { StepDebt } from "../../engine/sim/fixedStep";
import { markFounderFromLoadedFile } from "../../engine/sim/founderStatus";
import { decodeVctower } from "../../storage/vctowerContainer";
import { SPEEDS, advanceOwedMinutes } from "../../game/frameLoop";
import { attachMirror, loadCommand } from "../../dualrun/mirror";
import { ShadowEngine } from "../../dualrun/shadow";
import type { Divergence, ShadowCommand } from "../../dualrun/commands";
import { canonicalJson } from "../../engine/canonicalJson";
import { REPO_ROOT } from "../conformance/scenario";
import { wasm } from "../conformance/wasmEngine";

/**
 * The dual run in Node: the live TypeScript simulation driven exactly as the
 * web frame loop drives it (`runFrame`'s owed-minute math and the engine's
 * fixed step), the WASM shadow fed by the same mirror the browser uses, and
 * the two compared at every hour. This is the day gate of
 * story-engine-dual-run, run in CI where the browser run cannot be.
 */

/** The frame times a session sees, in milliseconds: the reference rate,
 *  a 30 Hz device, a 120 Hz one, a long hitch past the catch-up cap, and a
 *  tab restored after a pause. Cycled so every branch of the host's owed-
 *  minute math runs, the cap included. */
export const FRAME_TIMES_MS = [1000 / 60, 1000 / 60, 1000 / 30, 1000 / 120, 1000 / 60, 400, 1000 / 60, 1000 / 60, 3000, 1000 / 60];

/** The game's own frame: the web host's `advanceOwedMinutes`, the function
 *  `runFrame` itself calls, driven with a cycle of frame times. */
export class FrameDriver {
  readonly host: { sim: Simulation; accMinutes: number };
  private readonly debt: StepDebt = { minutes: 0 };
  private frames = 0;
  constructor(sim: Simulation, readonly speed: number, readonly steadyClock = false, readonly frameTimes = FRAME_TIMES_MS) {
    this.host = { sim, accMinutes: 0 };
  }

  frame(): void {
    const dtMs = this.frameTimes[this.frames++ % this.frameTimes.length];
    advanceOwedMinutes(this.host, this.debt, dtMs, SPEEDS[this.speed] ?? 0, this.steadyClock);
  }

  /** Run frames until the sim clock has advanced `minutes`. */
  run(minutes: number): void {
    const sim = this.host.sim;
    const until = sim.clock.minutes + minutes;
    let frames = 0;
    while (sim.clock.minutes < until) {
      this.frame();
      if (++frames > minutes * 600) throw new Error("the frame loop is not advancing the clock");
    }
  }
}

export interface DualRunReport {
  checkpoints: number;
  divergences: Divergence[];
  commands: number;
  /** Gameplay events compared (the live engine's count), and every batch
   *  where the shadow's drained events differ from the live engine's. */
  events: number;
  eventDivergences: { label: string; live: string; shadow: string }[];
}

/** A live simulation paired with its shadow through the mirror. */
export class DualRun {
  readonly shadow = new ShadowEngine(wasm());
  readonly report: DualRunReport = { checkpoints: 0, divergences: [], commands: 0, events: 0, eventDivergences: [] };
  private detach: (() => void) | null = null;
  sim!: Simulation;

  private gen = 0;

  /** Follow a simulation: the shadow loads its save and boundary markers,
   *  then the mirror attaches. */
  follow(sim: Simulation): this {
    // The load command refuses a tower it cannot shadow (its crowd already
    // exists); take it first, so that refusal leaves the run following its
    // old tower. A shadow that then refuses the save itself fails the test.
    const load = loadCommand(sim, this.gen + 1);
    if (this.detach) this.compareEvents("before a new tower");
    this.detach?.();
    this.detach = null;
    this.sim = sim;
    this.gen++;
    this.shadow.apply(load);
    // What the tower emitted before the shadow existed (its founding, edits
    // made before it was adopted) has no counterpart there.
    sim.drainGameplayEvents();
    this.detach = attachMirror(sim, (cmd) => this.sink(cmd), this.gen);
    return this;
  }

  /** Found a game and follow it. */
  static found(seed: number, mode: "classic" | "modern", modernCalendar: "realWorld" | "canon" = "realWorld", startUnbridged = false): { sim: Simulation; run: DualRun } {
    const sim = Simulation.newGame(seed, mode, modernCalendar, startUnbridged);
    return { sim, run: new DualRun().follow(sim) };
  }

  private sink(cmd: ShadowCommand): void {
    this.report.commands++;
    const d = this.shadow.apply(cmd);
    if (cmd.op === "checkpoint") {
      this.report.checkpoints++;
      if (d) this.report.divergences.push(d);
      this.compareEvents(cmd.label);
    }
  }

  /** Drain both engines and compare the batches, byte for byte. */
  private compareEvents(label: string): void {
    const live = this.sim.drainGameplayEvents();
    const shadow = JSON.parse(this.shadow.handle().drainGameplayEvents()) as unknown[];
    this.report.events += live.length;
    const a = canonicalJson(live);
    const b = canonicalJson(shadow);
    if (a !== b) this.report.eventDivergences.push({ label, live: a, shadow: b });
  }

  /** The undo path: the app drops the live sim and adopts one rebuilt from
   *  a snapshot, keeping the bridging toggle. */
  restore(snapshot: string): Simulation {
    const restored = Simulation.deserialize(JSON.parse(snapshot) as SerializedGame);
    restored.autoBridge = this.sim.autoBridge;
    this.follow(restored);
    return restored;
  }

  stop(): DualRunReport {
    if (this.detach) this.compareEvents("stop");
    this.detach?.();
    this.detach = null;
    this.shadow.free();
    return this.report;
  }
}

/** Load a fixture the way the import path does. */
export function loadFixture(file: string): Simulation {
  const raw = decodeVctower(readFileSync(resolve(REPO_ROOT, file), "utf8"), file) as SerializedGame;
  const sim = Simulation.deserialize(raw);
  markFounderFromLoadedFile(sim, raw);
  return sim;
}

/** Every save under the fixtures directory, so a new one is covered. */
export const FIXTURES = readdirSync(resolve(REPO_ROOT, "src/tests/fixtures"))
  .filter((f) => f.endsWith(".vctower"))
  .sort()
  .map((f) => `src/tests/fixtures/${f}`);

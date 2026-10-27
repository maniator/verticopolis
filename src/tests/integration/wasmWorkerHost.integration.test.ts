import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { canonicalJson } from "../../engine/canonicalJson";
import { buildScenarios } from "../perfCompare/scenarios";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";
import { framePeople, frameMotion, frames, fromSave, host, ownStateView, script, type HostKind, type Hosted } from "../wasmWorker/hostDriver";
import { drain } from "../wasmWorker/channel";
import { stepGate } from "../../wasmhost/stepGate";
import { advanceOwedMinutes, SPEEDS } from "../../game/frameLoop";
import { ShadowEngine } from "../../dualrun/shadow";
import { loadCommand } from "../../dualrun/mirror";
import { wasm } from "../conformance/wasmEngine";
import type { ToWorker } from "../../wasmhost/workerProtocol";

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

/**
 * The experimental hosts against the shipped one, on the real package: the
 * same steps and commands on the step host (synced after every step), the
 * coalesced main-thread host and the worker host must leave the engine in
 * the same state (its exact save), and the read model the renderer draws
 * from in the same state, with the same log and the same gameplay events.
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const SCENARIOS = buildScenarios();

/** Edits any tower takes: money, a note, the name, the bridge toggle, a
 *  view stamp, a star check. */
function edits(step: number, sim: Simulation): void {
  if (step === 8) sim.money = sim.money + 250_000;
  if (step === 16) sim.emit("a note from the host", "info");
  if (step === 24) sim.tower.towerName = "Worker Tower";
  if (step === 32) sim.toggleAutoBridge();
  if (step === 40) sim.view = { tile: 140, floor: 3, zoom: 1.5 };
  if (step === 48) sim.evaluateStar();
}

interface Outcome {
  save: string;
  state: string;
  people: string;
  motion: string;
  log: string;
  events: string;
  money: number;
  minutes: number;
}

async function outcome(h: Hosted): Promise<Outcome> {
  const save = canonicalJson(await h.exactSave());
  return {
    save,
    state: ownStateView(h.sim),
    people: JSON.stringify(framePeople(h.sim)),
    motion: JSON.stringify(frameMotion(h.sim)),
    log: JSON.stringify(h.sim.log),
    events: JSON.stringify(h.sim.drainGameplayEvents()),
    money: h.sim.money,
    minutes: h.sim.clock.minutes,
  };
}

async function run(kind: HostKind, save: string, steps: number, at = edits): Promise<Outcome> {
  const h = await host(kind, fromSave(save));
  try {
    await script(h, steps, at);
    const out = await outcome(h);
    if (h.worker) {
      expect(h.worker.fatal, "worker failures").toEqual([]);
      expect(h.worker.errors, "worker op errors").toEqual([]);
      // An hour pass went out as a full save or a delta, so the comparison
      // covers the save half, not only the frames.
      expect(h.worker.host.stats.deltas + h.worker.host.stats.merges, "an hour pass was synced").toBeGreaterThan(0);
    }
    return out;
  } finally {
    h.detach();
  }
}

describe.skipIf(!hasWasmPackage())("the worker and coalesced hosts against the step host", () => {
  for (const sc of SCENARIOS) {
    const steps = sc.name === "large" ? 96 : 240;
    it(`${sc.name}: the same engine state, read model, log and events`, async () => {
      const step = await run("step", sc.save, steps);
      const frame = await run("frame", sc.save, steps);
      const worker = await run("worker", sc.save, steps);
      for (const [name, other] of [["frame", frame], ["worker", worker]] as const) {
        expect(other.minutes, `${name} clock`).toBe(step.minutes);
        expect(other.save, `${name} engine save`).toBe(step.save);
        expect(other.state, `${name} read model`).toBe(step.state);
        expect(other.people, `${name} crowd`).toBe(step.people);
        expect(other.motion, `${name} cars and counters`).toBe(step.motion);
        expect(other.log, `${name} log`).toBe(step.log);
        expect(other.events, `${name} events`).toBe(step.events);
        expect(other.money, `${name} money`).toBe(step.money);
      }
    }, 300_000);
  }

  it("builds on a new game answer as on the step host, and the engine agrees", async () => {
    const build = (step: number, sim: Simulation) => {
      if (step === 0) {
        sim.money = 1e9;
        for (let x = 170; x < 200; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
      }
      if (step === 4) {
        for (let x = 170; x < 200; x++) expect(sim.build("floor", 2, x).ok).toBe(true);
        expect(sim.build("office", 2, 180).ok).toBe(true);
        expect(sim.build("office", 1, 175).ok).toBe(false);
      }
      if (step === 8) {
        expect(sim.buildTransport("elevatorStandard", 172, 1, 2).ok).toBe(true);
        const shaft = sim.tower.transportAt(1, 172)!;
        expect(sim.setCars(shaft.id, 2)).toBe(true);
      }
      if (step === 12) expect(sim.sellAt(2, 199)).toBe(true);
    };
    const save = JSON.stringify(Simulation.newGame(41, "classic").serialize());
    const step = await run("step", save, 120, build);
    const worker = await run("worker", save, 120, build);
    expect(worker.save).toBe(step.save);
    expect(worker.state).toBe(step.state);
    expect(worker.events).toBe(step.events);
    expect(JSON.parse(worker.events).filter((e: { name: string }) => e.name === "facility_placed").length).toBeGreaterThan(60);
  }, 120_000);

  it("a reply older than a command leaves the command's money alone, and the next one includes it", async () => {
    const h = await host("worker", fromSave(SCENARIOS[0].save));
    try {
      await script(h, 8);
      const sim = h.sim;
      for (let s = 0; s < 4; s++) sim.tick(2);
      stepGate(sim)!.flush(); // a request for those steps is in flight
      const before = h.worker!.host.stats.staleReplies;
      sim.money = 123_456_789; // the command lands after the request
      await drain();
      expect(h.worker!.host.stats.staleReplies).toBe(before + 1);
      expect(sim.money, "the stale reply's money did not overwrite the command's").toBe(123_456_789);
      await h.sync();
      const save = (await h.exactSave()) as { money: number };
      expect(save.money).toBe(123_456_789);
    } finally {
      h.detach();
    }
  }, 60_000);

  it("holds steps back while a batch is in flight, sends nothing while paused, and its clock is the frame loop's", async () => {
    const h = await host("worker", fromSave(SCENARIOS[0].save));
    try {
      const gate = stepGate(h.sim)!;
      const ch = h.worker!.channel;
      expect(gate.canStep()).toBe(true);
      const t0 = h.sim.clock.minutes;
      h.sim.tick(3);
      expect(h.sim.clock.minutes, "the clock moves at the step, before any reply").toBe(t0 + 3);
      gate.flush();
      expect(gate.canStep(), "in flight").toBe(false);
      await h.sync();
      expect(gate.canStep()).toBe(true);
      // Paused: no steps, no commands, nothing to send.
      const sent = ch.sent.length;
      for (let f = 0; f < 10; f++) gate.flush();
      await drain();
      expect(ch.sent.length).toBe(sent);
      // A command while paused goes out, and the next flush asks for it.
      h.sim.emit("paused note", "info");
      await drain();
      gate.flush();
      await h.sync();
      expect(last(h.sim.log)?.text).toBe("paused note");
      expect(h.sim.log.filter((e) => e.text === "paused note")).toHaveLength(1);
    } finally {
      h.detach();
    }
  }, 60_000);

  it("speed changes, a pause and a resume through the frame loop leave every host on the same tower", async () => {
    // Fastest, normal, paused (the carry drops), slow, then fastest again,
    // with the steady clock off so the pacing curve sizes the steps.
    const speeds = [...Array(120).fill(3), ...Array(90).fill(1), ...Array(30).fill(0), ...Array(90).fill(2), ...Array(120).fill(3)];
    const run2 = async (kind: HostKind) => {
      const h = await host(kind, fromSave(SCENARIOS[1].save));
      try {
        await frames(h, speeds);
        return { save: canonicalJson(await h.exactSave()), minutes: h.sim.clock.minutes, people: JSON.stringify(framePeople(h.sim)) };
      } finally {
        h.detach();
      }
    };
    const step = await run2("step");
    const worker = await run2("worker");
    const frame = await run2("frame");
    expect(step.minutes).toBeGreaterThan(fromSave(SCENARIOS[1].save).clock.minutes);
    for (const other of [worker, frame]) {
      expect(other.minutes).toBe(step.minutes);
      expect(other.save).toBe(step.save);
      expect(other.people).toBe(step.people);
    }
  }, 300_000);

  it("pipelined as in the browser (no wait for replies, banked minutes, commands landing mid-flight): the engine ends as a bare engine fed the same ops", async () => {
    const sim = fromSave(SCENARIOS[1].save);
    const start = loadCommand(sim, 0);
    const h = await host("worker", sim);
    try {
      const debt = { minutes: 0 };
      const app = { sim, accMinutes: 0 };
      let held = 0;
      for (let f = 0; f < 600; f++) {
        const gate = stepGate(sim)!;
        if (!gate.canStep()) held++;
        advanceOwedMinutes(app, debt, 1000 / 60, SPEEDS[3], false, gate.canStep());
        gate.flush();
        if (f % 37 === 5) sim.money = sim.money + 1000;
        if (f % 53 === 11) sim.emit(`note ${f}`, "info");
        if (f % 71 === 3) sim.tower.towerName = `Tower ${f}`;
        // One task turn: a reply may or may not be in by the next frame.
        await new Promise((r) => setImmediate(r));
      }
      expect(held, "frames that found a batch still in flight").toBeGreaterThan(0);
      expect(h.worker!.host.stats.staleReplies, "replies that predated a command").toBeGreaterThan(0);
      const save = canonicalJson(await h.exactSave());
      expect(h.worker!.fatal).toEqual([]);
      // The same ops, in the order sent, on a bare engine.
      const bare = new ShadowEngine(wasm());
      bare.apply(start);
      for (const m of h.worker!.channel.sent as ToWorker[]) {
        if (m.type !== "ops") continue;
        for (const op of m.ops) bare.apply("dt" in op ? { op: "tick", dt: op.dt } : op.cmd);
      }
      expect(save).toBe(canonicalJson(JSON.parse(bare.handle().serialize())));
      // And the read model, caught up, is the engine's.
      expect(ownStateView(sim)).toBe(bare.handle().stateView());
      bare.free();
    } finally {
      h.detach();
    }
  }, 300_000);

  it("saves and restores: the exact save resumes on a fresh worker as on the step host", async () => {
    const save = SCENARIOS[1].save;
    const a = await host("worker", fromSave(save));
    let mid: string;
    try {
      await script(a, 60, edits);
      mid = JSON.stringify(await a.exactSave());
    } finally {
      a.detach();
    }
    const step = await host("step", fromSave(save));
    let stepMid: string;
    try {
      await script(step, 60, edits);
      stepMid = JSON.stringify(await step.exactSave());
    } finally {
      step.detach();
    }
    expect(canonicalJson(JSON.parse(mid))).toBe(canonicalJson(JSON.parse(stepMid)));
    const resumedWorker = await run("worker", mid, 60, () => {});
    const resumedStep = await run("step", stepMid, 60, () => {});
    expect(resumedWorker.save).toBe(resumedStep.save);
    expect(resumedWorker.state).toBe(resumedStep.state);
  }, 300_000);
});

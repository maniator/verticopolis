import { describe, it, expect, vi } from "vitest";
import { Simulation } from "../engine/Simulation";
import { dualRunRequested, startDualRun, type DualRunApp } from "./dualRun";
import type { ShadowCommand } from "./commands";
import type { WorkerInit, WorkerReply } from "./worker";

/** A worker stand-in: records what it was sent and lets a test answer. */
class FakeWorker {
  sent: ShadowCommand[] = [];
  /** The package URL the controller hands over before any command. */
  init: WorkerInit | null = null;
  onmessage: ((e: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(msg: ShadowCommand | WorkerInit): void {
    if ("type" in msg && msg.type === "init") this.init = msg;
    else this.sent.push(msg as ShadowCommand);
  }
  terminate(): void { this.terminated = true; }
  reply(r: WorkerReply): void { this.onmessage?.({ data: r } as MessageEvent<WorkerReply>); }
}

function app(): DualRunApp & { adopted: Simulation[] } {
  const a = {
    sim: Simulation.newGame(1, "classic"),
    adopted: [] as Simulation[],
    adoptSim(sim: Simulation) { this.sim = sim; this.adopted.push(sim); },
  };
  return a;
}

const quiet = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

describe("dualRunRequested", () => {
  it("reads the query switch, then the storage switch, and survives a storage that throws", () => {
    expect(dualRunRequested({ search: "?dualrun=1" }, null)).toBe(true);
    expect(dualRunRequested({ search: "" }, { getItem: () => "1" })).toBe(true);
    expect(dualRunRequested({ search: "?dualrun=0" }, { getItem: () => null })).toBe(false);
    expect(dualRunRequested({ search: "" }, { getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });
});

describe("startDualRun", () => {
  it("loads the current tower, mirrors its commands, and counts the hours the worker confirms", () => {
    const a = app();
    const w = new FakeWorker();
    const run = startDualRun(a, () => w as unknown as Worker, quiet);
    expect(w.init).toMatchObject({ type: "init", url: expect.stringMatching(/engine\/verticopolis_engine\.js$/) });
    expect(w.sent[0]).toMatchObject({ op: "load", gen: 1 });
    a.sim.money = 5;
    expect(w.sent[w.sent.length - 1]).toEqual({ op: "setMoney", amount: 5 });
    w.reply({ type: "ready" });
    w.reply({ type: "ok", gen: 1, label: "day 0 08:00" });
    expect(run.status).toMatchObject({ hours: 1, starts: 1, lastLabel: "day 0 08:00", divergence: null });
    run.stop();
  });

  it("latches the first divergence and reports it once", () => {
    const a = app();
    const w = new FakeWorker();
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const run = startDualRun(a, () => w as unknown as Worker, log);
    w.reply({ type: "divergence", gen: 1, label: "day 0 09:00", view: "state", path: "$.money", live: "1", shadow: "2" });
    w.reply({ type: "divergence", gen: 1, label: "day 0 10:00", view: "crowd", path: "$.people", live: "[]", shadow: "[1]" });
    expect(run.status.divergence).toMatchObject({ label: "day 0 09:00", path: "$.money" });
    // A divergent hour was still compared, so the count keeps moving.
    expect(run.status).toMatchObject({ hours: 2, lastLabel: "day 0 10:00" });
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0][0]).toContain("$.money");
    run.stop();
  });

  it("follows an adopted tower under a new generation and ignores the old tower's late answers", () => {
    const a = app();
    const w = new FakeWorker();
    const run = startDualRun(a, () => w as unknown as Worker, quiet);
    w.reply({ type: "ok", gen: 1, label: "day 0 08:00" });
    const next = Simulation.newGame(2, "modern");
    a.adoptSim(next);
    expect(a.adopted).toEqual([next]);
    expect(w.sent[w.sent.length - 1]).toMatchObject({ op: "load", gen: 2 });
    expect(run.status).toMatchObject({ hours: 0, starts: 2, divergence: null });
    w.reply({ type: "divergence", gen: 1, label: "day 0 09:00", view: "state", path: "$.money", live: "1", shadow: "2" });
    expect(run.status.divergence).toBeNull();
    w.reply({ type: "ok", gen: 2, label: "day 0 08:00" });
    expect(run.status.hours).toBe(1);
    next.money = 7;
    expect(w.sent[w.sent.length - 1]).toEqual({ op: "setMoney", amount: 7 });
    run.stop();
  });

  it("reports a tower it cannot shadow and leaves the app's adopt intact", () => {
    const a = app();
    const w = new FakeWorker();
    const run = startDualRun(a, () => w as unknown as Worker, quiet);
    const crowded = Simulation.newGame(9, "classic");
    (crowded.crowd.people as unknown[]).push({ id: 1 });
    a.adoptSim(crowded);
    expect(a.adopted).toEqual([crowded]);
    expect(run.status.errors[0]).toMatch(/not following this tower/);
    const sent = w.sent.length;
    crowded.money = 3;
    expect(w.sent.length).toBe(sent);
    run.stop();
  });

  it("collects worker errors and, on stop, detaches, restores adoptSim and terminates", () => {
    const a = app();
    const ownAdopt = Object.getOwnPropertyDescriptor(a, "adoptSim");
    const w = new FakeWorker();
    const run = startDualRun(a, () => w as unknown as Worker, quiet);
    w.reply({ type: "error", message: "could not load" });
    w.reply({ type: "error", gen: 7, message: "an old tower's load" });
    w.onerror?.({ message: "boom" } as ErrorEvent);
    expect(run.status.errors).toEqual(["could not load", "worker error: boom"]);
    for (let i = 0; i < 60; i++) w.onerror?.({ message: `again ${i}` } as ErrorEvent);
    expect(run.status.errors).toHaveLength(50);
    expect((globalThis as { __vcDualRun?: unknown }).__vcDualRun).toBe(run);
    run.stop();
    expect(w.terminated).toBe(true);
    expect(Object.getOwnPropertyDescriptor(a, "adoptSim")).toEqual(ownAdopt);
    expect((globalThis as { __vcDualRun?: unknown }).__vcDualRun).toBeUndefined();
    const sent = w.sent.length;
    a.sim.money = 9;
    expect(w.sent.length).toBe(sent);
  });
});

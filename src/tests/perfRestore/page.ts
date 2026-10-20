/**
 * The restore-point benchmark's work in the page (#874). Self-contained for
 * `page.evaluate`, like `perfCompare/page.ts`: no imports reach the page.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Workload = "plain" | "drag" | "click" | "edits";

export interface RestoreRun {
  scenario: string;
  workload: Workload;
  steps: number;
  dt: number;
  /** Each step, timed whole: its command (if any), one `sim.tick`, and the
   *  event drain the frame loop runs every frame. */
  stepMs: number[];
  /** Commands the workload meant to issue, issued, and the tower accepted. */
  planned: number;
  commands: number;
  accepted: number;
  /** Engine saves in the timed steps. The merges' and the hosted saves'
   *  (each undo capture reads one, as it does on main) are restore points
   *  at no extra cost; any other save is one the restore points added
   *  (`extraSaves`, expected 0). */
  merges: number;
  hostedSaves: number;
  saves: number;
  extraSaves: number;
  /** Time inside `engine.serialize` in the timed steps, all saves included. */
  saveMs: number;
  /** The event pulls: calls into the engine's event exports, and the time
   *  inside them. */
  pullCalls: number;
  pullMs: number;
  /** One restore point's price on this tower: `engine.serialize`, taken
   *  five times after the steps. */
  pointSaveMs: number[];
  /** That save's length in characters. The host holds up to three such
   *  texts: the newest save, the newest merge's and the attach save. */
  pointChars: number;
  /** What a fallback pays once, at the fault: parsing the point and
   *  loading it as a TypeScript tower, three times. */
  restoreMs: number[];
  /** Without it the page's clock is coarse (about 0.1 ms), so the
   *  sub-millisecond columns are less exact. */
  crossOriginIsolated: boolean;
  /** The host faulted, let the tower go, or a measurement threw. Any of
   *  them voids the run. */
  fault: string | null;
}

/**
 * Run one workload on the hosted tower the app holds now (the runner
 * adopted the scenario just before). Every step ends with the frame loop's
 * event drain. `plain` only ticks. `drag` places one floor tile before every
 * tick, a structural command that merges at the next sync, as a floor drag
 * does. `click` adjusts a rent every `clickEvery` steps, a plain command
 * with an event. `edits` is rapid single edits: every step is a whole
 * gesture (an undo capture, one floor tile, the commit), as a player's
 * clicks are.
 */
export function restoreRun(arg: { scenario: string; workload: Workload; steps: number; warmSteps: number; dt: number; clickEvery: number }): RestoreRun {
  const w = window as any;
  const g = w.game;
  const handle = w.__vcEngine;
  const host = handle?.current?.();
  if (!host || !handle.status?.hosted) throw new Error(`${arg.scenario}: the tower is not hosted on the WASM engine`);
  const sim = g.sim;
  const engine = host.engine;
  const timed = { on: false, saves: 0, saveMs: 0, hostedSaves: 0, pullCalls: 0, pullMs: 0 };
  const wrap = (target: any, name: string, onCall: (ms: number) => void) => {
    const real = target[name].bind(target);
    Object.defineProperty(target, name, {
      value: (...args: unknown[]) => {
        const t0 = performance.now();
        try {
          return real(...args);
        } finally {
          if (timed.on) onCall(performance.now() - t0);
        }
      },
      configurable: true,
      writable: true,
    });
  };
  wrap(engine, "serialize", (ms) => {
    timed.saves++;
    timed.saveMs += ms;
  });
  for (const name of ["drainGameplayEvents", "gameplayEventsPending", "gameplayEventsDropped"]) {
    wrap(engine, name, (ms) => {
      timed.pullCalls++;
      timed.pullMs += ms;
    });
  }
  // The hosted tower's own save (the host's override), which the undo
  // capture, the autosave and an export read.
  wrap(sim, "serialize", () => timed.hostedSaves++);
  sim.money = 1e12;
  for (let i = 0; i < arg.warmSteps; i++) sim.tick(arg.dt);
  sim.drainGameplayEvents();

  // Targets, found with the tower's own checks so finding them relays nothing.
  const t = sim.tower;
  let cursor: { floor: number; x: number } | null = null;
  const nextTile = (): { floor: number; x: number } | null => {
    if (cursor && t.canPlace("floor", cursor.floor, cursor.x + 1).ok) return (cursor = { floor: cursor.floor, x: cursor.x + 1 });
    // GRID (src/engine/facilitiesData.ts): floors 100 down to -9, 375 tiles.
    for (let f = 100; f >= -9; f--) for (let x = 0; x < 375; x++) if (t.canPlace("floor", f, x).ok) return (cursor = { floor: f, x });
    return null;
  };
  // A rented room (an office first; a condo is sold, so its rent is fixed).
  const units = t.units as any[];
  const rented = units.find((u) => u.kind === "office") ?? units.find((u) => u.kind === "hotelSingle" || u.kind === "hotelDouble");
  let dir = 1;
  const plannedBy: Record<Workload, number> = { plain: 0, drag: arg.steps, click: Math.ceil(arg.steps / arg.clickEvery), edits: arg.steps };
  const planned = plannedBy[arg.workload];

  const stepMs: number[] = [];
  let commands = 0;
  let accepted = 0;
  const merges0 = host.merges;
  w.gc?.();
  timed.on = true;
  for (let i = 0; i < arg.steps; i++) {
    const target = arg.workload === "drag" || arg.workload === "edits" ? nextTile() : null;
    const click = arg.workload === "click" && rented && i % arg.clickEvery === 0;
    const t0 = performance.now();
    if (target) {
      commands++;
      if (arg.workload === "edits") g.captureUndo("perf edit");
      if (sim.build("floor", target.floor, target.x).ok) accepted++;
      if (arg.workload === "edits") g.commitUndo();
    } else if (click) {
      commands++;
      if (sim.adjustRent(rented.id, dir) !== null) accepted++;
      dir = -dir;
    }
    sim.tick(arg.dt);
    sim.drainGameplayEvents();
    stepMs.push(performance.now() - t0);
  }
  timed.on = false;
  const merges = host.merges - merges0;
  let fault: string | null = null;
  if (host.fault) fault = `${host.fault.reason}: ${host.fault.message}`;
  else if (handle.current() !== host) fault = "the host let the tower go";
  const { saves, saveMs, hostedSaves, pullCalls, pullMs } = timed;

  const pointSaveMs: number[] = [];
  const restoreMs: number[] = [];
  let pointChars = 0;
  if (!fault) {
    try {
      let text = "";
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        text = engine.serialize();
        pointSaveMs.push(performance.now() - t0);
      }
      pointChars = text.length;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        sim.constructor.deserialize(JSON.parse(text));
        restoreMs.push(performance.now() - t0);
      }
    } catch (e) {
      fault = `measuring a restore point threw: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return {
    scenario: arg.scenario,
    workload: arg.workload,
    steps: arg.steps,
    dt: arg.dt,
    stepMs,
    planned,
    commands,
    accepted,
    merges,
    hostedSaves,
    saves,
    extraSaves: saves - merges - hostedSaves,
    saveMs,
    pullCalls,
    pullMs,
    pointSaveMs,
    pointChars,
    restoreMs,
    crossOriginIsolated: Boolean(w.crossOriginIsolated),
    fault,
  };
}

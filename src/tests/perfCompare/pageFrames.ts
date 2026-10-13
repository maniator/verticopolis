/**
 * The gameplay-frame and audio functions of the engine comparison (issue
 * #972), in the page. Self-contained for `page.evaluate`, like page.ts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FrameRun {
  /** Whether the app's audio engine had started during the window. */
  audioStarted: boolean;
  intervalsMs: number[];
  wallMs: number;
  simMinutes: number;
  tickMs: number;
  ticks: number;
  uiMs: number;
  /** "wasm" only when the host held the tower from start to end with no
   *  new error (a trap mid-window drops the sample to "ts"). */
  engineActive: "ts" | "wasm";
  hostErrorsAdded: string[];
}

/**
 * Gameplay frames: the real frame loop at the fastest speed (steady clock,
 * emergencies declined through the app's own path, autosave off), sampled by
 * rAF for `windowMs` after `warmMs`. Time inside `sim.tick` and `ui.update`
 * is summed alongside, so the report can tell engine time from the rest of
 * the frame. The window is wall-clock time, so a slower engine simulates
 * fewer in-game minutes in it; the achieved sim speed is reported with it.
 */
export function measureFrames(arg: { windowMs: number; warmMs: number; speed: number }): Promise<FrameRun> {
  const w = window as any;
  const g = w.game;
  const sim = g.sim;
  const ui = g.ui;
  const host = w.__vcEngine;
  const h = host?.current?.();
  const hostedAtStart = Boolean(h) && Boolean(host?.status?.hosted) && Object.prototype.hasOwnProperty.call(sim, "serialize");
  const errorsAtStart = ((host?.status?.errors ?? []) as string[]).length;
  const ownTick = Object.getOwnPropertyDescriptor(sim, "tick");
  const ownUpdate = Object.getOwnPropertyDescriptor(ui, "update");
  const tick = sim.tick;
  const update = ui.update;
  const acc = { tick: 0, ticks: 0, ui: 0, on: false };
  sim.tick = function (this: unknown, dt: number) {
    const t = performance.now();
    try {
      return tick.call(this, dt);
    } finally {
      if (acc.on) {
        acc.tick += performance.now() - t;
        acc.ticks++;
      }
    }
  };
  ui.update = function (this: unknown, ...a: unknown[]) {
    const t = performance.now();
    try {
      return update.apply(this, a);
    } finally {
      if (acc.on) acc.ui += performance.now() - t;
    }
  };
  // A full collection first (Chromium runs with --expose-gc for both
  // engines), so the window does not inherit the load's garbage.
  (globalThis as any).gc?.();
  g.speed = arg.speed;
  g.engine.paused = false;
  return new Promise<FrameRun>((resolve) => {
    const intervals: number[] = [];
    let start = 0;
    let startMinutes = 0;
    let last = 0;
    const begin = performance.now();
    const done = (): void => {
      g.speed = 0;
      g.engine.paused = true;
      acc.on = false;
      if (ownTick) Object.defineProperty(sim, "tick", ownTick);
      else delete sim.tick;
      if (ownUpdate) Object.defineProperty(ui, "update", ownUpdate);
      else delete ui.update;
      const hostErrorsAdded = ((host?.status?.errors ?? []) as string[]).slice(errorsAtStart);
      const stillHosted = hostedAtStart && hostErrorsAdded.length === 0 && host.current() === h && Boolean(host.status.hosted) && w.game.sim === sim;
      resolve({
        audioStarted: Boolean(g.audio?.started),
        intervalsMs: intervals,
        wallMs: last - start,
        simMinutes: sim.clock.minutes - startMinutes,
        tickMs: acc.tick,
        ticks: acc.ticks,
        uiMs: acc.ui,
        engineActive: stillHosted ? "wasm" : "ts",
        hostErrorsAdded,
      });
    };
    const frame = (ts: number): void => {
      if (start === 0) {
        if (ts - begin >= arg.warmMs) {
          start = ts;
          last = ts;
          startMinutes = sim.clock.minutes;
          acc.on = true;
        }
        requestAnimationFrame(frame);
        return;
      }
      intervals.push(ts - last);
      last = ts;
      if (ts - start >= arg.windowMs) done();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

export interface AudioStatus {
  started: boolean;
  muted: boolean;
  contexts: string[];
}

/** The app's audio as it stands: whether the Tone.js engine started, the
 *  mute flag, and the state of every AudioContext the page made. */
export function audioStatus(): AudioStatus {
  const w = window as any;
  const a = w.game.audio;
  return { started: Boolean(a.started), muted: Boolean(a.muted), contexts: (w.__perfAudioContexts ?? []).map((c: { state: string }) => c.state) };
}

/**
 * Start the game's audio the way the first player gesture does
 * (`AudioEngine.start()`, which loads the Tone.js chunk), unmuted, and wait
 * up to `timeoutMs` for it to report started. The browser is launched with
 * the autoplay policy that allows audio without a gesture, for both engines.
 */
export async function startAudio(timeoutMs: number): Promise<AudioStatus> {
  const w = window as any;
  const a = w.game.audio;
  a.setMuted(false);
  a.start();
  const until = performance.now() + timeoutMs;
  while (!a.started && performance.now() < until) await new Promise((r) => setTimeout(r, 50));
  return { started: Boolean(a.started), muted: Boolean(a.muted), contexts: (w.__perfAudioContexts ?? []).map((c: { state: string }) => c.state) };
}

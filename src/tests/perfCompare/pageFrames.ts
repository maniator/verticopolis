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
  /** "wasm" only when the app's engine port was the Rust engine boot
   *  published from start to end. */
  engineActive: "ts" | "wasm";
  hostErrorsAdded: string[];
}

/**
 * Gameplay frames: the real frame loop at the fastest speed (steady clock,
 * emergencies declined through the app's own path, autosave off), sampled by
 * rAF for `windowMs` after `warmMs`. Time inside the frame's engine step
 * (the port's `advance` and the view read after it, the engine's part of a
 * frame on either engine since PR 5e) and `ui.update` is summed alongside,
 * so the report can tell engine time from the rest of the frame; `ticks`
 * counts the steps the engine ran. The window is wall-clock time, so a slower engine simulates
 * fewer in-game minutes in it; the achieved sim speed is reported with it.
 */
export function measureFrames(arg: { windowMs: number; warmMs: number; speed: number }): Promise<FrameRun> {
  const w = window as any;
  const g = w.game;
  const port = g.enginePort;
  const reader = g.reader;
  const ui = g.ui;
  const host = w.__vcEngine;
  const hosted = (): boolean => Boolean(host?.status?.hosted) && host.port === port && w.game.enginePort === port;
  const hostedAtStart = hosted();
  const ownAdvance = Object.getOwnPropertyDescriptor(port, "advance");
  const ownRead = Object.getOwnPropertyDescriptor(reader, "update");
  const ownUpdate = Object.getOwnPropertyDescriptor(ui, "update");
  const advance = port.advance;
  const read = reader.update;
  const update = ui.update;
  const acc = { tick: 0, ticks: 0, ui: 0, on: false };
  port.advance = function (this: unknown, ...a: unknown[]) {
    const t = performance.now();
    let out: Float64Array | undefined;
    try {
      out = advance.apply(this, a);
      return out;
    } finally {
      if (acc.on) {
        acc.tick += performance.now() - t;
        acc.ticks += out ? out[0] : 0;
      }
    }
  };
  reader.update = function (this: unknown, ...a: unknown[]) {
    const t = performance.now();
    try {
      return read.apply(this, a);
    } finally {
      if (acc.on) acc.tick += performance.now() - t;
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
      if (ownAdvance) Object.defineProperty(port, "advance", ownAdvance);
      else delete port.advance;
      if (ownRead) Object.defineProperty(reader, "update", ownRead);
      else delete reader.update;
      if (ownUpdate) Object.defineProperty(ui, "update", ownUpdate);
      else delete ui.update;
      const stillHosted = hostedAtStart && hosted();
      resolve({
        audioStarted: Boolean(g.audio?.started),
        intervalsMs: intervals,
        wallMs: last - start,
        simMinutes: reader.header.minutes - startMinutes,
        tickMs: acc.tick,
        ticks: acc.ticks,
        uiMs: acc.ui,
        engineActive: stillHosted ? "wasm" : "ts",
        hostErrorsAdded: [],
      });
    };
    const frame = (ts: number): void => {
      if (start === 0) {
        if (ts - begin >= arg.warmMs) {
          start = ts;
          last = ts;
          startMinutes = reader.header.minutes;
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

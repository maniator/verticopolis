/**
 * Browser-side functions for the interaction benchmark (`npm run
 * perf:interaction`). Like `src/tests/perfCompare/page.ts`, every exported
 * function is SELF-CONTAINED (no module-scope references, helpers declared
 * inside) because Playwright serializes it into `page.evaluate`. They read the
 * `window.game` handle a VC_TOOLING=1 build publishes and return plain JSON.
 *
 * The recorder keeps the app as a player meets it: the real frame loop at a
 * running speed, and autosave left in (its stall is part of what a player
 * feels). Only the title screen, the emergency prompts and the congratulation
 * dialogs are calmed so a script can drive the page. The autosave timer is
 * replaced by one autosave at a fixed point in each phase, so the stall lands
 * in the same place for both arms instead of wherever 30 s from boot falls.
 *
 * Every entry is stored with its start time and given to a phase by that time
 * when the record is collected, since the browser delivers long tasks, long
 * animation frames and Event Timing entries after the fact.
 *
 * Page errors are not collected here: the runner listens with Playwright's
 * `pageerror`, which also catches unhandled promise rejections.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A phase's window on the page clock, and the simulation's state at its ends. */
export interface PhaseWindow {
  name: string;
  start: number;
  end: number;
  simMinutesStart: number;
  simMinutesEnd: number;
  /** The game's time of day (minutes past midnight) when the window opened. */
  minuteOfDayStart: number;
}

/** What the page records for one phase. Times are milliseconds. */
export interface PhaseRecord {
  /** rAF-to-rAF intervals. */
  frames: number[];
  /** Long tasks (over 50 ms): duration each. */
  longTasks: number[];
  /** Long animation frames: duration and blocking duration each. */
  loafs: { dur: number; blocking: number }[];
  /** Slow interactions (clicks, taps and keys whose Event Timing entry is at or
   *  above 16 ms), one per interaction: the longest of its entries' durations
   *  with that entry's processing time, and the largest input delay among its
   *  entries (the delay sits mostly on the first one, which is often not the
   *  longest). */
  events: { name: string; dur: number; delay: number; proc: number }[];
  /** Every pointer, wheel and key input: the time from the event to the moment
   *  the next frame's animation callbacks run. */
  inputToFrame: number[];
  /** Timed app calls: count, total and max per label. */
  parts: Record<string, { n: number; ms: number; max: number }>;
  /** Game minutes the tower advanced during the phase. */
  simMinutes: number;
  /** The window's length on the page clock, so totals can be read per second. */
  windowMs: number;
  /** The game's time of day when the window opened. */
  minuteOfDayStart: number;
}

export interface PageRecord {
  phases: Record<string, PhaseRecord>;
  /** Whether the browser reports long animation frames (Chrome 123 and later). */
  loafSupported: boolean;
  /** Frame errors the app caught over the whole run. Counted as they are
   *  pushed, because every load and undo empties the app's own list. */
  frameErrors: number;
}

/** Load a save into the live app the way a player's load does, then calm the
 *  prompts that would stop a script, after the load (a load resets them).
 *  The save gets an `appVersion` stamp when it has none, as `stashSave`
 *  does, so the stored source does not mark it a pre-2.0 founder tower.
 *  Throws when the engine refuses the save. */
export function adoptForInteraction(save: string): { population: number; minuteOfDay: number } {
  const g = (window as any).game;
  document.getElementById("splash")?.remove();
  const parsed = JSON.parse(save) as { appVersion?: unknown };
  const stamped = JSON.stringify({ ...parsed, appVersion: parsed.appVersion ?? "2.0.0" });
  if (g.enginePort.loadSave(stamped)[0] !== 1) throw new Error("the engine refused the scenario's save");
  g.followSwap();
  g.ui.showEventChoice = (_m: string, _c: string, onResolve: (opt: "accept" | "decline") => void) => onResolve("decline");
  g.shownWin = true;
  g.shownChoice = false;
  g.shownUpdate = false;
  g.setSpeed(0);
  return { population: g.reader.header.population, minuteOfDay: g.reader.header.minuteOfDay };
}

/** Step the paused tower to the next `minute` (minutes past midnight): later
 *  today, or tomorrow when the clock is already past it, so every run starts
 *  its warm-up at the same time of day. The phases start wherever the
 *  warm-up leaves the clock, which the report lists per phase. Returns the
 *  minute reached. */
export function fastForwardTo(minute: number): number {
  const g = (window as any).game;
  const startDay = Math.floor(g.reader.header.minutes / 1440);
  const day = g.reader.header.minuteOfDay < minute ? startDay : startDay + 1;
  const target = day * 1440 + minute;
  for (let guard = 0; g.reader.header.minutes < target && guard < 20000; guard++) {
    g.enginePort.tick(2);
    g.reader.update();
  }
  return g.reader.header.minuteOfDay;
}

/** Install the observers, the input timer and the call timers, then start the
 *  tower at `speed`. Records go to `window.__interaction`. */
export function installRecorder(speed: number): { loafSupported: boolean } {
  const w = window as any;
  const g = w.game;
  const loafSupported = (PerformanceObserver.supportedEntryTypes ?? []).includes("long-animation-frame");
  const rec = {
    windows: [] as PhaseWindow[],
    open: null as PhaseWindow | null,
    frames: [] as [number, number][],
    longTasks: [] as [number, number][],
    loafs: [] as [number, number, number][],
    events: [] as [number, string, number, number, number, number][],
    inputs: [] as [number, number][],
    calls: [] as [number, string, number][],
    observers: [] as [PerformanceObserver, (e: any) => void][],
    loafSupported,
    frameErrors: 0,
    autosave: null as null | (() => unknown),
    camera: null as null | { pos: unknown; zoom: number },
  };
  w.__interaction = rec;
  // `followSwap` empties the app's frame error list on every load and undo
  // (the list keeps its identity), so the run counts each push instead.
  const errs = g.frameErrors;
  if (Array.isArray(errs)) {
    const push = errs.push.bind(errs);
    errs.push = (...items: unknown[]): number => {
      rec.frameErrors += items.length;
      return push(...items);
    };
  }
  let last = 0;
  const raf = (now: number): void => {
    if (last) rec.frames.push([now, now - last]);
    last = now;
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
  // Input to next frame: Event Timing leaves out wheel and pointer moves,
  // which are most of a pan or a zoom, so each input is timed from its event
  // time to when the next frame's animation callbacks actually run. The
  // callback reads the clock itself: its rAF timestamp is the frame's
  // planned start, which a long task can leave earlier than the input.
  for (const type of ["pointerdown", "pointermove", "pointerup", "wheel", "keydown"]) {
    w.addEventListener(
      type,
      (e: Event) => {
        const t = e.timeStamp;
        requestAnimationFrame(() => rec.inputs.push([t, performance.now() - t]));
      },
      { capture: true, passive: true },
    );
  }
  const observe = (type: string, push: (e: any) => void, opts: Record<string, unknown> = {}): void => {
    const o = new PerformanceObserver((list) => list.getEntries().forEach(push));
    o.observe({ type, ...opts } as PerformanceObserverInit);
    rec.observers.push([o, push]);
  };
  observe("longtask", (e) => rec.longTasks.push([e.startTime, e.duration]));
  if (loafSupported) observe("long-animation-frame", (e) => rec.loafs.push([e.startTime, e.duration, e.blockingDuration ?? 0]));
  // One click is several entries (pointerdown, mousedown, pointerup, mouseup,
  // click) sharing an interaction id; `collectRecord` keeps one per id.
  // Entries with no interaction id (hovers, moves) are not interactions.
  observe("event", (e) => rec.events.push([e.startTime, e.name, e.duration, e.processingStart - e.startTime, e.processingEnd - e.processingStart, e.interactionId ?? 0]), { durationThreshold: 16 });
  const time = (obj: any, key: string, label: string): (() => unknown) | null => {
    const f = obj?.[key];
    if (typeof f !== "function") return null;
    obj[key] = function (this: unknown, ...a: unknown[]) {
      const t = performance.now();
      try {
        return f.apply(this, a);
      } finally {
        rec.calls.push([t, label, performance.now() - t]);
      }
    };
    return obj[key].bind(obj);
  };
  time(g.enginePort, "advance", "engine steps");
  time(g.enginePort, "serialize", "engine serialize");
  time(g.reader, "update", "view decode");
  time(g.ui, "update", "HUD update");
  time(g.engine, "runTick", "whole frame tick");
  // The timer's autosave does nothing; `setPhase` runs the real one.
  rec.autosave = time(g.saveLoad, "autosave", "autosave");
  if (g.saveLoad) g.saveLoad.autosave = () => {};
  g.setSpeed(speed);
  return { loafSupported };
}

/** Open a phase window named `name` and run one autosave `autosaveAtMs` into
 *  it (when given), or close the open window with null. */
export function setPhase(arg: { name: string | null; autosaveAtMs?: number }): void {
  const rec = (window as any).__interaction;
  const header = (window as any).game.reader.header;
  const now = performance.now();
  if (rec.open) {
    rec.open.end = now;
    rec.open.simMinutesEnd = header.minutes;
    rec.windows.push(rec.open);
    rec.open = null;
  }
  if (arg.name === null) return;
  rec.open = { name: arg.name, start: now, end: Infinity, simMinutesStart: header.minutes, simMinutesEnd: header.minutes, minuteOfDayStart: header.minuteOfDay };
  if (arg.autosaveAtMs !== undefined && rec.autosave) setTimeout(() => rec.autosave(), arg.autosaveAtMs);
}

/** Everything recorded, each entry given to the phase whose window holds its
 *  start time. Pending observer entries are taken first. */
export function collectRecord(): PageRecord {
  const w = window as any;
  const rec = w.__interaction;
  for (const [o, push] of rec.observers) o.takeRecords().forEach(push);
  const phases: Record<string, PhaseRecord> = {};
  const windowAt = (t: number): PhaseRecord | null => {
    for (const win of rec.windows) if (t >= win.start && t < win.end) return phases[win.name];
    return null;
  };
  for (const win of rec.windows) {
    phases[win.name] = { frames: [], longTasks: [], loafs: [], events: [], inputToFrame: [], parts: {}, simMinutes: win.simMinutesEnd - win.simMinutesStart, windowMs: win.end - win.start, minuteOfDayStart: win.minuteOfDayStart };
  }
  for (const [t, dt] of rec.frames) windowAt(t)?.frames.push(dt);
  for (const [t, d] of rec.longTasks) windowAt(t)?.longTasks.push(d);
  for (const [t, d, b] of rec.loafs) windowAt(t)?.loafs.push({ dur: d, blocking: b });
  // One entry per interaction, attributed by its first entry's start: the
  // longest entry's name, duration and processing, and the largest delay.
  const byInteraction = new Map<number, { t: number; name: string; dur: number; delay: number; proc: number }>();
  for (const [t, name, dur, delay, proc, id] of rec.events) {
    if (!(id > 0)) continue;
    const seen = byInteraction.get(id);
    if (!seen) {
      byInteraction.set(id, { t, name, dur, delay, proc });
      continue;
    }
    seen.t = Math.min(t, seen.t);
    seen.delay = Math.max(delay, seen.delay);
    if (dur > seen.dur) Object.assign(seen, { name, dur, proc });
  }
  for (const e of byInteraction.values()) windowAt(e.t)?.events.push({ name: e.name, dur: e.dur, delay: e.delay, proc: e.proc });
  for (const [t, lat] of rec.inputs) windowAt(t)?.inputToFrame.push(lat);
  for (const [t, label, d] of rec.calls) {
    const p = windowAt(t);
    if (!p) continue;
    const s = (p.parts[label] ??= { n: 0, ms: 0, max: 0 });
    s.n++;
    s.ms += d;
    if (d > s.max) s.max = d;
  }
  return { phases, loafSupported: rec.loafSupported, frameErrors: rec.frameErrors };
}

/** How many offices the tower has: a placement adds one and its undo takes
 *  it away. (The tower revision would also move when the simulation removes
 *  a room on its own, such as a bomb going off.) */
export function officeCount(): number {
  // The reader's room list (rooms only, kept per revision); the tower's unit
  // list would rebuild every floor tile's view on each call after a change.
  let n = 0;
  for (const u of (window as any).game.reader.rooms) if (u.kind === "office") n++;
  return n;
}

/** Whether a dialog is open (Statistics, Saves and Settings open `#modal`). */
export function dialogOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

/** Whether the inspect tool has a room selected. */
export function hasSelection(): boolean {
  return (window as any).game.selected != null;
}

/** Drop the selection, so the next inspect click is counted on its own. */
export function clearSelection(): void {
  (window as any).game.clearSelection();
}

/** Remember the camera before a phase moves it (a pan can stop mid-stroke,
 *  the build phase can move to a free spot). */
export function saveCamera(): void {
  const rec = (window as any).__interaction;
  const cam = (window as any).game.engine.engine.currentScene.camera;
  rec.camera = { pos: cam.pos.clone(), zoom: cam.zoom };
}

/** Put the camera back where `saveCamera` found it, so every phase starts
 *  from the same view on every run. */
export function restoreCamera(): void {
  const rec = (window as any).__interaction;
  const cam = (window as any).game.engine.engine.currentScene.camera;
  if (!rec?.camera) return;
  cam.pos = rec.camera.pos;
  cam.zoom = rec.camera.zoom;
  rec.camera = null;
}

/** Up to `max` points on screen where an office would place right now (the
 *  engine's own quote, as the build preview asks it). A packed tower may have
 *  no room in view, so when the view has none the camera first moves to the
 *  highest free spot the scan finds in the tower, at the same zoom (the
 *  runner puts it back after the phase). Called before the build phase
 *  opens, so the scan is not in its numbers. */
export async function officeSpots(arg: { max: number }): Promise<{ x: number; y: number }[]> {
  const g = (window as any).game;
  const code = g.portCodes.kind("office");
  const fits = (floor: number, tile: number): boolean => g.portCodes.slot(g.enginePort.quoteBuild(code, floor, tile), "quoteBuild", "ok") === 1;
  // The renderer maps canvas coordinates; the mouse moves in page ones. Each
  // floor's row center (floor f spans world y from -f to -(f - 1) floors),
  // so a click lands inside the row the quote asked about.
  const inView = (): { x: number; y: number }[] => {
    const spots: { x: number; y: number }[] = [];
    const rect = (document.querySelector("#view") as HTMLCanvasElement).getBoundingClientRect();
    const top = g.engine.screenToFloor(rect.height * 0.2);
    const bottom = g.engine.screenToFloor(rect.height * 0.85);
    const left = g.engine.screenToTile(rect.width * 0.15);
    const right = g.engine.screenToTile(rect.width * 0.85);
    for (let floor = top; floor >= bottom && spots.length < arg.max; floor--) {
      const y = rect.top + (g.engine.worldToScreenY(floor) + g.engine.worldToScreenY(floor - 1)) / 2;
      for (let tile = left; tile <= right && spots.length < arg.max; tile += 2) {
        if (fits(floor, tile)) spots.push({ x: rect.left + g.engine.worldToScreenX(tile) + 2, y });
      }
    }
    return spots;
  };
  const here = inView();
  if (here.length) return here;
  for (let floor = 120; floor >= -10; floor--) {
    for (let tile = 0; tile < 400; tile++) {
      if (!fits(floor, tile)) continue;
      g.engine.setCamera(tile, floor, g.engine.engine.currentScene.camera.zoom);
      // The camera's screen mapping follows on the next frames.
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return inView();
    }
  }
  return [];
}

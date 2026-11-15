import { MAX_STEP_S, SAVER_PIXEL, type SaverScene } from "./saverScene";

/**
 * The screen saver on screen: a full-window canvas over the game, and the
 * one way back (party 2026-11-15,
 * `_bmad-output/party-mode/screensaver-file-close-party-findings-2026-11-15.md`).
 *
 * Any key, press, tap or wheel, or a mouse move past {@link MOVE_PX}, ends
 * it, and that input never reaches the game: the event that ends it is
 * stopped, and the click, key-up and pointer-up that follow it are swallowed
 * for {@link SWALLOW_MS}. The press that started a preview does not end it
 * ({@link GRACE_MS}). Focus goes back where it was.
 *
 * Cost: nothing exists while the saver is down. While it is up, one canvas
 * at one pixel per {@link SAVER_PIXEL} CSS pixels draws at most
 * {@link MAX_FPS} times a second, and the listeners live only that long.
 * With reduced motion the scene runs ahead a few seconds and holds that one
 * still frame.
 */

/** A mouse drifting less than this many CSS pixels does not end it. */
export const MOVE_PX = 8;
/** Input this soon after it starts belongs to whatever started it. */
export const GRACE_MS = 400;
/** The click or key-up after the input that ended it is swallowed this long. */
export const SWALLOW_MS = 600;
/** Frames a second, at most. */
export const MAX_FPS = 30;
/** How far a still frame runs the scene ahead, in seconds. */
const STILL_AHEAD_S = 3;

/** What it says to a screen reader, and on screen. */
export const SAVER_HINT = "Screen saver. Press any key or move the mouse to go back to your tower.";

export interface ScreenSaverOpts {
  /** Build the scene for a canvas this many pixels wide and high. */
  makeScene: (w: number, h: number) => SaverScene;
  /** One still frame instead of motion (reduced motion). */
  still: boolean;
  /** Called once when it ends, with how long it was up in milliseconds. */
  onEnd: (shownMs: number) => void;
}

/** Drive a scene on a canvas until the returned stop is called, or until the
 *  canvas leaves the page (a dialog that another one replaced): at most
 *  {@link MAX_FPS} frames a second, or one still frame. */
export function runScene(canvas: HTMLCanvasElement, scene: SaverScene, still: boolean, win: Window = window): () => void {
  const c = canvas.getContext("2d");
  if (!c) return () => {};
  c.imageSmoothingEnabled = false;
  if (still) {
    for (let t = 0; t < STILL_AHEAD_S; t += 1 / MAX_FPS) scene.step(1 / MAX_FPS);
    scene.draw(c);
    return () => {};
  }
  scene.draw(c);
  let last = -1;
  let owed = 0;
  let frame = 0;
  const tick = (now: number) => {
    if (!canvas.isConnected) return;
    frame = win.requestAnimationFrame(tick);
    const dt = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    owed += dt;
    if (owed < 1 / MAX_FPS) return;
    scene.step(Math.min(MAX_STEP_S, owed));
    owed = 0;
    scene.draw(c);
  };
  frame = win.requestAnimationFrame(tick);
  return () => win.cancelAnimationFrame(frame);
}

/** Size a canvas to its window at the saver's pixel size. */
function fit(canvas: HTMLCanvasElement, win: Window): void {
  canvas.width = Math.max(1, Math.ceil(win.innerWidth / SAVER_PIXEL));
  canvas.height = Math.max(1, Math.ceil(win.innerHeight / SAVER_PIXEL));
}

/** Put the screen saver up. Returns a function that takes it down (the same
 *  as the player ending it; `onEnd` runs once either way). */
export function showScreenSaver(opts: ScreenSaverOpts, doc: Document = document): () => void {
  const win = doc.defaultView ?? window;
  const now = () => win.performance.now();
  const startedAt = now();
  const returnFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;

  const root = doc.createElement("div");
  root.id = "screensaver";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Screen saver");
  root.tabIndex = -1;
  const canvas = doc.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  const hint = doc.createElement("p");
  hint.className = "screensaver-hint";
  hint.setAttribute("role", "status");
  hint.textContent = SAVER_HINT;
  root.append(canvas, hint);
  doc.body.appendChild(root);
  root.focus({ preventScroll: true });

  let stopScene = () => {};
  const start = () => {
    stopScene();
    fit(canvas, win);
    stopScene = runScene(canvas, opts.makeScene(canvas.width, canvas.height), opts.still, win);
  };
  start();

  let ended = false;
  let firstMove: { x: number; y: number } | null = null;
  const capture = { capture: true, passive: false } as const;
  const stopEvent = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const end = () => {
    if (ended) return;
    ended = true;
    stopScene();
    for (const type of ENDING) win.removeEventListener(type, onInput, capture);
    win.removeEventListener("pointermove", onMove, capture);
    win.removeEventListener("resize", start);
    root.remove();
    // The click, key-up and pointer-up that follow the ending input are its
    // own; they never reach the game.
    const until = now() + SWALLOW_MS;
    const swallow = (e: Event) => {
      if (now() < until) stopEvent(e);
    };
    for (const type of TRAILING) win.addEventListener(type, swallow, capture);
    win.setTimeout(() => {
      for (const type of TRAILING) win.removeEventListener(type, swallow, capture);
    }, SWALLOW_MS);
    returnFocus?.focus({ preventScroll: true });
    opts.onEnd(now() - startedAt);
  };
  const onInput = (e: Event) => {
    stopEvent(e);
    if (now() - startedAt >= GRACE_MS) end();
  };
  const onMove = (e: Event) => {
    const p = e as PointerEvent;
    if (p.pointerType === "touch") return;
    if (!firstMove) {
      firstMove = { x: p.clientX, y: p.clientY };
      return;
    }
    if (Math.hypot(p.clientX - firstMove.x, p.clientY - firstMove.y) > MOVE_PX && now() - startedAt >= GRACE_MS) end();
  };
  for (const type of ENDING) win.addEventListener(type, onInput, capture);
  win.addEventListener("pointermove", onMove, capture);
  win.addEventListener("resize", start);
  return end;
}

/** Input that ends the saver. */
const ENDING = ["keydown", "pointerdown", "mousedown", "touchstart", "wheel", "click", "contextmenu"] as const;
/** Input that follows an ending input and is swallowed with it. */
const TRAILING = ["click", "keyup", "keypress", "pointerup", "mouseup", "touchend", "contextmenu"] as const;

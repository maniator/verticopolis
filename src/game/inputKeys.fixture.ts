import { vi } from "vitest";
import type { GameApp } from "../main";
import { bindKeys } from "./inputKeys";

/**
 * The fake app the keyboard tests drive, and the key helpers. `makeApp` builds
 * a fresh app of `vi.fn()` stubs and calls `bindKeys` once for it; `bindKeys`
 * reaches the live `app.engine`/`app.keyboard` per event, so the stubs are
 * enough. Each `makeApp` takes the previous app's window listeners down first,
 * so only the newest app hears a key and an event's default reflects it alone.
 * The caller mocks `./audioPrefs`, as `bindKeys` flushes prefs on pagehide.
 */
export interface FakeApp {
  undo: ReturnType<typeof vi.fn>;
  redo: ReturnType<typeof vi.fn>;
  setSpeed: ReturnType<typeof vi.fn>;
  announce: ReturnType<typeof vi.fn>;
  engine: {
    zoomBy: ReturnType<typeof vi.fn>;
    ensureVisible: ReturnType<typeof vi.fn>;
    center: ReturnType<typeof vi.fn>;
    transportPreview: unknown;
  };
  keyboard: {
    moveCursor: ReturnType<typeof vi.fn>;
    commitCursor: ReturnType<typeof vi.fn>;
    bulldozeCursor: ReturnType<typeof vi.fn>;
    cursor: ReturnType<typeof vi.fn>;
    resetAnchor: ReturnType<typeof vi.fn>;
    refreshCursorPreview: ReturnType<typeof vi.fn>;
  };
  audio: { start: ReturnType<typeof vi.fn> };
  /** The world's canvas, in the page, so a wheel over it reaches the window. */
  canvas: HTMLCanvasElement;
  /** The camera's pan key, which `bindKeys` sets to the game's Space hold. */
  spacePanKey?: (press?: Event) => boolean;
}

/** The live app's listeners, taken down when the next app is made. */
let liveListeners: AbortController | null = null;

export function makeApp(cursorValue: { tile: number; floor: number } | null = null) {
  const app: FakeApp = {
    undo: vi.fn(),
    redo: vi.fn(),
    setSpeed: vi.fn(),
    announce: vi.fn(),
    engine: {
      zoomBy: vi.fn(),
      ensureVisible: vi.fn(),
      center: vi.fn(),
      transportPreview: { anything: true },
    },
    keyboard: {
      moveCursor: vi.fn(),
      commitCursor: vi.fn(),
      bulldozeCursor: vi.fn(),
      cursor: vi.fn(() => cursorValue),
      resetAnchor: vi.fn(),
      refreshCursorPreview: vi.fn(),
    },
    audio: { start: vi.fn() },
    canvas: document.body.appendChild(document.createElement("canvas")),
  };
  liveListeners?.abort();
  liveListeners = new AbortController();
  bindKeys(app as unknown as GameApp, liveListeners.signal);
  return app;
}

export function press(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...opts }));
}

export function release(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { key, ...opts }));
}

/** Press and release a key, the way a tap reaches the page. */
export function tap(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  press(key, opts);
  release(key, opts);
}

/** Send a pointer event (a mouse button or a finger going down, up, lost or
 *  moving); `init` adds the pointer's kind, whether it is primary, its buttons. */
export function pointer(
  type: "pointerdown" | "pointerup" | "pointercancel" | "pointermove",
  pointerId = 1,
  target: EventTarget = window,
  init: PointerEventInit = {},
): void {
  target.dispatchEvent(new PointerEvent(type, { pointerId, bubbles: true, ...init }));
}

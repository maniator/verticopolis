import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GameApp } from "../main";
import { bindKeys } from "./inputKeys";
import { flushPrefsSave } from "./audioPrefs";
import { CRASH_SCREEN_ID } from "../ui/crashScreen";

/**
 * These pin the keyboard-play / audio-kick / pagehide wiring installed by
 * `bindKeys(app)`. Each call reaches the LIVE `app.engine`/`app.keyboard`/etc.
 * per event, so a hand-built fake app of `vi.fn()` stubs is enough. `bindKeys`
 * adds its listeners to `window`, and those listeners accumulate across calls
 * within this file (happy-dom shares one window). We lean into that: every test
 * builds a FRESH app and calls `bindKeys` once for it, then asserts only on
 * THAT app's stubs. Older listeners still fire against their own (discarded)
 * apps, which is harmless because the current app's stub is driven by exactly
 * one listener (its own), so per-test call counts stay exact.
 *
 * `flushPrefsSave` is mocked so the pagehide wiring can be asserted without
 * reaching storage; `CRASH_SCREEN_ID` is the real constant so the crash-guard
 * test uses the same id the code checks.
 */

vi.mock("./audioPrefs", () => ({ flushPrefsSave: vi.fn() }));

interface FakeApp {
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
}

function makeApp(cursorValue: { tile: number; floor: number } | null = null) {
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
  };
  // bindKeys installs once against this app; return both the typed handle and
  // the raw fake so assertions can reach the stubs.
  bindKeys(app as unknown as GameApp);
  return app;
}

function press(key: string, opts: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...opts }));
}

beforeEach(() => {
  vi.mocked(flushPrefsSave).mockClear();
});

afterEach(() => {
  // Reset DOM + focus so a guard element (crash-screen / splash / modal) or a
  // focused field from one test can't leak into the next.
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.innerHTML = "";
});

describe("undo / redo", () => {
  it("Ctrl+Z undoes", () => {
    const app = makeApp();
    press("z", { ctrlKey: true });
    expect(app.undo).toHaveBeenCalledTimes(1);
    expect(app.redo).not.toHaveBeenCalled();
  });

  it("Cmd+Z (metaKey) undoes too", () => {
    const app = makeApp();
    press("z", { metaKey: true });
    expect(app.undo).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Shift+Z redoes", () => {
    const app = makeApp();
    press("z", { ctrlKey: true, shiftKey: true });
    expect(app.redo).toHaveBeenCalledTimes(1);
    expect(app.undo).not.toHaveBeenCalled();
  });

  it("Ctrl+Y redoes", () => {
    const app = makeApp();
    press("y", { ctrlKey: true });
    expect(app.redo).toHaveBeenCalledTimes(1);
  });

  it("is skipped while typing in an INPUT (the field keeps its own history)", () => {
    const app = makeApp();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("z", { ctrlKey: true });
    expect(app.undo).not.toHaveBeenCalled();
  });

  it("still undoes/redoes while a SELECT is focused (no native undo to yield to)", () => {
    const app = makeApp();
    const select = document.createElement("select");
    document.body.appendChild(select);
    select.focus();
    press("z", { ctrlKey: true });
    press("z", { metaKey: true, shiftKey: true });
    expect(app.undo).toHaveBeenCalledTimes(1);
    expect(app.redo).toHaveBeenCalledTimes(1);
  });

  it("is skipped while a contentEditable region is focused (it keeps its own undo)", () => {
    const app = makeApp();
    const box = document.createElement("div");
    box.contentEditable = "true";
    document.body.appendChild(box);
    box.focus();
    press("z", { ctrlKey: true });
    expect(app.undo).not.toHaveBeenCalled();
  });

  it("is inert behind the first-run splash (never mutate the tower behind it, #541)", () => {
    const app = makeApp();
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    press("z", { ctrlKey: true });
    press("z", { ctrlKey: true, shiftKey: true });
    expect(app.undo).not.toHaveBeenCalled();
    expect(app.redo).not.toHaveBeenCalled();
  });

  it("is inert while a modal dialog is open (the tower must not change under a dialog, #541)", () => {
    const app = makeApp();
    const dialog = document.createElement("dialog");
    dialog.id = "modal";
    document.body.appendChild(dialog);
    dialog.open = true;
    press("z", { ctrlKey: true });
    press("y", { ctrlKey: true });
    expect(app.undo).not.toHaveBeenCalled();
    expect(app.redo).not.toHaveBeenCalled();
  });

  it("resumes normally once the modal closes", () => {
    const app = makeApp();
    const dialog = document.createElement("dialog");
    dialog.id = "modal";
    document.body.appendChild(dialog);
    dialog.open = true;
    press("z", { ctrlKey: true });
    expect(app.undo).not.toHaveBeenCalled();
    dialog.open = false;
    press("z", { ctrlKey: true });
    expect(app.undo).toHaveBeenCalledTimes(1);
  });
});

describe("speed", () => {
  it("a bare digit sets the speed", () => {
    const app = makeApp();
    press("2");
    expect(app.setSpeed).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("digit 0 sets speed 0 (pause)", () => {
    const app = makeApp();
    press("0");
    expect(app.setSpeed).toHaveBeenCalledExactlyOnceWith(0);
  });
});

describe("cursor movement (arrows / WASD)", () => {
  it("ArrowLeft / a move by -1 on x", () => {
    const app = makeApp();
    press("ArrowLeft");
    expect(app.keyboard.moveCursor).toHaveBeenLastCalledWith(-1, 0);
    press("a");
    expect(app.keyboard.moveCursor).toHaveBeenLastCalledWith(-1, 0);
  });

  it("ArrowRight / d move by +1 on x", () => {
    const app = makeApp();
    press("ArrowRight");
    expect(app.keyboard.moveCursor).toHaveBeenLastCalledWith(1, 0);
    press("d");
    expect(app.keyboard.moveCursor).toHaveBeenLastCalledWith(1, 0);
  });

  it("ArrowUp / w move by +1 on y, ArrowDown / s by -1", () => {
    const app = makeApp();
    press("ArrowUp");
    expect(app.keyboard.moveCursor).toHaveBeenLastCalledWith(0, 1);
    press("ArrowDown");
    expect(app.keyboard.moveCursor).toHaveBeenLastCalledWith(0, -1);
  });

  it("Shift makes the step 10", () => {
    const app = makeApp();
    press("ArrowLeft", { shiftKey: true });
    expect(app.keyboard.moveCursor).toHaveBeenLastCalledWith(-10, 0);
    press("ArrowUp", { shiftKey: true });
    expect(app.keyboard.moveCursor).toHaveBeenLastCalledWith(0, 10);
  });
});

describe("commit / bulldoze", () => {
  it("Enter and Space commit the cursor", () => {
    const app = makeApp();
    press("Enter");
    press(" ");
    expect(app.keyboard.commitCursor).toHaveBeenCalledTimes(2);
  });

  it("Delete / x bulldoze the cursor", () => {
    const app = makeApp();
    press("Delete");
    press("x");
    expect(app.keyboard.bulldozeCursor).toHaveBeenCalledTimes(2);
  });
});

describe("zoom", () => {
  it("'+' zooms in, '-' zooms out", () => {
    const app = makeApp();
    press("+");
    expect(app.engine.zoomBy).toHaveBeenLastCalledWith(1.15);
    press("-");
    expect(app.engine.zoomBy).toHaveBeenLastCalledWith(1 / 1.15);
  });
});

describe("'c' recenters", () => {
  it("ensureVisible on the cursor tile when a cursor is set", () => {
    const app = makeApp({ tile: 12, floor: 3 });
    press("c");
    expect(app.engine.ensureVisible).toHaveBeenCalledExactlyOnceWith(12, 3);
    expect(app.engine.center).not.toHaveBeenCalled();
  });

  it("centers when no cursor is set", () => {
    const app = makeApp(null);
    press("c");
    expect(app.engine.center).toHaveBeenCalledTimes(1);
    expect(app.engine.ensureVisible).not.toHaveBeenCalled();
  });
});

describe("Escape cancels", () => {
  it("resets the anchor, clears the transport preview, refreshes, and announces", () => {
    const app = makeApp();
    press("Escape");
    expect(app.keyboard.resetAnchor).toHaveBeenCalledTimes(1);
    expect(app.engine.transportPreview).toBeNull();
    expect(app.keyboard.refreshCursorPreview).toHaveBeenCalledTimes(1);
    expect(app.announce).toHaveBeenCalledExactlyOnceWith("Cancelled");
  });
});

describe("early-return guards", () => {
  it("a crash screen swallows ALL keys (undo and game keys alike)", () => {
    const app = makeApp({ tile: 1, floor: 1 });
    const crash = document.createElement("div");
    crash.id = CRASH_SCREEN_ID;
    document.body.appendChild(crash);
    press("z", { ctrlKey: true });
    press("2");
    press("ArrowLeft");
    expect(app.undo).not.toHaveBeenCalled();
    expect(app.setSpeed).not.toHaveBeenCalled();
    expect(app.keyboard.moveCursor).not.toHaveBeenCalled();
  });

  it("a focused INPUT swallows game keys", () => {
    const app = makeApp();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("2");
    press("ArrowLeft");
    expect(app.setSpeed).not.toHaveBeenCalled();
    expect(app.keyboard.moveCursor).not.toHaveBeenCalled();
  });

  it("a focused SELECT swallows game keys", () => {
    const app = makeApp();
    const select = document.createElement("select");
    document.body.appendChild(select);
    select.focus();
    press("2");
    expect(app.setSpeed).not.toHaveBeenCalled();
  });

  it("a focused TEXTAREA swallows game keys", () => {
    const app = makeApp();
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.focus();
    press("ArrowRight");
    expect(app.keyboard.moveCursor).not.toHaveBeenCalled();
  });

  it("the first-run splash blocks game keys", () => {
    const app = makeApp();
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);
    press("2");
    press("ArrowLeft");
    expect(app.setSpeed).not.toHaveBeenCalled();
    expect(app.keyboard.moveCursor).not.toHaveBeenCalled();
  });

  it("an open #modal dialog blocks game keys", () => {
    const app = makeApp();
    const dialog = document.createElement("dialog");
    dialog.id = "modal";
    document.body.appendChild(dialog);
    dialog.open = true;
    press("2");
    expect(app.setSpeed).not.toHaveBeenCalled();
  });

  it("a CLOSED #modal dialog does NOT block", () => {
    const app = makeApp();
    const dialog = document.createElement("dialog");
    dialog.id = "modal";
    document.body.appendChild(dialog);
    dialog.open = false;
    press("2");
    expect(app.setSpeed).toHaveBeenCalledExactlyOnceWith(2);
  });
});

describe("audio kick + pagehide", () => {
  it("the first gesture starts audio once and removes BOTH kick listeners", () => {
    const app = makeApp();
    window.dispatchEvent(new Event("pointerdown"));
    // A later keydown must NOT start audio again: the pointerdown kick removed
    // the keydown listener too. (The old once:true removed only the listener
    // that fired, so a following keypress started the audio engine a second time.)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    window.dispatchEvent(new Event("pointerdown"));
    expect(app.audio.start).toHaveBeenCalledTimes(1);
  });

  it("skips audio behind the crash screen but stays armed for the next gesture", () => {
    const app = makeApp();
    const crash = document.createElement("div");
    crash.id = CRASH_SCREEN_ID;
    document.body.appendChild(crash);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    expect(app.audio.start).not.toHaveBeenCalled();
    // The listener was not spent: once the crash screen clears, the next gesture
    // still unlocks audio.
    crash.remove();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
    expect(app.audio.start).toHaveBeenCalledTimes(1);
  });

  it("pagehide flushes the pending pref save", () => {
    const app = makeApp();
    window.dispatchEvent(new Event("pagehide"));
    expect(flushPrefsSave).toHaveBeenCalledWith(app);
  });
});

describe("the modified-key surface a wrapper shell must not take", () => {
  // The private Electron shell's native menu registers accelerators, and a menu
  // accelerator is consumed BEFORE the page sees the keydown. So every modified
  // chord this game binds is a chord the shell must leave alone, and the shell's
  // GAME_BOUND_ACCELERATORS list is a hand-transcription of exactly this.
  //
  // Nothing across the repo boundary can verify that transcription, so this pins
  // the public side: adding a modified-key binding here fails this test, which
  // makes it a visible, reviewable event rather than a silent divergence that
  // breaks the packaged desktop build only.

  /** Every mock function reachable on the fake app, so a new binding is caught
   *  whatever it happens to call. Enumerating a few spies by hand was not
   *  enough: the first draft of this test missed a binding calling
   *  engine.center(), which is precisely the blind spot it exists to remove. */
  function allCalls(node: unknown, seen = new Set<unknown>()): number {
    if (!node || typeof node !== "object" || seen.has(node)) return 0;
    seen.add(node);
    let n = 0;
    for (const value of Object.values(node as Record<string, unknown>)) {
      const mock = (value as { mock?: { calls: unknown[] } } | null)?.mock;
      if (mock && Array.isArray(mock.calls)) n += mock.calls.length;
      else n += allCalls(value, seen);
    }
    return n;
  }

  const MODIFIERS = [
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["alt", { altKey: true }],
  ] as const;

  const PROBE_KEYS = [
    "a", "b", "c", "d", "e", "f", "g", "n", "o", "p", "q", "r", "s", "t", "w", "x",
    "0", "1", "2", "3", "+", "-", "=", "Enter", " ", "Delete", "Backspace", "Escape",
    "ArrowUp", "ArrowLeft", "F11",
  ];

  it("takes no modified chord other than undo and redo", () => {
    const app = makeApp();
    // Spend the one-shot audio-unlock listener first. `bindKeys` starts audio on
    // the FIRST keydown of any kind, so without this the first chord probed
    // always looks like a binding (it was reported as ctrl+a purely because "a"
    // led the list).
    press("Shift");
    expect(app.audio.start).toHaveBeenCalled();

    const taken: string[] = [];
    for (const key of PROBE_KEYS) {
      for (const [name, mod] of MODIFIERS) {
        const before = allCalls(app);
        const event = new KeyboardEvent("keydown", { key, cancelable: true, ...mod });
        window.dispatchEvent(event);
        if (allCalls(app) !== before || event.defaultPrevented) taken.push(`${name}+${key}`);
      }
    }
    expect(
      taken,
      "the game took a modified chord the desktop shell may register as a menu accelerator. " +
        "Update GAME_BOUND_ACCELERATORS in the private repo's desktop/shell/src/menu.ts in the same change.",
    ).toEqual([]);
  });

  it("does bind the undo and redo chords, so the guard above is not vacuous", () => {
    for (const key of ["z", "Z", "y", "Y"]) {
      const app = makeApp();
      press(key, { ctrlKey: true });
      expect(app.undo.mock.calls.length + app.redo.mock.calls.length, `Ctrl+${key} should reach undo or redo`).toBe(1);
    }
  });
});

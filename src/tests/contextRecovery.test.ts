import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attemptContextRecovery, DEFAULT_TIMEOUT_MS } from "../game/contextRecovery";

/**
 * The in-place context-loss recovery state machine: wait for the browser's
 * restored signal, rebuild, report exactly one outcome, and only burn the
 * give-up timeout while the tab is visible (a backgrounded loss restores on
 * return to the foreground, however far away that is).
 */

/** A controllable stand-in for the document's visibility surface. */
function fakeDoc(hidden = false) {
  const listeners = new Set<EventListener>();
  return {
    hidden,
    addEventListener(type: string, cb: EventListener) {
      if (type === "visibilitychange") listeners.add(cb);
    },
    removeEventListener(type: string, cb: EventListener) {
      if (type === "visibilitychange") listeners.delete(cb);
    },
    setHidden(h: boolean) {
      this.hidden = h;
      for (const cb of [...listeners]) cb(new Event("visibilitychange"));
    },
    listenerCount: () => listeners.size,
  };
}

describe("attemptContextRecovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("restored signal → rebuild resolves → done(true), listeners unsubscribed", async () => {
    const doc = fakeDoc();
    let restore: (() => void) | null = null;
    let unsubscribed = 0;
    const outcomes: boolean[] = [];
    attemptContextRecovery(
      {
        onRestored: (cb) => {
          restore = cb;
          return () => unsubscribed++;
        },
        rebuild: () => Promise.resolve(),
        doc,
      },
      (ok) => outcomes.push(ok),
    );
    expect(doc.listenerCount()).toBe(1);
    restore!();
    await vi.runAllTimersAsync(); // flush the rebuild promise
    expect(outcomes).toEqual([true]);
    expect(unsubscribed).toBe(1);
    expect(doc.listenerCount()).toBe(0);
  });

  it("a rebuild that throws synchronously reports failure", () => {
    const doc = fakeDoc();
    let restore: (() => void) | null = null;
    const outcomes: boolean[] = [];
    attemptContextRecovery(
      {
        onRestored: (cb) => {
          restore = cb;
          return () => {};
        },
        rebuild: () => {
          throw new Error("no gl");
        },
        doc,
      },
      (ok) => outcomes.push(ok),
    );
    restore!();
    expect(outcomes).toEqual([false]);
  });

  it("a rebuild whose start rejects reports failure", async () => {
    const doc = fakeDoc();
    let restore: (() => void) | null = null;
    const outcomes: boolean[] = [];
    attemptContextRecovery(
      {
        onRestored: (cb) => {
          restore = cb;
          return () => {};
        },
        rebuild: () => Promise.reject(new Error("start failed")),
        doc,
      },
      (ok) => outcomes.push(ok),
    );
    restore!();
    await vi.runAllTimersAsync();
    expect(outcomes).toEqual([false]);
  });

  it("no restored signal inside the visible-time budget → done(false), once", () => {
    const doc = fakeDoc();
    const outcomes: boolean[] = [];
    let restore: (() => void) | null = null;
    const rebuild = vi.fn(() => Promise.resolve());
    attemptContextRecovery(
      {
        onRestored: (cb) => {
          restore = cb;
          return () => {};
        },
        rebuild,
        doc,
      },
      (ok) => outcomes.push(ok),
    );
    vi.advanceTimersByTime(DEFAULT_TIMEOUT_MS);
    expect(outcomes).toEqual([false]);
    // A restore arriving after the give-up is ignored: the crash screen is up
    // and its Reload path owns recovery now.
    restore!();
    expect(rebuild).not.toHaveBeenCalled();
    expect(outcomes).toEqual([false]);
  });

  it("the countdown only runs while the tab is visible (a background loss waits for the foreground)", () => {
    const doc = fakeDoc(true); // loss happened while backgrounded
    const outcomes: boolean[] = [];
    let restore: (() => void) | null = null;
    attemptContextRecovery(
      {
        onRestored: (cb) => {
          restore = cb;
          return () => {};
        },
        rebuild: () => Promise.resolve(),
        doc,
        timeoutMs: 1000,
      },
      (ok) => outcomes.push(ok),
    );
    // Hidden: however long passes, no give-up.
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual([]);
    // Foregrounded: the budget starts now.
    doc.setHidden(false);
    vi.advanceTimersByTime(999);
    expect(outcomes).toEqual([]);
    // Hidden again mid-countdown disarms it.
    doc.setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual([]);
    doc.setHidden(false);
    vi.advanceTimersByTime(1000);
    expect(outcomes).toEqual([false]);
    expect(restore).not.toBeNull();
  });

  it("the restored signal disarms the countdown, so a slow rebuild can't be interrupted by the timeout", async () => {
    const doc = fakeDoc();
    const outcomes: boolean[] = [];
    let restore: (() => void) | null = null;
    let finishRebuild: (() => void) | null = null;
    attemptContextRecovery(
      {
        onRestored: (cb) => {
          restore = cb;
          return () => {};
        },
        rebuild: () => new Promise<void>((resolve) => (finishRebuild = resolve)),
        doc,
        timeoutMs: 1000,
      },
      (ok) => outcomes.push(ok),
    );
    vi.advanceTimersByTime(900);
    restore!();
    // The rebuild outlives the original budget; the give-up must not fire.
    vi.advanceTimersByTime(10_000);
    expect(outcomes).toEqual([]);
    finishRebuild!();
    await vi.runAllTimersAsync();
    expect(outcomes).toEqual([true]);
  });
});

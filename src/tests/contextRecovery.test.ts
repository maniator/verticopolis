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

  it("the countdown only counts ACCUMULATED visible time (a background loss waits for the foreground)", () => {
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
    // Foregrounded: the budget starts spending.
    doc.setHidden(false);
    vi.advanceTimersByTime(900);
    expect(outcomes).toEqual([]);
    // Hidden again mid-countdown banks the 900ms already spent.
    doc.setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual([]);
    // Back to the foreground: only the REMAINING 100ms is left; flapping
    // visibility must not hand out a fresh full budget each time (a player
    // app-switching every few seconds would otherwise sit frozen forever).
    doc.setHidden(false);
    vi.advanceTimersByTime(99);
    expect(outcomes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(outcomes).toEqual([false]);
    expect(restore).not.toBeNull();
  });

  it("a visibility flip during a slow rebuild never re-arms the countdown over a healthy rebuild", async () => {
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
    restore!(); // rebuild starts; countdown stops for good
    doc.setHidden(true);
    doc.setHidden(false); // foreground again mid-rebuild: must NOT re-arm
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual([]); // no give-up fired over the pending rebuild
    finishRebuild!();
    await vi.runAllTimersAsync();
    expect(outcomes).toEqual([true]);
  });

  it("a second restored signal while a rebuild is pending is a no-op (one rebuild, one outcome)", async () => {
    const doc = fakeDoc();
    const outcomes: boolean[] = [];
    let restore: (() => void) | null = null;
    let finishRebuild: (() => void) | null = null;
    const rebuild = vi.fn(() => new Promise<void>((resolve) => (finishRebuild = resolve)));
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
    restore!();
    restore!(); // flapping GPU: a second signal must not start a second rebuild
    expect(rebuild).toHaveBeenCalledTimes(1);
    finishRebuild!();
    await vi.runAllTimersAsync();
    expect(outcomes).toEqual([true]);
  });

  it("a restored signal firing synchronously during subscription still settles cleanly (no leaked listeners)", () => {
    const doc = fakeDoc();
    const outcomes: boolean[] = [];
    let unsubscribed = 0;
    attemptContextRecovery(
      {
        onRestored: (cb) => {
          cb(); // fires before the subscription call even returns
          return () => unsubscribed++;
        },
        rebuild: () => {
          throw new Error("no gl");
        },
        doc,
      },
      (ok) => outcomes.push(ok),
    );
    expect(outcomes).toEqual([false]);
    expect(unsubscribed).toBe(1); // released even though finish ran before it existed
    expect(doc.listenerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(outcomes).toEqual([false]); // and no stray timer fires later
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

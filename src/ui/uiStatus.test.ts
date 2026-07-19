import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "./uiStatus";
import type { UI } from "./UI";

/**
 * Toast-rail timer lifecycle. `toast()` only touches `ui.el.toast`, so a bare
 * element behind a cast is enough. Fake timers let us assert that a toast pruned
 * below the TOAST_MAX cap cancels its pending hold/fade timer (issue #368)
 * instead of leaving it to fire on a node already detached from the rail.
 */

const TOAST_MAX = 5; // mirrors the cap in uiStatus.ts

function makeUI(): { ui: UI; rail: HTMLElement } {
  const rail = document.createElement("div");
  const ui = { el: { toast: rail } } as unknown as UI;
  return { ui, rail };
}

describe("toast rail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("caps the rail at TOAST_MAX, pruning the oldest", () => {
    const { ui, rail } = makeUI();
    for (let i = 0; i < TOAST_MAX + 3; i++) toast(ui, `t${i}`);
    expect(rail.children.length).toBe(TOAST_MAX);
    // The oldest three were pruned, so the survivors are the newest.
    expect(rail.firstElementChild?.textContent).toBe("t3");
    expect(rail.lastElementChild?.textContent).toBe(`t${TOAST_MAX + 2}`);
  });

  it("cancels a pruned toast's pending timer (no leak past the DOM)", () => {
    const { ui, rail } = makeUI();
    for (let i = 0; i < TOAST_MAX + 4; i++) toast(ui, `t${i}`);
    // One pending hold timer per SURVIVING toast; the pruned ones were cleared,
    // so the count is TOAST_MAX, not TOAST_MAX + 4.
    expect(vi.getTimerCount()).toBe(TOAST_MAX);
    // ...and the survivors are the newest, so the cleared timers really were
    // the pruned (oldest) ones, not some other TOAST_MAX of them.
    expect(rail.firstElementChild?.textContent).toBe("t4");
    expect(rail.lastElementChild?.textContent).toBe(`t${TOAST_MAX + 3}`);
  });

  it("cancels a pruned toast's removal timer even when it is pruned mid-fade", () => {
    const { ui, rail } = makeUI();
    for (let i = 0; i < TOAST_MAX; i++) toast(ui, `t${i}`);
    vi.advanceTimersByTime(3600); // every toast enters its fade; removal timers now pending
    expect(vi.getTimerCount()).toBe(TOAST_MAX); // TOAST_MAX removal timers, none fired yet
    const fading = rail.firstElementChild; // t0, mid-fade
    toast(ui, "overflow"); // pushes past the cap, pruning t0 while it is still fading
    // t0's 300ms removal timer was cleared on prune. If it had leaked, the count
    // would be TOAST_MAX + 1 (its stale removal timer plus the new toast's hold).
    expect(vi.getTimerCount()).toBe(TOAST_MAX);
    expect(rail.contains(fading!)).toBe(false);
    expect(rail.firstElementChild?.textContent).toBe("t1");
  });

  it("a surviving toast holds, fades, then removes itself", () => {
    const { ui, rail } = makeUI();
    toast(ui, "solo");
    const node = rail.firstElementChild as HTMLElement;
    expect(node.style.opacity).toBe("");
    vi.advanceTimersByTime(3600); // hold elapses, fade begins
    expect(node.style.opacity).toBe("0");
    expect(rail.children.length).toBe(1); // still present, mid-fade
    vi.advanceTimersByTime(300); // fade elapses, node removes itself
    expect(rail.children.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs only the survivors' timers to completion (pruned timers are gone)", () => {
    const { ui, rail } = makeUI();
    for (let i = 0; i < TOAST_MAX + 2; i++) toast(ui, `t${i}`);
    // TOAST_MAX survivors, each with one hold timer; the two pruned toasts left
    // no timer behind. Run the clock out: every survivor holds, fades, removes,
    // and nothing is left pending.
    expect(vi.getTimerCount()).toBe(TOAST_MAX);
    vi.advanceTimersByTime(3600 + 300);
    expect(rail.children.length).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

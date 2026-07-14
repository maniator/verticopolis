import { describe, it, expect } from "vitest";
import { PinchTracker, stablePointerId } from "./pinchTracker";

/**
 * A faithful miniature of Excalibur 0.32's `_normalizePointerId` + `clear()`:
 * the public id is the index of the native id in the SORTED set of currently
 * active native ids, and the set is pruned on `up` only. This is the exact
 * contract that made a map keyed by Excalibur's public id leak a phantom
 * contact whenever the lower-native-id finger of a pinch lifted first.
 */
class ExcaliburIdNormalizer {
  private active = new Set<number>();
  norm(nativeId: number): number {
    this.active.add(nativeId);
    return [...this.active].sort((a, b) => a - b).indexOf(nativeId);
  }
  /** Excalibur prunes the active set only when an `up` is flushed. */
  afterUp(nativeId: number): void {
    this.active.delete(nativeId);
  }
}

describe("stablePointerId: prefer the native DOM pointerId", () => {
  it("uses the native event's pointerId when present and finite", () => {
    expect(stablePointerId(0, { pointerId: 17 })).toBe(17);
    expect(stablePointerId(3, { pointerId: 0 })).toBe(0);
  });

  it("falls back to the engine id, mapped into a disjoint negative key space", () => {
    expect(stablePointerId(2, undefined)).toBe(-3);
    expect(stablePointerId(2, null)).toBe(-3);
    expect(stablePointerId(2, {})).toBe(-3); // e.g. a legacy TouchEvent
    expect(stablePointerId(2, { pointerId: "7" })).toBe(-3);
    expect(stablePointerId(2, { pointerId: NaN })).toBe(-3);
    // The fallback can never collide with a real native id (non-negative),
    // so a fallback-tracked contact cannot overwrite a native-tracked one.
    expect(stablePointerId(0, undefined)).toBe(-1);
  });
});

describe("PinchTracker: contact lifecycle", () => {
  it("classifies first contact single, second pinch-start, third pinch-extra", () => {
    const t = new PinchTracker();
    expect(t.down(10, 0, 0)).toBe("single");
    expect(t.down(11, 100, 0)).toBe("pinch-start");
    expect(t.down(12, 50, 80)).toBe("pinch-extra");
    expect(t.pinching).toBe(true);
    expect(t.size).toBe(3);
  });

  it("ends empty after the reshuffle-prone sequence when keyed by STABLE ids", () => {
    // Pinch with native ids 10 then 11; lift 10 (the lower id) FIRST, the
    // exact order that used to strand a phantom under Excalibur's renumbering.
    const t = new PinchTracker();
    t.down(10, 0, 0);
    t.down(11, 100, 0);
    const end = t.up(10);
    expect(end).toEqual({ pinch: "ended", survivor: { x: 100, y: 0 } });
    t.move(11, 120, 5);
    expect(t.up(11)).toEqual({ pinch: "none" });
    expect(t.size).toBe(0);
    expect(t.pinching).toBe(false);
  });

  it("documents the old bug: keying by Excalibur's renumbered ids leaks a phantom", () => {
    // Same physical gesture, but fed the ids Excalibur 0.32 would hand out.
    const ex = new ExcaliburIdNormalizer();
    const t = new PinchTracker();
    t.down(ex.norm(10), 0, 0); // finger A -> public 0
    t.down(ex.norm(11), 100, 0); // finger B -> public 1
    t.up(ex.norm(10)); // A lifts -> still public 0
    ex.afterUp(10); // Excalibur prunes native 10 AFTER the up flushes
    t.move(ex.norm(11), 120, 5); // B's move now renumbers to public 0
    t.up(ex.norm(11)); // B's up arrives as public 0 -> misses the entry at 1
    expect(t.size).toBe(1); // the phantom that broke zoom and swallowed taps
  });

  it("survivor hand-off reports the remaining finger's LAST tracked position", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 100, 0);
    t.move(2, 140, 20);
    const end = t.up(1);
    expect(end).toEqual({ pinch: "ended", survivor: { x: 140, y: 20 } });
  });

  it("ends with a null survivor only when no contact remains", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    expect(t.up(1)).toEqual({ pinch: "none" }); // no pinch was ever live
    t.down(1, 0, 0);
    t.down(2, 10, 0);
    expect(t.up(2)).toEqual({ pinch: "ended", survivor: { x: 0, y: 0 } });
    expect(t.up(1)).toEqual({ pinch: "none" }); // pinch already ended
    expect(t.size).toBe(0);
  });
});

describe("PinchTracker: pinch camera math", () => {
  it("returns midpoint pan deltas and the finger-distance zoom ratio", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 100, 0); // baseline: dist 100, midpoint (50, 0)
    const mv = t.move(2, 200, 0)!; // dist 200, midpoint (100, 0)
    expect(mv.panDx).toBe(50);
    expect(mv.panDy).toBe(0);
    expect(mv.zoom).toBe(2);
    expect(mv.cx).toBe(100);
    expect(mv.cy).toBe(0);
    // Re-baselined: an immediate no-op move is a zero delta, zoom 1.
    const still = t.move(2, 200, 0)!;
    expect(still).toEqual({ panDx: 0, panDy: 0, zoom: 1, cx: 100, cy: 0 });
  });

  it("reports zoom 1 (never Infinity/NaN) from a zero-distance baseline", () => {
    const t = new PinchTracker();
    t.down(1, 50, 50);
    t.down(2, 50, 50); // both fingers on the same point: baseline dist 0
    const mv = t.move(2, 90, 50)!;
    expect(mv.zoom).toBe(1);
    // Next move measures from the fresh (non-zero) baseline normally.
    const mv2 = t.move(2, 130, 50)!;
    expect(mv2.zoom).toBe(2);
  });

  it("returns null for moves while no pinch is live (single finger, or after end)", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    expect(t.move(1, 30, 0)).toBeNull();
    t.down(2, 100, 0);
    t.up(2);
    expect(t.move(1, 60, 0)).toBeNull();
  });

  it("ignores position updates for untracked ids but still reports pinch deltas", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 100, 0);
    const mv = t.move(99, 500, 500)!; // untracked id: nothing moved
    expect(mv).toEqual({ panDx: 0, panDy: 0, zoom: 1, cx: 50, cy: 0 });
    expect(t.size).toBe(2); // an untracked move never creates a contact
  });
});

describe("PinchTracker: three-finger hygiene", () => {
  it("re-baselines when a pinch continues on the remaining two contacts", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 100, 0); // pinch reads contacts 1 and 2
    t.down(3, 0, 200); // extra finger, ignored by the pinch
    const r = t.up(1); // pinch survives on contacts 2 and 3
    expect(r).toEqual({ pinch: "continues" });
    expect(t.pinching).toBe(true);
    // First move after the hand-over must measure from the NEW pair's
    // baseline (dist ~223.6, midpoint (50, 100)): a zero-delta move proves
    // there is no jump from the lifted finger's stale baseline.
    const mv = t.move(2, 100, 0)!;
    expect(mv).toEqual({ panDx: 0, panDy: 0, zoom: 1, cx: 50, cy: 100 });
  });

  it("an extra finger landing does not disturb the live pinch pair", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 100, 0);
    t.move(2, 120, 0);
    expect(t.down(3, 40, 90)).toBe("pinch-extra");
    const mv = t.move(1, 0, 0)!; // no finger actually moved
    expect(mv).toEqual({ panDx: 0, panDy: 0, zoom: 1, cx: 60, cy: 0 });
  });

  it("a mid-pinch CANCEL of one finger routes through up() and hands off the survivor", () => {
    // The engine binds Excalibur's "cancel" event to the same pointerUp
    // handler as "up" (browsers cancel a contact when they take the gesture:
    // notification shade, app switch). At the tracker level cancel IS up.
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 100, 40);
    const cancelled = t.up(1); // pointercancel for finger 1
    expect(cancelled).toEqual({ pinch: "ended", survivor: { x: 100, y: 40 } });
    expect(t.up(2)).toEqual({ pinch: "none" }); // then finger 2 cancels too
    expect(t.size).toBe(0); // no phantom left behind by the cancels
  });

  it("reset drops all contacts and any live pinch", () => {
    const t = new PinchTracker();
    t.down(1, 0, 0);
    t.down(2, 100, 0);
    t.reset();
    expect(t.size).toBe(0);
    expect(t.pinching).toBe(false);
    expect(t.up(1)).toEqual({ pinch: "none" });
  });
});

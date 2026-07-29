/**
 * Pure multi-touch contact tracking and pinch lifecycle, split out of the
 * Excalibur-bound {@link TowerEngine} (like {@link cameraBounds}) so the state
 * machine can be unit-tested without a canvas/WebGL context.
 *
 * Why this exists: Excalibur 0.32 renumbers its public `pointerId` on every
 * event (it is the index of the native id in the sorted set of currently
 * active native ids, pruned only on `up`). When the first-placed finger of a
 * pinch lifts first, the surviving finger's later events arrive under a
 * DIFFERENT id than its `down`, so a map keyed by Excalibur's id strands a
 * phantom entry forever. One phantom makes every later one-finger press look
 * like a two-finger pinch: the camera zooms erratically ("stuck" zoom) and
 * taps are swallowed before placement ever runs. See the investigation at
 * _bmad-output/implementation-artifacts/investigations/
 * mobile-zoom-placement-investigation.md.
 */

/** The per-contact-stable pointer id: the native DOM `pointerId` when the
 *  wrapped event carries one, else the engine's own id mapped into a disjoint
 *  negative key space. Native ids are stable for the lifetime of a contact on
 *  every PointerEvent browser, which is the property the contact map needs
 *  and Excalibur's renumbered id lacks. */
export function stablePointerId(engineId: number, nativeEvent: unknown): number {
  if (typeof nativeEvent === "object" && nativeEvent !== null && "pointerId" in nativeEvent) {
    const id = (nativeEvent as { pointerId: unknown }).pointerId;
    if (typeof id === "number" && Number.isFinite(id)) return id;
  }
  // Fallback ids live in a disjoint (negative) key space: native pointerIds
  // are non-negative, so a contact tracked by a native id can never be
  // overwritten by one tracked via the fallback (e.g. the legacy TouchEvent
  // path), even if their raw numbers collide.
  return -1 - engineId;
}

/** A screen-space contact position. */
export interface ContactPoint {
  x: number;
  y: number;
}

/** Camera delta for one pinch move: pan by the midpoint delta, scale by the
 *  finger-distance ratio about the midpoint (the standard map gesture).
 *  `zoom` is 1 when the stored baseline distance was 0 (identical points). */
export interface PinchMove {
  panDx: number;
  panDy: number;
  zoom: number;
  cx: number;
  cy: number;
}

/** Outcome of removing a contact.
 *  - `"none"`: no pinch was live; the caller runs its normal single-pointer
 *    release path.
 *  - `"continues"`: a pinch stays live on the remaining contacts (re-baselined
 *    so the next move can't jump); the caller just swallows the release.
 *  - `"ended"`: the pinch is over. `survivor` is the last tracked position of
 *    the one remaining contact (the caller hands it a pan continuation), or
 *    null when no contact remains. */
export type PinchUp =
  | { pinch: "none" }
  | { pinch: "continues" }
  | { pinch: "ended"; survivor: ContactPoint | null };

/**
 * Tracks live pointer contacts by a caller-supplied STABLE id and owns the
 * pinch lifecycle. Callers feed it down/move/up (routing `cancel` through
 * `up`) and act on the returned transitions; it never touches the DOM or the
 * engine.
 */
export class PinchTracker {
  private contacts = new Map<number, ContactPoint>();
  private pinch: { dist: number; mx: number; my: number } | null = null;

  /** Number of live contacts. */
  get size(): number {
    return this.contacts.size;
  }

  /** Whether a two-finger pinch is currently live. */
  get pinching(): boolean {
    return this.pinch !== null;
  }

  /** Whether this pointer is a live (pressed) contact. A hovering mouse on
   *  hybrid hardware moves without ever pressing, so it is never tracked;
   *  gesture handlers use this to ignore such moves while a contact is down. */
  tracks(id: number): boolean {
    return this.contacts.has(id);
  }

  /** Register a press.
   *  - `"single"`: this is the only live contact; the caller classifies its
   *    own pan/action gesture as usual.
   *  - `"pinch-start"`: this press formed the second live contact; the caller
   *    cancels any single-pointer gesture and clears build previews.
   *  - `"pinch-extra"`: a third-or-later finger landed; the caller ignores it
   *    (the pinch keeps reading the first two live contacts). */
  down(id: number, x: number, y: number): "single" | "pinch-start" | "pinch-extra" {
    this.contacts.set(id, { x, y });
    if (this.contacts.size === 1) return "single";
    if (this.contacts.size === 2 && !this.pinch) {
      this.baseline();
      return "pinch-start";
    }
    return "pinch-extra";
  }

  /** Update a contact's position (ignored for untracked ids). While a pinch is
   *  live, returns the camera delta for this move and re-baselines; otherwise
   *  returns null and the caller runs its normal pan/action/hover move path. */
  move(id: number, x: number, y: number): PinchMove | null {
    const c = this.contacts.get(id);
    if (c) {
      c.x = x;
      c.y = y;
    }
    if (!this.pinch) return null;
    const pts = this.firstTwo();
    if (!pts) return null;
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const mx = (pts[0].x + pts[1].x) / 2;
    const my = (pts[0].y + pts[1].y) / 2;
    const out: PinchMove = {
      panDx: mx - this.pinch.mx,
      panDy: my - this.pinch.my,
      zoom: this.pinch.dist > 0 ? dist / this.pinch.dist : 1,
      cx: mx,
      cy: my,
    };
    this.pinch = { dist, mx, my };
    return out;
  }

  /** Remove a contact (pointer up OR cancel). See {@link PinchUp}. */
  up(id: number): PinchUp {
    this.contacts.delete(id);
    if (!this.pinch) return { pinch: "none" };
    if (this.contacts.size >= 2) {
      // The pinch carries on with the remaining fingers: re-baseline so the
      // next move measures from THEIR distance/midpoint, not the lifted
      // finger's (a stale baseline would jolt the camera).
      this.baseline();
      return { pinch: "continues" };
    }
    this.pinch = null;
    const survivor = this.contacts.size === 1 ? { ...this.contacts.values().next().value! } : null;
    return { pinch: "ended", survivor };
  }

  /** Drop every contact and any live pinch (e.g. a full input reset). */
  reset(): void {
    this.contacts.clear();
    this.pinch = null;
  }

  /** The two live contacts the pinch reads (insertion order), or null. */
  private firstTwo(): [ContactPoint, ContactPoint] | null {
    if (this.contacts.size < 2) return null;
    const it = this.contacts.values();
    return [it.next().value!, it.next().value!];
  }

  /** Seed the pinch baseline from the current first two contacts. */
  private baseline(): void {
    const pts = this.firstTwo();
    if (!pts) return;
    this.pinch = {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      mx: (pts[0].x + pts[1].x) / 2,
      my: (pts[0].y + pts[1].y) / 2,
    };
  }
}

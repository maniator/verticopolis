import type { GameplayEvent, GameplayEventName, GameplayEventPayloads } from "./gameplayEvents";

export type { GameplayEvent } from "./gameplayEvents";

/**
 * The drain buffer of gameplay events (`conformance/events/catalog.json`):
 * the provider-agnostic facts the engine emits at the moment a transition
 * happens, for the host to drain after each tick and hand to the platform.
 * The Rust twin is `engine-rs/src/gameplay.rs`.
 *
 * Emission reads state after a transition and writes only here: never the
 * rng, the save, the clock or the hashed views. The buffer is a bounded
 * ring, so a run that never drains cannot grow memory; when it is full the
 * oldest event goes and {@link dropped} counts it.
 */

/** The most events the ring holds between two drains. */
export const GAMEPLAY_RING_CAP = 1024;

export class GameplayEventBuffer {
  private ring: GameplayEvent[] = [];
  /** Index of the oldest event once the ring has wrapped. */
  private head = 0;
  /** Events pushed out of a full ring since the engine was made. */
  dropped = 0;
  /** Set on a tower that is only scenery (the title screen's backdrop when
   *  there is no save): what it emits is not the player's, so a tower that
   *  replaces it inherits none of it. */
  discardOnHandOff = false;

  push<N extends GameplayEventName>(name: N, payload: GameplayEventPayloads[N]): void {
    this.pushEvent({ name, payload } as GameplayEvent);
  }

  /** Append an event already shaped `{ name, payload }` (a host handing a
   *  drained batch back to the engine that becomes the authority again). */
  pushEvent(event: GameplayEvent): void {
    if (this.ring.length < GAMEPLAY_RING_CAP) {
      this.ring.push(event);
      return;
    }
    this.ring[this.head] = event;
    this.head = (this.head + 1) % GAMEPLAY_RING_CAP;
    this.dropped++;
  }

  /** Every buffered event, oldest first; the ring is empty afterwards. */
  drain(): GameplayEvent[] {
    const out = this.head === 0 ? this.ring : [...this.ring.slice(this.head), ...this.ring.slice(0, this.head)];
    this.ring = [];
    this.head = 0;
    return out;
  }

  /** Take over the buffer of the tower this one replaces (an undo, a load, a
   *  new game): its events go ahead of this buffer's own, oldest first, and
   *  its drop count adds to this one, so nothing the replaced tower still
   *  owed is lost and no loss goes uncounted. `prev` is left empty with no
   *  drops; a backdrop's events and drops are discarded. A full ring drops
   *  the oldest and counts them, as a push does. */
  inherit(prev: GameplayEventBuffer): void {
    if (prev === this) return;
    const theirs = prev.drain();
    const theirDropped = prev.dropped;
    prev.dropped = 0;
    if (prev.discardOnHandOff) return;
    this.dropped += theirDropped;
    if (theirs.length === 0) return;
    const own = this.drain();
    for (const e of theirs) this.pushEvent(e);
    for (const e of own) this.pushEvent(e);
  }

  get length(): number {
    return this.ring.length;
  }
}

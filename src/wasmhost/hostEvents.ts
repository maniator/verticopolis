import type { GameplayEvent } from "../engine/gameplayEvents";

/** One read of the engine's pending events: the batch, the events lost to
 *  a record the host could not read (#907), and the engine's drop count. */
export interface EventRead {
  events: GameplayEvent[];
  lost: number;
  dropped: number;
}

/**
 * The hosted tower's gameplay events between the engine and the game (the
 * WASM host, `wasmHost.ts`; #874). An event leaves the host only once a
 * restore point covers it: a fallback goes back to that point and the
 * TypeScript engine emits that time's events again. So a command's events
 * are held until the next point (a merge, a hosted save, the tick pull's
 * own point, a healthy detach), and a fault drops them: a command the
 * fallback undoes never reaches the game. Temporary, with the restore
 * points (story-engine-retire-typescript.md).
 */
export class HostEvents {
  /** Events a point covers, waiting for the next drain. */
  private carried: GameplayEvent[];
  /** Events of commands no point covers yet. */
  private held: GameplayEvent[] = [];
  /** Commands relayed since the newest point, log lines and the camera left
   *  out: what a fallback undoes, counted on a frozen host too. */
  lostEdits = 0;
  /** Events lost to batches the host could not read (#907). */
  unreadable = 0;
  /** The engine's own drop count at the last read, for a faulted host that
   *  can no longer ask. */
  engineDropped = 0;

  /** `carried`: the instance's own events at attach, which are real (it was
   *  the authority). */
  constructor(carried: GameplayEvent[]) {
    this.carried = carried;
  }

  /** Keep a read's counts, but none of its events. */
  count(read: EventRead): void {
    this.unreadable += read.lost;
    this.engineDropped = read.dropped;
  }

  /** A point covers everything up to `read`: the held events go out, then
   *  the read's, in the order the engine emitted them. */
  cover(read: EventRead): void {
    this.count(read);
    this.carried.push(...this.held, ...read.events);
    this.held = [];
    this.lostEdits = 0;
  }

  /** A command's own events wait for a point. */
  hold(read: EventRead): void {
    this.count(read);
    this.held.push(...read.events);
  }

  /** A relayed command ran on the read model after the newest point. */
  noteCommand(op: string): void {
    if (op !== "emit" && op !== "setView") this.lostEdits++;
  }

  /** The analytics session's own flush (a hide, a window closing) lets the
   *  held events go, so a page that closes keeps them: a fault after that
   *  and before a point covers their commands can count them twice, which
   *  beats losing them on every close. */
  release(): void {
    this.carried.push(...this.held);
    this.held = [];
  }

  /** A fault: the recovery goes back to before the held commands. */
  dropHeld(): void {
    this.held = [];
  }

  /** The covered events, handed out once. */
  take(): GameplayEvent[] {
    const out = this.carried;
    this.carried = [];
    return out;
  }
}

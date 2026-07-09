import type { Tower } from "./Tower";

/**
 * A cheap fingerprint of the player-mutable state — structure, transport config,
 * labels, rents, cinema booking policy, retail subtype, and money. It
 * deliberately omits the clock/time fields, so the sub-second time delta
 * *within a single gesture* isn't mistaken for a change when {@link UndoHistory}
 * compares capture-vs-commit to drop no-op gestures. (Money IS included; over
 * long spans income can move it, but a gesture is far too short for that to
 * matter.)
 */
export function towerStateSig(tower: Tower, money: number): string {
  const u = tower.units
    .map((x) => `${x.kind}@${x.floor},${x.x}:${x.label ?? ""}:${x.rent ?? ""}:${x.filmPolicy ?? ""}:${x.subtype ?? ""}`)
    .join(";");
  const r = tower.transports
    .map((x) => `${x.kind}@${x.x}:${x.bottom}-${x.top}:${x.cars}:${(x.skipFloors ?? []).join(".")}`)
    .join(";");
  return `${money}|${u}|${r}`;
}

/**
 * Ports that connect the (otherwise domain-agnostic) history to the game:
 * how to take/restore an opaque snapshot, how to fingerprint the current
 * player-mutable state, and where to send the "Undid: …" messages.
 */
export interface UndoPorts {
  /** Serialize the current state to an opaque string (e.g. the saved game). */
  snapshot(): string;
  /** Restore a snapshot previously returned by {@link snapshot}. */
  restore(snap: string): void;
  /** Fingerprint the current player-mutable state (see {@link towerStateSig}). */
  signature(): string;
  /** Surface a short user-facing message ("Undid: Bulldoze", "Nothing to undo."). */
  notify(message: string): void;
}

interface Entry {
  snap: string;
  label: string;
}

/** Most snapshots we keep on each stack before the oldest is dropped. */
const UNDO_CAP = 40;

/**
 * Snapshot-based undo/redo with per-gesture coalescing. A gesture calls
 * {@link capture} on its first mutation and {@link commit} on its end; the
 * snapshot is only kept if the {@link UndoPorts.signature} actually changed, so
 * a misfired or empty gesture leaves no step. Restores go through the ports, so
 * this class knows nothing about the simulation itself.
 */
export class UndoHistory {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private pending: { snap: string; sig: string; label: string } | null = null;

  constructor(private readonly ports: UndoPorts) {}

  /**
   * Capture the pre-action snapshot at the start of a gesture. Called exactly
   * once per gesture (a drag's first mutation, or a discrete edit click), and it
   * deliberately *overwrites* any prior pending: gesture-start hooks fire once,
   * and overwriting self-heals a gesture that captured but bailed before
   * committing (e.g. an edit that hit an early return). A "capture only if empty"
   * guard would instead strand that stale snapshot and mis-anchor the next
   * gesture, so overwrite is intentional here.
   */
  capture(label: string): void {
    this.pending = { snap: this.ports.snapshot(), sig: this.ports.signature(), label };
  }

  /** Finalize the captured snapshot — but only if something actually changed. */
  commit(): void {
    const p = this.pending;
    this.pending = null;
    if (!p || this.ports.signature() === p.sig) return;
    this.undoStack.push({ snap: p.snap, label: p.label });
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    this.redoStack.length = 0; // a fresh action invalidates the redo trail
  }

  undo(): void {
    this.commit(); // finalize any in-flight gesture first
    const entry = this.undoStack.pop();
    if (!entry) return this.ports.notify("Nothing to undo.");
    this.redoStack.push({ snap: this.ports.snapshot(), label: entry.label });
    this.ports.restore(entry.snap);
    this.ports.notify(`Undid: ${entry.label}`);
  }

  redo(): void {
    this.commit(); // finalize any in-flight gesture first (matches undo)
    const entry = this.redoStack.pop();
    if (!entry) return this.ports.notify("Nothing to redo.");
    this.undoStack.push({ snap: this.ports.snapshot(), label: entry.label });
    this.ports.restore(entry.snap);
    this.ports.notify(`Redid: ${entry.label}`);
  }

  /** Drop the whole trail — e.g. when a *different* tower is adopted. */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
  }
}

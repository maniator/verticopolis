import type { Tower } from "./Tower";
import type { ElevatorSchedule } from "./elevatorSchedule";

/** Deterministic compact signature of an authored schedule: joins exactly the
 *  four player-set fields, so it stays cheap (no JSON of 24-slot arrays'
 *  property structure) and independent of object-property order. */
function schedSig(s: ElevatorSchedule | undefined): string {
  if (!s) return "";
  return `${(s.activeCars?.weekday ?? []).join(",")}/${(s.activeCars?.weekend ?? []).join(",")}~${s.waitingCarResponse ?? ""}~${s.standardFloorDeparture ?? ""}~${(s.homeFloors ?? []).join(",")}`;
}

/**
 * A cheap fingerprint of the player-mutable state: structure, transport config,
 * labels, rents, the No Rate flag, cinema booking policy, retail subtype, and money. It
 * deliberately omits the clock/time fields, so the sub-second time delta
 * *within a single gesture* isn't mistaken for a change when {@link UndoHistory}
 * compares capture-vs-commit to drop no-op gestures. (Money IS included; over
 * long spans income can move it, but a gesture is far too short for that to
 * matter.)
 */
export function towerStateSig(tower: Tower, money: number): string {
  const u = tower.units
    .map(
      // noRate must be part of the signature: taking a unit off the market can
      // be the ONLY mutation of a gesture (an Average unit keeps rent
      // undefined), and a fingerprint blind to it would drop that edit as a
      // no-op, making No Rate un-undoable.
      (x) =>
        `${x.kind}@${x.floor},${x.x}:${x.label ?? ""}:${x.rent ?? ""}:${x.noRate ? "N" : ""}:${x.filmPolicy ?? ""}:${x.subtype ?? ""}`,
    )
    .join(";");
  const r = tower.transports
    // The schedule must be part of the signature: setting it can be the only
    // mutation of a gesture (the Schedule dialog's OK), and a fingerprint blind
    // to it would drop that edit as a no-op, making the apply un-undoable.
    .map(
      (x) =>
        `${x.kind}@${x.x}:${x.bottom}-${x.top}:${x.cars}:${(x.skipFloors ?? []).join(".")}:${schedSig(x.schedule)}`,
    )
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
  /** Restore a snapshot previously returned by {@link snapshot}. The tower
   *  changes before this returns; the promise settles once the restore is
   *  done, and rejects when it failed. */
  restore(snap: string): Promise<void>;
  /** Fingerprint the current player-mutable state (see {@link towerStateSig}). */
  signature(): string;
  /** Which tower is live (`EnginePort.generation`), read around a restore to
   *  tell whether it swapped the tower before it failed. Without it a failed
   *  restore is taken to have left the tower as it was. */
  generation?(): number;
  /** Surface a short user-facing message ("Undid: Bulldoze", "Nothing to undo."). */
  notify(message: string): void;
}

interface Entry {
  snap: string;
  label: string;
  /** The redo steps this step's commit cleared, kept while
   *  {@link UndoHistory.holdClearedRedo} is on (temporary, #874). */
  cleared?: Entry[];
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
  private hold = false;

  constructor(private readonly ports: UndoPorts) {}

  /** While on, a commit keeps the redo steps it clears with its own undo
   *  step, and {@link dropUnchanged} puts them back when it drops that step:
   *  an edit the WASM engine's fallback takes away leaves the redo trail as
   *  it was. One step holds a trail at a time: a later commit that clears a
   *  trail lets the older one go (an undo since then read a restore point
   *  after that step, so no fallback can drop it), and so does turning the
   *  hold off. So the history keeps at most one redo trail beyond what it
   *  keeps with the hold off. The host turns it on while it can fall back.
   *  Temporary, with the fallback (#874). */
  get holdClearedRedo(): boolean {
    return this.hold;
  }

  set holdClearedRedo(on: boolean) {
    this.hold = on;
    if (!on) this.letHeldGo();
  }

  private letHeldGo(): void {
    for (const entry of this.undoStack) delete entry.cleared;
  }

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

  /** Drop a pending capture without committing it. For a gesture that was
   *  CANCELED into pure inspection (a touch hold becoming a peek): commit()'s
   *  no-op check compares signatures, and the signature includes money, so a
   *  sim income tick during the canceled gesture's window would otherwise mint
   *  a misleading entry whose restore rewinds sim-only state. */
  discard(): void {
    this.pending = null;
  }

  /** Finalize the captured snapshot — but only if something actually changed. */
  commit(): void {
    const p = this.pending;
    this.pending = null;
    if (!p || this.ports.signature() === p.sig) return;
    // A fresh action invalidates the redo trail.
    const cleared = this.redoStack.splice(0);
    const entry: Entry = { snap: p.snap, label: p.label };
    if (this.hold && cleared.length > 0) {
      this.letHeldGo();
      entry.cleared = cleared;
    }
    this.undoStack.push(entry);
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
  }

  /** Undo the newest step. The commit, the pop, the redo step's snapshot
   *  and the restore's start all happen before this returns, so two undos in
   *  one task pop two steps in order. The "Undid:" notice follows the
   *  settled restore; a failure gives none and rejects (see {@link step}). */
  undo(): Promise<void> {
    this.commit(); // finalize any in-flight gesture first
    const entry = this.undoStack.pop();
    if (!entry) return this.say("Nothing to undo.");
    return this.step(entry, "undo");
  }

  /** Redo the newest undone step, in the same order as {@link undo}. */
  redo(): Promise<void> {
    this.commit(); // finalize any in-flight gesture first (matches undo)
    const entry = this.redoStack.pop();
    if (!entry) return this.say("Nothing to redo.");
    return this.step(entry, "redo");
  }

  /** Restore `entry`, just popped by an undo or a redo, keeping today's
   *  state as the opposite step. When the snapshot fails, `entry` goes back
   *  where it was. When the restore fails, `entry` stays dropped: its save
   *  would fail again and, kept on top, would block every older step. The
   *  opposite step stays only when the restore swapped the tower before it
   *  failed (it is then the way back); otherwise it holds the tower as it
   *  still is and would change nothing, so it comes off wherever it now
   *  sits. That trail is read again then, as the WASM fallback's tidy may
   *  have replaced it. */
  private step(entry: Entry, kind: "undo" | "redo"): Promise<void> {
    const opposite = () => (kind === "undo" ? this.redoStack : this.undoStack);
    let back: Entry;
    try {
      back = { snap: this.ports.snapshot(), label: entry.label };
    } catch (e) {
      (kind === "undo" ? this.undoStack : this.redoStack).push(entry);
      return Promise.reject(e);
    }
    opposite().push(back);
    const before = this.ports.generation?.();
    let restored: Promise<void>;
    try {
      restored = this.ports.restore(entry.snap);
    } catch (e) {
      restored = Promise.reject(e);
    }
    const swapped = this.ports.generation?.() !== before;
    return restored.then(
      () => this.ports.notify(`${kind === "undo" ? "Undid" : "Redid"}: ${entry.label}`),
      (e: unknown) => {
        const trail = opposite();
        const at = trail.lastIndexOf(back);
        if (!swapped && at >= 0) trail.splice(at, 1);
        throw e;
      },
    );
  }

  private say(message: string): Promise<void> {
    this.ports.notify(message);
    return Promise.resolve();
  }

  /** Drop the newest undo and redo steps that would change nothing now, and
   *  answer how many went. The WASM engine's fallback (#874) can put the
   *  tower back to the state an undo capture read, before the edit it
   *  captured, so that edit's step would undo nothing (the redo steps its
   *  commit cleared come back); and an undo whose own snapshot trapped keeps,
   *  as its redo step, the state it went back to, which would redo nothing.
   *  Both go. A gesture under way keeps its capture, fingerprinted again from
   *  its own snapshot: a capture whose save trapped took the newest restore
   *  point, which is where the fallback went, so a release with nothing done
   *  since leaves no step. `sigOf` fingerprints a snapshot the way
   *  {@link UndoPorts.signature} reads the live state; the host that falls
   *  back passes it. Temporary, with the fallback. */
  dropUnchanged(sigOf: (snap: string) => string): number {
    const now = this.ports.signature();
    let dropped = 0;
    while (this.undoStack.length > 0 && sigOf(this.undoStack[this.undoStack.length - 1].snap) === now) {
      const entry = this.undoStack.pop()!;
      if (entry.cleared) this.redoStack = [...entry.cleared, ...this.redoStack];
      dropped++;
    }
    while (this.redoStack.length > 0 && sigOf(this.redoStack[this.redoStack.length - 1].snap) === now) {
      this.redoStack.pop();
      dropped++;
    }
    if (this.pending) this.pending.sig = sigOf(this.pending.snap);
    return dropped;
  }

  /** Drop the whole trail — e.g. when a *different* tower is adopted. */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
  }
}

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
 * compares capture-vs-commit to drop no-op gestures. `money` is part of it
 * when given; a gesture's comparison leaves it out, since income during a
 * held press is time passing, not an edit.
 */
export function towerStateSig(tower: Tower, money?: number): string {
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
  return `${money ?? ""}|${u}|${r}`;
}

/** Most steps each stack keeps before the oldest is dropped. */
export const UNDO_CAP = 50;

/** One step: a save of the tower before the edit, and the edit's name. */
export interface UndoStep {
  readonly snap: string;
  readonly label: string;
}

/**
 * The reference engine's undo stacks: the two stacks and the rules for them,
 * with no knowledge of the tower. `TsEngine` takes the saves and fingerprints
 * and puts a step back (the port's `undo` and `redo`). A gesture calls
 * {@link capture} on its first change and {@link commit} on its end; the
 * capture is kept only when the tower's fingerprint changed, so a misfired or
 * empty gesture leaves no step. The steps here are whole saves; the Rust
 * engine the game runs keeps only what each edit changed
 * (`engine-rs/src/undo.rs`). Both keep 50 steps a stack and pass the shared
 * lifecycle fixture; this copy goes with the reference engine.
 */
export class UndoHistory {
  private undoStack: UndoStep[] = [];
  private redoStack: UndoStep[] = [];
  private pending: { step: UndoStep; sig: string } | null = null;

  /** Capture the tower before a gesture's first change. It replaces any
   *  earlier capture on purpose: a gesture that captured but bailed before
   *  committing (an early return) must not anchor the next one to its stale
   *  save. */
  capture(snap: string, sig: string, label: string): void {
    this.pending = { step: { snap, label }, sig };
  }

  /** Drop a capture without committing it: a gesture canceled into pure
   *  inspection (a touch hold that became a peek). Its fingerprint holds the
   *  balance, so an income tick inside the window would otherwise make a step
   *  whose restore rewinds sim-only state. */
  discard(): void {
    this.pending = null;
  }

  /** Whether a gesture's capture waits for its commit. */
  hasPending(): boolean {
    return this.pending !== null;
  }

  /** Close the gesture under way. The capture becomes the newest undo step
   *  when `sigNow`, the tower's fingerprint now, differs from the one it was
   *  captured with, and the redo steps go (a fresh edit ends that trail).
   *  Answers whether a step was kept. */
  commit(sigNow: string): boolean {
    const p = this.pending;
    this.pending = null;
    if (!p || p.sig === sigNow) return false;
    this.redoStack.length = 0;
    this.undoStack.push(p.step);
    if (this.undoStack.length > UNDO_CAP) this.undoStack.shift();
    return true;
  }

  popUndo(): UndoStep | undefined {
    return this.undoStack.pop();
  }

  popRedo(): UndoStep | undefined {
    return this.redoStack.pop();
  }

  pushUndo(step: UndoStep): void {
    this.undoStack.push(step);
  }

  pushRedo(step: UndoStep): void {
    this.redoStack.push(step);
  }

  /** Forget every step and the gesture under way: another tower was adopted. */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
  }

  /** How many steps each stack holds. */
  depths(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}

/** What `undo` and `redo` answer when there is no step to take
 *  (`NOTHING_TO_STEP` in `engine-rs/src/wasm_port_undo.rs`, and
 *  `UNDO_NOTHING_TO_STEP` on the port). */
const NOTHING_TO_STEP = 2;

/** What the reference engine's undo steps need of the engine. */
export interface UndoHost {
  /** The tower's save, and its undo signature. */
  serialize(): string;
  undoSignature(): string;
  /** Put a save in place of the tower, keeping the live camera and bridging
   *  setting and the steps: `restore`. Answers `[status, generation]`. */
  restore(text: string): Float64Array;
  generation(): number;
  /** Forget the refusal text of the last call. */
  clearReason(): void;
}

/**
 * The reference engine's undo and redo: the steps (`UndoHistory`), the
 * gesture's capture and commit over the tower's save and signature, and a step
 * back or forward as a restore. The port behavior matches the Rust engine's
 * `wasm_port_undo.rs` where the shared lifecycle fixture pins it.
 */
export class UndoSteps {
  readonly history = new UndoHistory();
  notice: string | undefined;

  constructor(private readonly host: UndoHost) {}

  /** A gesture already open is closed first and kept if it changed the
   *  tower, as the Rust engine keeps it. */
  capture(label: string): void {
    this.commit();
    this.history.capture(this.host.serialize(), this.host.undoSignature(), label);
  }

  commit(): boolean {
    if (!this.history.hasPending()) return false;
    return this.history.commit(this.host.undoSignature());
  }

  depths(): Float64Array {
    const { undo, redo } = this.history.depths();
    return Float64Array.of(undo, redo);
  }

  /** An undo or a redo: close the gesture under way, take the newest step
   *  and restore it, keeping today's tower as the opposite step once the
   *  restore put the other back. A refused restore leaves the tower and the
   *  opposite stack as they were, and the step goes back where it was, as
   *  the Rust engine keeps a refused step. */
  step(way: "undo" | "redo"): Float64Array {
    this.notice = undefined;
    this.commit();
    const step = way === "undo" ? this.history.popUndo() : this.history.popRedo();
    if (!step) {
      this.host.clearReason();
      this.notice = way === "undo" ? "Nothing to undo." : "Nothing to redo.";
      return Float64Array.of(NOTHING_TO_STEP, this.host.generation());
    }
    const back = { snap: this.host.serialize(), label: step.label };
    const record = this.host.restore(step.snap);
    if (record[0] === 1) {
      if (way === "undo") this.history.pushRedo(back);
      else this.history.pushUndo(back);
      this.notice = `${way === "undo" ? "Undid" : "Redid"}: ${step.label}`;
    } else if (way === "undo") this.history.pushUndo(step);
    else this.history.pushRedo(step);
    return record;
  }
}

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
 * *within a single gesture* isn't mistaken for a change when the undo history (`src/game/UndoHistory.ts`)
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

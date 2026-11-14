import type { FacilityKind } from "../shared/types";
import type { EnginePort } from "./enginePort";

/**
 * The person card (#2092), decoded from the port's `personCard` record. The
 * slots and code tables come from the port's own `viewLayout()`, so the game
 * imports no engine at runtime. The card is cheap: read it while the card is
 * open, on the UI tick, never per frame.
 */

/** Why a person is out, as the engine names it (`personPurposes`). */
export type PersonPurpose =
  | "toWork"
  | "fromWork"
  | "leaveHome"
  | "returnHome"
  | "toVenue"
  | "fromVenue"
  | "meal"
  | "visit"
  | "schoolRun"
  | "salesCall"
  | "housekeeping"
  | "unknown";

/** A housekeeper's step in their working day (`shiftSteps`). */
export type ShiftStep = "in" | "base" | "job" | "free" | "home" | "out";

/** One end of a leg (`tripPlaces`). A room carries its id and kind. */
export type TripPlace =
  | { place: "none" }
  | { place: "room"; id: number; kind: FacilityKind; floor: number }
  | { place: "floor" | "lobby" | "metro"; floor: number };

export interface PersonDetail {
  id: number;
  state: string;
  floor: number;
  x: number;
  staff: boolean;
  purpose: PersonPurpose;
  /** On the way back from a meal or a visit. */
  returning: boolean;
  /** A housekeeper's step; null for anyone else. */
  shift: ShiftStep | null;
  /** For a housekeeper, the housekeeping room they work from. */
  from: TripPlace;
  to: TripPlace;
  /** The current wait in the crowd's own seconds, the unit of the
   *  catalog's `fedUpWait` (the mood). */
  wait: number;
  waitMinutes: number;
  /** Every wait of this trip so far, the current one included. */
  tripWaitMinutes: number;
  /** The shaft taken next, waited at or ridden; null when the trip takes none. */
  shaftId: number | null;
}

interface Layout {
  kinds: readonly string[];
  personStates: readonly string[];
  personPurposes: readonly string[];
  tripPlaces: readonly string[];
  shiftSteps: readonly string[];
  records: { personCard: readonly string[] };
}

export type PersonCardPort = Pick<EnginePort, "viewLayout" | "personCard">;

export class PersonCards {
  /** The layout and the card's slots, read once on the first card: a game
   *  that never opens one never parses it. */
  private names: { layout: Layout; at: Record<string, number> } | null = null;

  constructor(private readonly port: PersonCardPort) {}

  private slots(): { layout: Layout; at: Record<string, number> } {
    if (!this.names) {
      const layout = JSON.parse(this.port.viewLayout()) as Layout;
      this.names = { layout, at: Object.fromEntries(layout.records.personCard.map((n, i) => [n, i])) };
    }
    return this.names;
  }

  /** Person `id`'s card, or undefined when nobody by that id is in the tower. */
  person(id: number): PersonDetail | undefined {
    const r = this.port.personCard(id);
    if (r.length === 0) return undefined;
    const { layout: l, at } = this.slots();
    const shift = r[at.shiftStep];
    const shaft = r[at.shaftId];
    return {
      id: r[at.id],
      state: l.personStates[r[at.stateCode]],
      floor: r[at.floor],
      x: r[at.x],
      staff: r[at.staff] === 1,
      purpose: l.personPurposes[r[at.purpose]] as PersonPurpose,
      returning: r[at.returning] === 1,
      shift: Number.isNaN(shift) ? null : (l.shiftSteps[shift] as ShiftStep),
      from: this.end(r, "from"),
      to: this.end(r, "to"),
      wait: r[at.wait],
      waitMinutes: r[at.waitMinutes],
      tripWaitMinutes: r[at.tripWaitMinutes],
      shaftId: Number.isNaN(shaft) ? null : shaft,
    };
  }

  private end(r: Float64Array, side: "from" | "to"): TripPlace {
    const { layout, at } = this.slots();
    const place = layout.tripPlaces[r[at[`${side}Place`]]];
    const floor = r[at[`${side}Floor`]];
    if (place === "room") {
      return { place, id: r[at[`${side}Unit`]], kind: layout.kinds[r[at[`${side}Kind`]]] as FacilityKind, floor };
    }
    if (place === "floor" || place === "lobby" || place === "metro") return { place, floor };
    return { place: "none" };
  }
}

import type { FacilityKind, UnitState, VacateReason } from "../engine/types";
import type { EnginePort } from "./enginePort";
import type { HourlyView, OriginsView, StopRow, TransportDetail, UnitDetail } from "./panels";
import type { ViewReader } from "./viewReader";

/**
 * The inspector and editor cards, decoded from the port's flat records
 * (contract sections 2 and 5): `unitCard` into a `UnitDetail` and `shaftCard`
 * into a `TransportDetail`. The slots and code tables come from the port's own
 * `viewLayout()`, so the game imports no engine at runtime.
 *
 * `unitCard` is cheap and answers fresh every call. `shaftCard` copies the
 * shaft's hourly load and up to about 5,280 origin pairs, so {@link Cards.shaft}
 * keeps each answer until the tower swaps, its revision moves, the hour
 * changes, or the caller says a command changed the shaft ({@link Cards.forget}).
 * Ask on selection, on those moves, never per frame or per UI tick.
 */

interface Layout {
  kinds: readonly string[];
  unitStates: readonly string[];
  vacateReasons: readonly string[];
  filmPolicies: readonly string[];
  records: { unitCard: readonly string[]; shaftCard: readonly string[]; stopRow: readonly string[] };
}

/** The port members the cards read. */
export type CardPort = Pick<EnginePort, "viewLayout" | "unitCard" | "shaftCard" | "unitLabel" | "unitSubtype" | "generation">;

const HOURS = 24;
const DAYS = 2;

/** `names` mapped to their slot positions in a record. */
function slots(names: readonly string[]): Record<string, number> {
  return Object.fromEntries(names.map((n, i) => [n, i]));
}

const nullable = (n: number): number | null => (Number.isNaN(n) ? null : n);
const named = <T extends string>(table: readonly string[], code: number): T | null => (Number.isNaN(code) ? null : ((table[code] as T | undefined) ?? null));

export class Cards {
  private readonly layout: Layout;
  private readonly unitAt: Record<string, number>;
  private readonly shaftAt: Record<string, number>;
  private readonly stopAt: Record<string, number>;
  private key = "";
  private readonly shafts = new Map<number, TransportDetail>();

  constructor(
    private readonly port: CardPort,
    private readonly reader: Pick<ViewReader, "tower" | "header">,
  ) {
    this.layout = JSON.parse(port.viewLayout()) as Layout;
    this.unitAt = slots(this.layout.records.unitCard);
    this.shaftAt = slots(this.layout.records.shaftCard);
    this.stopAt = slots(this.layout.records.stopRow);
  }

  /** Unit `id`'s card, or undefined for an id that names no unit. */
  unit(id: number): UnitDetail | undefined {
    const r = this.port.unitCard(id);
    if (r.length === 0) return undefined;
    const at = this.unitAt;
    const l = this.layout;
    const blockbuster = r[at.blockbuster];
    return {
      id: r[at.id],
      kind: l.kinds[r[at.kindCode]] as FacilityKind,
      floor: r[at.floor],
      x: r[at.x],
      width: r[at.width],
      state: l.unitStates[r[at.stateCode]] as UnitState,
      satisfaction: r[at.satisfaction],
      occupants: r[at.occupants],
      customersIn: nullable(r[at.customersIn]),
      residents: nullable(r[at.residents]),
      everOccupied: r[at.everOccupied] === 1,
      noRate: r[at.noRate] === 1,
      rent: nullable(r[at.rent]),
      price: r[at.price],
      label: this.port.unitLabel(id) ?? "",
      subtype: this.port.unitSubtype(id) ?? null,
      vacateReason: named<VacateReason>(l.vacateReasons, r[at.vacateReason]),
      filmPolicy: named<"auto" | "feature" | "blockbuster">(l.filmPolicies, r[at.filmPolicy]),
      served: r[at.served] === 1,
      reachable: r[at.reachable] === 1,
      floorHasLobby: r[at.floorHasLobby] === 1,
      blockbuster: Number.isNaN(blockbuster) ? null : blockbuster === 1,
    };
  }

  /** Shaft `id`'s card, or undefined for an id that names no shaft. */
  shaft(id: number): TransportDetail | undefined {
    const key = `${this.port.generation()}:${this.reader.tower.revision}:${Math.floor(this.reader.header.minuteOfDay / 60)}`;
    if (key !== this.key) {
      this.key = key;
      this.shafts.clear();
    }
    const kept = this.shafts.get(id);
    if (kept) return kept;
    const r = this.port.shaftCard(id);
    if (r.length === 0) return undefined;
    const card = this.decodeShaft(r);
    this.shafts.set(id, card);
    return card;
  }

  /** Drop the kept shaft cards: a command changed a shaft's cars, stops or
   *  ends, and the next {@link shaft} asks the port again. */
  forget(): void {
    this.shafts.clear();
  }

  private decodeShaft(r: Float64Array): TransportDetail {
    const at = this.shaftAt;
    const head = this.layout.records.shaftCard.length;
    let i = head;
    let hourly: HourlyView | null = null;
    if (r[at.hourly] === 1) {
      hourly = { weekday: Array.from(r.subarray(i, i + HOURS)), weekend: Array.from(r.subarray(i + HOURS, i + 2 * HOURS)) };
      i += DAYS * HOURS;
    }
    const stops: StopRow[] = [];
    const s = this.stopAt;
    const width = this.layout.records.stopRow.length;
    for (let n = 0; n < r[at.stops]; n++, i += width) {
      stops.push({ floor: r[i + s.floor], served: r[i + s.served] === 1, lobby: r[i + s.lobby] === 1, endpoint: r[i + s.endpoint] === 1 });
    }
    let origins: OriginsView | null = null;
    if (r[at.origins] === 1) {
      const rings: [number, number][][] = [];
      for (let ring = 0; ring < DAYS * HOURS; ring++) {
        const pairs: [number, number][] = [];
        const size = r[i++];
        for (let p = 0; p < size; p++, i += 2) pairs.push([r[i], r[i + 1]]);
        rings.push(pairs);
      }
      origins = { weekday: rings.slice(0, HOURS), weekend: rings.slice(HOURS) };
    }
    return {
      id: r[at.id],
      kind: this.layout.kinds[r[at.kindCode]] as FacilityKind,
      x: r[at.x],
      width: r[at.width],
      bottom: r[at.bottom],
      top: r[at.top],
      cars: r[at.cars],
      capacity: r[at.capacity],
      utilization: nullable(r[at.utilization]),
      hourly,
      origins,
      stops,
    };
  }
}

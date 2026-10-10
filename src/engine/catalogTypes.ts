/**
 * The catalog's shape: the types a frontend reads the catalog through, and the
 * shape version. Kept free of the engine's tables (type-only imports) so a
 * frontend that reads the catalog from the WASM binding never bundles the
 * TypeScript engine. `catalog.ts` builds a catalog of this shape;
 * `engine-rs/src/catalog.rs` serializes the same one.
 */
import type { CalendarKind } from "./calendar";
import type { FacilityCategory, FacilityKind, GameMode } from "./types";

/** The version of the catalog's shape. It moves when a field is added,
 *  renamed or removed, so a frontend can refuse a shape it does not know. */
export const CATALOG_VERSION = 1;

/** Every price, size and build rule of one mode. */
export interface Catalog {
  /** {@link CATALOG_VERSION}. */
  readonly version: number;
  /** The mode the values are resolved for. */
  readonly mode: GameMode;
  readonly world: CatalogWorld;
  readonly economy: CatalogEconomy;
  /** The caps several kinds share, in the engine's order. */
  readonly pools: readonly CatalogPool[];
  /** One entry per facility kind in the engine's catalog order, the kinds this
   *  mode cannot build included (`available: false`). */
  readonly facilities: readonly CatalogFacility[];
}

/** The tower geometry a placement needs. */
export interface CatalogWorld {
  /** The buildable lot width in tiles. */
  readonly lotWidth: number;
  /** The lowest floor. Floors number without a gap: 1 is the ground floor,
   *  0 the first basement. */
  readonly minFloor: number;
  readonly maxFloor: number;
  /** The ground floor, where the main lobby sits. */
  readonly groundFloor: number;
  /** What the floor tool lays on the ground floor (a lobby, at the lobby's price). */
  readonly groundFloorStructure: FacilityKind;
  /** Floors between lobbies: besides the ground floor, a sky lobby may sit on
   *  every floor from 2 up that is a multiple of it (15, 30, ...). */
  readonly lobbyInterval: number;
}

/** The mode's economy constants a UI shows, in dollars. */
export interface CatalogEconomy {
  /** The treasury a new tower starts with. */
  readonly startingMoney: number;
  /** The price of one more elevator car on a shaft. The editor charges it
   *  today; #914 moves the charge into an engine command. */
  readonly addCarCost: number;
  /** What removing a car refunds (the editor pays it today, as above). */
  readonly carResaleRefund: number;
  /** The price of each floor an elevator spans past its first. The build
   *  charges it; the editor charges it again per floor an extend adds (moving
   *  into the engine with #914). Stairs and escalators pay none. */
  readonly transportFloorCost: number;
  /** The calendars a tower of this mode can run, its default first. Every
   *  `...Monthly` figure here and each facility's `upkeepMonthly` is quoted per
   *  30-day real-world month: the engine charges it once per maintenance
   *  period, multiplied by that calendar's `maintenanceScale`. */
  readonly calendars: readonly CatalogCalendar[];
  /** Monthly upkeep per elevator car. */
  readonly maintenancePerCarMonthly: number;
  /** Monthly operating overhead per leasable or trading unit (0 where the
   *  mode charges none). */
  readonly overheadPerUnitMonthly: number;
  /** Monthly tax on an unsold condo as a fraction of its asking price (0
   *  where the mode charges none). Each period the engine charges
   *  `ceil(price * rate)`, multiplied by `maintenanceScale` and rounded. */
  readonly condoHoldTaxRate: number;
  /** A cinema's monthly film booking, and its blockbuster booking. */
  readonly cinemaBookingMonthly: number;
  readonly cinemaBookingBlockbusterMonthly: number;
  /** A nightclub's monthly DJ booking. */
  readonly nightclubDjMonthly: number;
  /** The paid exterminator's fees, or null where the mode has none. */
  readonly exterminator: { readonly calloutFee: number; readonly perRoomFee: number } | null;
  /** Whether the player can switch automatic bridging off. */
  readonly autoBridgeToggleable: boolean;
}

/** One calendar a tower can run and how it scales the quoted figures. */
export interface CatalogCalendar {
  /** As a save names it. */
  readonly key: CalendarKind;
  /** Days per quarter, when quarterly rent lands. */
  readonly quarterDays: number;
  /** Days between maintenance charges (and monthly rent collections). */
  readonly maintenancePeriodDays: number;
  /** What a `...Monthly` figure and a monthly rent are multiplied by on each
   *  maintenance period. */
  readonly maintenanceScale: number;
  /** What a quarterly rent is multiplied by when the quarter lands. */
  readonly quarterlyRentScale: number;
}

/** A cap several kinds share. */
export interface CatalogPool {
  /** The name a {@link CatalogFacility.pool} refers to it by. */
  readonly key: "elevators" | "walkways";
  /** The label the engine's refusal names the pool by. */
  readonly label: string;
  /** The most units of all its kinds together a tower may hold. */
  readonly cap: number;
  readonly kinds: readonly FacilityKind[];
}

/** When a price is collected: `quarterly` (offices and the lease amenities,
 *  scaled by the calendar's `quarterlyRentScale`), `maintenancePeriod` (rental
 *  living, every maintenance period, scaled by `maintenanceScale`), `sale` (a
 *  condo, once) or `nightly` (hotel rooms). */
export type CatalogRentCadence = "quarterly" | "maintenancePeriod" | "sale" | "nightly";

/** How the player prices a kind: a ladder of fixed rungs (Classic) or a
 *  continuous band (Modern). */
export type CatalogRent =
  | {
      readonly shape: "ladder";
      readonly cadence: CatalogRentCadence;
      /** The price a new unit starts at (the Average rung). */
      readonly default: number;
      readonly rungs: readonly { readonly level: number; readonly label: string; readonly value: number }[];
      /** A ladder always offers the No Rate off-market state. */
      readonly noRate: true;
    }
  | {
      readonly shape: "band";
      readonly cadence: CatalogRentCadence;
      /** The price a new unit starts at. */
      readonly default: number;
      readonly min: number;
      readonly max: number;
      readonly step: number;
      /** A band never offers No Rate. */
      readonly noRate: false;
    };

/** One facility kind, resolved for the catalog's mode. */
export interface CatalogFacility {
  /** The key saves and commands name the kind by. */
  readonly key: FacilityKind;
  readonly name: string;
  readonly category: FacilityCategory;
  /** Width in tiles. A transport's width is its shaft's. */
  readonly width: number;
  /** Height in floors (1 for an ordinary room, and 1 for a transport, whose
   *  height is its span). */
  readonly floors: number;
  /** The build price. An elevator adds `transportFloorCost` for each floor past
   *  its first (top minus bottom). A room adds the floor's price for every
   *  floor tile laid under it. With automatic bridging on, every gap tile
   *  bridged to the tower adds one substrate tile: the lobby's price when
   *  placing a lobby (on any floor), the floor's price for a floor tile or a
   *  room. */
  readonly cost: number;
  /** The star rating that unlocks it. */
  readonly minStar: number;
  /** The people it holds (tenants, residents or customers at a time). */
  readonly population: number;
  /** The audience an attendance venue seats, or null. */
  readonly attendance: number | null;
  readonly modernOnly: boolean;
  readonly transport: boolean;
  /** A staff-only transport (the service elevator). */
  readonly staffOnly: boolean;
  /** Built underground only. */
  readonly basement: boolean;
  /** Never built underground. */
  readonly noBasement: boolean;
  /** Whether this mode can build it at all (the star gate aside). */
  readonly available: boolean;
  /** In-game minutes of construction (0 for structure and for transports,
   *  which work as soon as they are placed). */
  readonly buildMinutes: number;
  /** What selling it refunds (a gutted unit refunds nothing). */
  readonly resaleRefund: number;
  /** The most a tower may hold of this kind alone, or null when uncapped. */
  readonly buildCap: number | null;
  /** The {@link CatalogPool.key} of the cap it shares, or null. */
  readonly pool: CatalogPool["key"] | null;
  /** For a transport, the largest top floor minus bottom floor it may have,
   *  else null. It serves `maxSpan + 1` floors: stairs and escalators have 1
   *  and link two floors. */
  readonly maxSpan: number | null;
  /** A fixed two-floor transport placed with one tap and never resized. */
  readonly fixedSpan: boolean;
  /** For an elevator, the most cars a shaft takes, else null. */
  readonly maxCars: number | null;
  /** For a transport, the passengers one car (or one flight) carries, else null. */
  readonly carCapacity: number | null;
  /** The varieties a new unit draws from, in the engine's order, or null. */
  readonly subtypes: readonly string[] | null;
  /** How the player prices it in this mode, or null when its price is not
   *  player-set. */
  readonly rent: CatalogRent | null;
  /** A trading venue's headline daily take in this mode, or null: the ceiling
   *  the money loop pays a sold-out venue. */
  readonly dailyIncome: number | null;
  /** The average ticket per customer the engine counts customers with, for the
   *  venues that track them in this mode (those with subtypes and a daily
   *  income), else null. */
  readonly spendPerCustomer: number | null;
  /** A service facility's monthly maintenance, or null. */
  readonly upkeepMonthly: number | null;
}


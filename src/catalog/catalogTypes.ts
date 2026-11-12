/**
 * The catalog's shape: the types a frontend reads the catalog through, the
 * shape version, and the lookup by kind ({@link catalogFacility}). Kept free
 * of the engine's tables (type-only imports) so a frontend that reads the
 * catalog from the WASM binding never bundles the TypeScript engine. `catalog.ts` builds a catalog of this shape;
 * `engine-rs/src/catalog.rs` serializes the same one.
 */
import type { CalendarKind } from "../shared/engineTypes";
import type { FacilityCategory, FacilityKind, GameMode } from "../shared/types";
import type { FilmPolicy, FilmTier, TicketPrice } from "../simport/commands";

/** A film a theater can show, as the catalog publishes it (#1950). */
export interface CatalogFilm {
  readonly key: FilmTier;
  /** What the card calls it ("New film", "Feature", ...). */
  readonly label: string;
  /** What showing it costs, charged once. */
  readonly price: number;
}

/** An Auto-rebook choice for a Modern theater (#1950): the policy the save
 *  stores, and the film it books again once the theater's film is spent, or
 *  null where rebooking is off. */
export interface CatalogFilmRebook {
  readonly policy: FilmPolicy;
  readonly film: FilmTier | null;
}

/** A ticket price step for a Modern theater (#1950): what it multiplies a
 *  seat's ticket income by, and the share of the crowd's visits the theater
 *  draws, both against Normal's 1. */
export interface CatalogTicketPrice {
  readonly key: TicketPrice;
  /** What the card calls it ("Low", "Normal", ...). */
  readonly label: string;
  readonly incomeMult: number;
  readonly pickMult: number;
}

/** The version of the catalog's shape. It moves when a field is added,
 *  renamed or removed, so a frontend can refuse a shape it does not know. */
export const CATALOG_VERSION = 14;

/** Every price, size and build rule of one mode. */
export interface Catalog {
  /** {@link CATALOG_VERSION}. */
  readonly version: number;
  /** The mode the values are resolved for. */
  readonly mode: GameMode;
  readonly world: CatalogWorld;
  readonly economy: CatalogEconomy;
  readonly rules: CatalogRules;
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
  /** What the floor tool lays on the ground floor: a lobby. A current game
   *  holds no plain floor there, so each tile the floor tool lays pays for
   *  its floor too (`paysForFloor`). */
  readonly groundFloorStructure: FacilityKind;
  /** Floors between lobbies: besides the ground floor, a sky lobby may sit on
   *  every floor from 2 up that is a multiple of it (15, 30, ...). */
  readonly lobbyInterval: number;
}

/** The mode's economy constants a UI shows, in dollars. */
export interface CatalogEconomy {
  /** The treasury a new tower starts with. */
  readonly startingMoney: number;
  /** The price of one more elevator car on a shaft (the engine's `addCar`
   *  charges it). */
  readonly addCarCost: number;
  /** What the engine's `removeCar` refunds for one car. */
  readonly carResaleRefund: number;
  /** The price of each floor an elevator spans past its first. The build
   *  charges it, and the engine's `extendTransport` charges it for each floor
   *  an extend adds. Stairs and escalators pay none. */
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
  /** A nightclub's monthly DJ booking. */
  readonly nightclubDjMonthly: number;
  /** Hour of the daily garbage-truck collection that empties recycling bins. */
  readonly garbageCollectHour: number;
  /** The paid exterminator's fees, or null where the mode has none. */
  readonly exterminator: { readonly calloutFee: number; readonly perRoomFee: number } | null;
  /** The films a theater can show, with their prices, in the order the card
   *  lists them (#1932, #1950). No theater pays anything each period. */
  readonly films: readonly CatalogFilm[];
  /** The Auto-rebook choices, in the order the card's button cycles through
   *  them (#1950); empty where no theater rebooks (Classic). */
  readonly filmRebooks: readonly CatalogFilmRebook[];
  /** The policy a theater with none, or an old save's "auto", rebooks by,
   *  or null where no theater rebooks. */
  readonly filmRebookDefault: FilmPolicy | null;
  /** The screens a theater runs, each with its own film, age, Auto-rebook
   *  choice and booking: 1 in Classic, 2 in Modern (#1950). */
  readonly cinemaScreens: number;
  /** A theater's ticket price steps, cheapest first, in the order the card's
   *  button cycles through them (#1950); empty where the mode has none
   *  (Classic). */
  readonly ticketPrices: readonly CatalogTicketPrice[];
  /** The step a theater with none set charges, or null where the mode has no
   *  ticket price. */
  readonly ticketPriceDefault: TicketPrice | null;
  /** Whether the player can switch automatic bridging off. When false,
   *  bridging is always on. When true, a tower starts bridged unless it was
   *  founded unbridged, and the live setting is per tower (the engine's
   *  `autoBridge()`, the save's `autoBridge`). */
  readonly autoBridgeToggleable: boolean;
}

/** Mode rules a frontend shows the player, each stated from the engine's own
 *  rule method, so a frontend reads them here instead of deciding them from
 *  the mode's name. */
export interface CatalogRules {
  /** Whether a sold condo carries its own household of 2 to 5 that prices
   *  the sale and counts its residents. When false every condo houses the
   *  flat family and stores no household. */
  readonly variantHouseholds: boolean;
  /** Whether the build preview names the engine's refusal before the click.
   *  When false the refusal shows only once a click is refused. */
  readonly previewNamesRefusal: boolean;
  /** Whether the elevator schedule's assisted tools answer: the intent
   *  presets, auto-tune and the staffing advice. When false the schedule is
   *  the manual grid only and each assisted query is refused. */
  readonly scheduleAssist: boolean;
  /** Whether the player may place new construction while the game is
   *  paused. When false a placement at speed 0 is refused with a note to
   *  unpause; the engine itself has no paused state. */
  readonly buildsWhilePaused: boolean;
  /** Whether the tower can be exported for SimTower (1994) as a `.TDT`.
   *  When false the export dialog disables that choice with the reason, and
   *  the engine's `.TDT` export refuses the tower. */
  readonly exportsTo1994: boolean;
  /** Whether the tenant card's lobby warning quotes the floors to the
   *  nearest lobby. When false it names the problem without the number. */
  readonly quotesLobbyDistance: boolean;
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
   *  floor tile laid under it, and so does a kind that pays for its floor
   *  (`paysForFloor`) placed where there is no floor yet (see
   *  `catalogTileCost`). With automatic bridging on, every gap tile bridged to
   *  the tower adds one substrate tile: the lobby's price plus the floor's
   *  when placing a lobby (on any floor), the floor's price for a floor tile
   *  or a room. */
  readonly cost: number;
  /** Whether a tile of this kind placed where there is no floor yet also
   *  pays the floor's price, for the floor it lays (the lobby). Over a floor
   *  tile it pays `cost` alone. */
  readonly paysForFloor: boolean;
  /** The star rating that unlocks it. */
  readonly minStar: number;
  /** The people it holds (tenants, residents or customers at a time). */
  readonly population: number;
  /** The most residents a household-sized unit may carry, or null. */
  readonly maxHousehold: number | null;
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
  /** Whether it is open in each hour of the day, 0 to 23, for a kind that
   *  keeps business hours, else null (always open). */
  readonly openHours: readonly boolean[] | null;
  /** Whether a unit may carry its own household size (`residents`), which
   *  then stands in for `population`; a condo's price scales with it against
   *  the condo's `population`. */
  readonly ownHousehold: boolean;
  /** A foot-traffic trading kind: the predicate the lobby-proximity rule
   *  keys off, and the noise rule too, less the quiet spa and daycare. */
  readonly commercial: boolean;
  /** A hotel room of any size. */
  readonly hotel: boolean;
  /** A Modern lease amenity (fitness club, clinic): lease tenants that erode
   *  on unserved placement and an over-market rent. */
  readonly leaseAmenity: boolean;
  /** A demand tenant whose unmet local coverage drains satisfaction (office,
   *  condo, apartment, hotel rooms). */
  readonly unmetDemand: boolean;
  /** The venue's cross-floor halo in this mode, or null (#1980): the
   *  placement range rings draw it. */
  readonly halo: CatalogHalo | null;
  /** How far the room's same-floor noise carries and how far it hears its
   *  neighbors, which the placement overlay draws; empty in Classic. */
  readonly noise: readonly CatalogNoise[];
}

/** A venue's cross-floor halo: who feels it, over how many floors and how
 *  hard. A room `d` floors from the venue feels `max * (1 - d / floors)`,
 *  and none at `floors` or beyond. */
export interface CatalogHalo {
  /** `lift` (an amenity) or `drain` (a nuisance). */
  readonly effect: "lift" | "drain";
  readonly floors: number;
  /** The hourly bonus or drain on the venue's own floor. */
  readonly max: number;
  /** How far a lift raises a capped room's ceiling at full strength, or
   *  null for a drain. */
  readonly capLift: number | null;
  /** The facility keys that feel it. */
  readonly feltBy: readonly FacilityKind[];
  /** Felt only in the venue's `openHours`. */
  readonly openHoursOnly: boolean;
  /** Scaled by the household's size, largest for the biggest family. */
  readonly familyScaled: boolean;
}

/** One reach of a room's same-floor noise. The tile beside the room is tile
 *  0, so a room of the other side within `tiles + 1` tiles of an edge counts;
 *  a lobby tile or a gap in the floor stops it. */
export interface CatalogNoise {
  /** `carries`: the room makes noise `kinds` hear. `hears`: the room hears
   *  noise `kinds` make. */
  readonly role: "carries" | "hears";
  readonly tiles: number;
  /** The facility keys on the other side. */
  readonly kinds: readonly FacilityKind[];
}

const facilityIndex = new WeakMap<Catalog, ReadonlyMap<FacilityKind, CatalogFacility>>();

/** The catalog entry for `kind`, or undefined when the catalog lists no such
 *  kind (a kind from another build, or a damaged save). */
export function findCatalogFacility(catalog: Catalog, kind: FacilityKind): CatalogFacility | undefined {
  let index = facilityIndex.get(catalog);
  if (!index) {
    index = new Map(catalog.facilities.map((f) => [f.key, f]));
    facilityIndex.set(catalog, index);
  }
  return index.get(kind);
}

/** The catalog entry for `kind`. Throws when the catalog lists no such kind,
 *  which only a damaged catalog or a kind from another build can cause. */
export function catalogFacility(catalog: Catalog, kind: FacilityKind): CatalogFacility {
  const f = findCatalogFacility(catalog, kind);
  if (!f) throw new Error(`the ${catalog.mode} catalog lists no facility "${kind}"`);
  return f;
}

/** What a build of `kind` on `floor` lays, by the catalog's ground-floor rule:
 *  the floor tool lays the world's ground-floor structure (a lobby) on the
 *  ground floor, and every other build lays its own kind. */
export function catalogBuildKind(catalog: Catalog, kind: FacilityKind, floor: number): FacilityKind {
  return kind === "floor" && floor === catalog.world.groundFloor ? catalog.world.groundFloorStructure : kind;
}

/** What a structure tile is placed on: open space with no floor yet, or a
 *  floor tile that it turns into its own kind. */
export type TileGround = "no floor yet" | "a floor tile";

/** The price of one structure tile of `kind` (a floor or a lobby tile)
 *  placed on `ground`, by the catalog's rule: a kind that pays for its floor
 *  (`paysForFloor`, the lobby) adds the floor's price where there is no
 *  floor yet, and pays its own price alone over a floor tile. */
export function catalogTileCost(catalog: Catalog, kind: FacilityKind, ground: TileGround): number {
  const f = catalogFacility(catalog, kind);
  return f.paysForFloor && ground === "no floor yet" ? f.cost + catalogFacility(catalog, "floor").cost : f.cost;
}

/** The editor card's action for showing a `key` film on screen `screen`
 *  (from 0; `data-edit`). The first screen's keeps the one-screen name. */
export function filmEditAction(key: FilmTier, screen = 0): string {
  return screen === 0 ? `${key}Film` : `${key}Film${screen + 1}`;
}

/** The editor card's action for stepping screen `screen`'s Auto-rebook
 *  choice (from 0; `data-edit`). */
export function filmPolicyEditAction(screen = 0): string {
  return screen === 0 ? "filmPolicy" : `filmPolicy${screen + 1}`;
}

/** The Auto-rebook choice a theater with `policy` follows: its own where the
 *  catalog lists it, otherwise the mode's default (no policy, or an old
 *  save's "auto"). Null where no theater rebooks (#1950). */
export function catalogFilmRebook(catalog: Catalog, policy: FilmPolicy | null | undefined): CatalogFilmRebook | null {
  const { filmRebooks, filmRebookDefault } = catalog.economy;
  const listed = (p: FilmPolicy | null | undefined) => filmRebooks.find((r) => r.policy === p);
  return listed(policy) ?? listed(filmRebookDefault) ?? null;
}

/** The ticket price step a theater charges: its own where the catalog lists
 *  it, otherwise the mode's default. Null where the mode has no ticket price
 *  (#1950). */
export function catalogTicketPrice(catalog: Catalog, price: TicketPrice | null | undefined): CatalogTicketPrice | null {
  const { ticketPrices, ticketPriceDefault } = catalog.economy;
  const listed = (p: TicketPrice | null | undefined) => ticketPrices.find((t) => t.key === p);
  return listed(price) ?? listed(ticketPriceDefault) ?? null;
}

/** Whether a facility is open in `hour` (the game hour; fractions and 24 read
 *  as the engines read them, since every opening and closing is on the hour):
 *  always, for a kind that keeps no business hours. */
export function catalogOpenAt(f: CatalogFacility, hour: number): boolean {
  return f.openHours === null || f.openHours[((Math.floor(hour) % 24) + 24) % 24] === true;
}

/** The people a unit holds: its own household where the kind carries one and
 *  the unit has it, else the catalog's `population`. */
export function catalogResidents(f: CatalogFacility, residents: number | null | undefined): number {
  return f.ownHousehold && residents != null ? residents : f.population;
}

/** A condo's price for its household: the asking `base` scaled by household
 *  size against the classic household, the condo's catalog `population`. No
 *  household (Classic, or an unsold unit) is exactly the base. */
export function catalogHouseholdPrice(catalog: Catalog, base: number, residents: number | null | undefined): number {
  if (residents == null) return base;
  return Math.round((base * residents) / catalogFacility(catalog, "condo").population);
}

/** The rung of a ladder a value sits on: the nearest, ties rounding up to the
 *  higher rung, and Average (the third rung) for a non-finite value. The
 *  engine's own snap (`snapToLadder`) is this rule. */
export function rungFor<R extends { readonly value: number }>(rungs: readonly R[], value: number): R {
  if (!Number.isFinite(value)) return rungs[2];
  let best = rungs[0];
  let bestDist = Infinity;
  for (const r of rungs) {
    const d = Math.abs(value - r.value);
    // `<=` so an exact tie prefers the later (higher) rung.
    if (d <= bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best;
}

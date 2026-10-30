//! The catalog: the reference data a frontend draws a build menu, a price
//! label or a placement ghost from, read out of the engine's own tables and
//! resolved for one mode, so a frontend never applies a rule itself.
//!
//! [`catalog`] returns a [`Catalog`]: the world geometry a placement needs,
//! the economy constants a UI shows, the pooled build caps, and one
//! [`FacilityEntry`] per facility kind in the engine's catalog order (its
//! key, name, size, price, star gate, capacity, build time, resale refund,
//! build cap, transport limits, subtypes and rent configuration). It
//! serializes to JSON with the TypeScript engine's camelCase keys, and the
//! WASM binding hands frontends the same text (`catalog(mode)`).
//!
//! The TypeScript engine builds the same catalog from its own tables
//! (`src/engine/catalog.ts`), and `conformance/catalog-digests.json` pins the
//! canonical hash of each mode's catalog, so the two engines cannot quote
//! a different price or size while both exist. A catalog change is a deliberate
//! change to that lock.
//!
//! Presentation stays with the frontend: display copy beyond the facility
//! name, icons, sprite sizes in pixels and colors are not here.

use serde::Serialize;
use serde_json::Value;

use crate::canonical::{canonical_json, digest};
use crate::charges::{car_resale_refund, ADD_CAR_COST, TRANSPORT_FLOOR_COST};
use crate::clock::{resolve_calendar, CalendarKind, GameMode};
use crate::econ::{classic_ladder, rent_config};
use crate::economy::{
    commercial_daily_income, retail_spend_per_customer, service_maintenance_monthly,
    CINEMA_BOOKING_BLOCKBUSTER, CINEMA_BOOKING_MONTHLY, MAINTENANCE_PER_CAR_MONTHLY,
    NIGHTCLUB_DJ_MONTHLY, REAL_WORLD_MAINT_PERIOD_DAYS,
};
use crate::facilities::{
    build_cap, ground_floor_structure_kind, no_basement, Kind, FACILITIES, LOBBY_INTERVAL,
    LOT_WIDTH, MAX_FLOOR, MIN_FLOOR, POOLED_CAPS,
};
use crate::sim::STARTING_MONEY;

mod lock;

pub use lock::{lock_view, LOCK_FOOTPRINT_EXEMPT};

/// The version of the catalog's shape. It moves when a field is added,
/// renamed or removed, so a frontend can refuse a shape it does not know.
pub const CATALOG_VERSION: u32 = 2;

/// Every price, size and build rule of one mode.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    /// [`CATALOG_VERSION`].
    pub version: u32,
    /// The mode the values are resolved for: `classic` or `modern`.
    pub mode: &'static str,
    pub world: World,
    pub economy: Economy,
    /// The caps several kinds share, in the engine's order.
    pub pools: Vec<PoolEntry>,
    /// One entry per facility kind, in the engine's catalog order, the
    /// kinds this mode cannot build included (`available: false`).
    pub facilities: Vec<FacilityEntry>,
}

/// The tower geometry a placement needs.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    /// The buildable lot width in tiles.
    pub lot_width: i64,
    /// The lowest floor (the deepest basement). Floors number without a gap:
    /// 1 is the ground floor, 0 the first basement.
    pub min_floor: i64,
    /// The highest floor.
    pub max_floor: i64,
    /// The ground floor, where the main lobby sits.
    pub ground_floor: i64,
    /// What the floor tool lays on the ground floor (a lobby, at the
    /// lobby's price).
    pub ground_floor_structure: &'static str,
    /// Floors between lobbies: besides the ground floor, a sky lobby may sit
    /// on every floor from 2 up that is a multiple of it (15, 30, ...).
    pub lobby_interval: i64,
}

/// The mode's economy constants a UI shows, in dollars.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Economy {
    /// The treasury a new tower starts with.
    pub starting_money: f64,
    /// The price of one more elevator car on a shaft (`add_car` charges it).
    pub add_car_cost: f64,
    /// What `remove_car` refunds for one car.
    pub car_resale_refund: f64,
    /// The price of each floor an elevator spans past its first. The build
    /// charges it, and `extend_transport` charges it for each floor an extend
    /// adds. Stairs and escalators pay none.
    pub transport_floor_cost: f64,
    /// The calendars a tower of this mode can run, its default first. Every
    /// `...Monthly` figure here and each facility's `upkeepMonthly` is quoted
    /// per 30-day real-world month: the engine charges it once per
    /// maintenance period, multiplied by that calendar's `maintenanceScale`.
    pub calendars: Vec<CalendarEntry>,
    /// Monthly upkeep per elevator car.
    pub maintenance_per_car_monthly: f64,
    /// Monthly operating overhead per leasable or trading unit (0 where the
    /// mode charges none).
    pub overhead_per_unit_monthly: f64,
    /// Monthly tax on an unsold condo, as a fraction of its asking price (0
    /// where the mode charges none). Each period the engine charges
    /// `ceil(price * rate)`, multiplied by `maintenanceScale` and rounded.
    pub condo_hold_tax_rate: f64,
    /// A cinema's monthly film booking, and its blockbuster booking.
    pub cinema_booking_monthly: f64,
    pub cinema_booking_blockbuster_monthly: f64,
    /// A nightclub's monthly DJ booking.
    pub nightclub_dj_monthly: f64,
    /// The paid exterminator's fees, or null where the mode has none.
    pub exterminator: Option<ExterminatorFees>,
    /// Whether the player can switch automatic bridging off. When false,
    /// bridging is always on. When true, a tower starts bridged unless it
    /// was founded unbridged, and the live setting is per tower (the
    /// engine's `autoBridge()`, the save's `autoBridge`).
    pub auto_bridge_toggleable: bool,
}

/// One calendar a tower can run and how it scales the quoted figures.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEntry {
    /// `canon` or `realWorld`, as a save names it.
    pub key: &'static str,
    /// Days per quarter, when quarterly rent lands.
    pub quarter_days: i64,
    /// Days between maintenance charges (and monthly rent collections).
    pub maintenance_period_days: i64,
    /// What a `...Monthly` figure and a monthly rent are multiplied by on
    /// each maintenance period.
    pub maintenance_scale: f64,
    /// What a quarterly rent is multiplied by when the quarter lands.
    pub quarterly_rent_scale: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExterminatorFees {
    /// The flat fee of one call.
    pub callout_fee: f64,
    /// Added per infested room treated.
    pub per_room_fee: f64,
}

/// A cap several kinds share.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolEntry {
    /// The name a [`FacilityEntry::pool`] refers to it by.
    pub key: &'static str,
    /// The label the engine's refusal names the pool by.
    pub label: &'static str,
    /// The most units of all its kinds together a tower may hold.
    pub cap: i64,
    /// The facility keys that share it.
    pub kinds: Vec<&'static str>,
}

/// One facility kind, resolved for the catalog's mode.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilityEntry {
    /// The key saves and commands name the kind by.
    pub key: &'static str,
    pub name: &'static str,
    /// `structure`, `transport`, `office`, `residential`, `hotel`, `food`,
    /// `retail`, `entertainment`, `service` or `special`.
    pub category: &'static str,
    /// Width in tiles. A transport's width is its shaft's.
    pub width: i64,
    /// Height in floors (1 for an ordinary room, and 1 for a transport,
    /// whose height is its span).
    pub floors: i64,
    /// The build price. An elevator adds `transportFloorCost` for each floor
    /// past its first (top minus bottom). A room adds the floor's price for
    /// every floor tile laid under it. With automatic bridging on, every gap
    /// tile bridged to the tower adds one substrate tile: the lobby's price
    /// when placing a lobby (on any floor), the floor's price for a floor
    /// tile or a room.
    pub cost: f64,
    /// The star rating that unlocks it.
    pub min_star: i64,
    /// The people it holds (tenants, residents or customers at a time).
    pub population: i64,
    /// The audience an attendance venue seats, or null.
    pub attendance: Option<i64>,
    pub modern_only: bool,
    pub transport: bool,
    /// A staff-only transport (the service elevator).
    pub staff_only: bool,
    /// Built underground only.
    pub basement: bool,
    /// Never built underground.
    pub no_basement: bool,
    /// Whether this mode can build it at all (the star gate aside).
    pub available: bool,
    /// In-game minutes of construction (0 for structure and for transports,
    /// which work as soon as they are placed).
    pub build_minutes: f64,
    /// What selling it refunds (a gutted unit refunds nothing).
    pub resale_refund: f64,
    /// The most a tower may hold of this kind alone, or null when uncapped.
    pub build_cap: Option<i64>,
    /// The [`PoolEntry::key`] of the cap it shares, or null.
    pub pool: Option<&'static str>,
    /// For a transport, the largest top floor minus bottom floor it may
    /// have, else null. It serves `maxSpan + 1` floors: stairs and
    /// escalators have 1 and link two floors.
    pub max_span: Option<i64>,
    /// For a transport, whether it is a fixed two-floor unit placed with one
    /// tap and never resized (stairs, escalators).
    pub fixed_span: bool,
    /// For an elevator, the most cars a shaft takes, else null.
    pub max_cars: Option<i64>,
    /// For a transport, the passengers one car (or one flight) carries, else null.
    pub car_capacity: Option<f64>,
    /// The varieties a new unit draws from, in the engine's order, or null.
    pub subtypes: Option<Vec<&'static str>>,
    /// How the player prices it in this mode, or null when its price is not
    /// player-set.
    pub rent: Option<Rent>,
    /// A trading venue's headline daily take in this mode, or null: the
    /// ceiling the money loop pays a sold-out venue.
    pub daily_income: Option<f64>,
    /// The average ticket per customer the engine counts customers with,
    /// for the venues that track them in this mode (those with subtypes and
    /// a daily income), else null.
    pub spend_per_customer: Option<f64>,
    /// A service facility's monthly maintenance, or null.
    pub upkeep_monthly: Option<f64>,
    /// Whether it is open in each hour of the day, 0 to 23, for a kind that
    /// keeps business hours (`hasBusinessHours`), else null (always open).
    pub open_hours: Option<Vec<bool>>,
    /// Whether a unit may carry its own household size (`residents`), which
    /// then stands in for `population`; a condo's price scales with it
    /// against the condo's `population` (`householdPrice`).
    pub own_household: bool,
}

/// How the player prices a kind: a ladder of fixed rungs (Classic) or a
/// continuous band (Modern).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "shape",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Rent {
    /// Four rungs plus the No Rate off-market state.
    Ladder {
        /// When the price is collected: `quarterly`, `maintenancePeriod`, `sale` or `nightly`.
        cadence: &'static str,
        /// The price a new unit starts at (the Average rung).
        default: f64,
        rungs: Vec<Rung>,
        /// Whether the mode offers No Rate (always true on a ladder).
        no_rate: bool,
    },
    /// Any price from `min` to `max` in steps of `step`.
    Band {
        /// When the price is collected: `quarterly`, `maintenancePeriod`, `sale` or `nightly`.
        cadence: &'static str,
        /// The price a new unit starts at.
        default: f64,
        min: f64,
        max: f64,
        step: f64,
        /// Whether the mode offers No Rate (always false on a band).
        no_rate: bool,
    },
}

/// One rung of a price ladder.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rung {
    /// 0 (Very Low) to 3 (High).
    pub level: i64,
    pub label: &'static str,
    pub value: f64,
}

const RUNG_LABELS: [&str; 4] = ["Very Low", "Low", "Average", "High"];

/// The key each of [`POOLED_CAPS`] goes by, in its order.
const POOL_KEYS: [&str; 2] = ["elevators", "walkways"];
const _: () = assert!(
    POOL_KEYS.len() == POOLED_CAPS.len(),
    "every pooled cap needs a key"
);

/// The calendars a mode can run, its default first.
fn calendars_for(mode: GameMode) -> Vec<CalendarEntry> {
    let kinds: &[CalendarKind] = match mode {
        GameMode::Classic => &[CalendarKind::Canon],
        GameMode::Modern => &[CalendarKind::RealWorld, CalendarKind::Canon],
    };
    kinds
        .iter()
        .map(|&kind| {
            let c = resolve_calendar(mode, kind);
            CalendarEntry {
                key: c.kind.as_str(),
                quarter_days: c.quarter_days,
                maintenance_period_days: c.maint_period_days,
                maintenance_scale: c.maint_period_days as f64 / REAL_WORLD_MAINT_PERIOD_DAYS,
                quarterly_rent_scale: mode.quarterly_rent_scale(c.quarter_days),
            }
        })
        .collect()
}

/// When a priced kind's price is collected: `quarterly` (offices and the
/// lease amenities, scaled by the calendar's `quarterlyRentScale`),
/// `maintenancePeriod` (rental living, every maintenance period, scaled by
/// `maintenanceScale`), `sale` (a condo, once) or `nightly` (hotel rooms).
/// A priced kind with no collector here is a programming error, so the
/// `one_entry_per_kind_in_catalog_order` test builds every mode's catalog
/// and trips it before a build ships.
fn rent_cadence(kind: Kind) -> &'static str {
    match kind {
        Kind::Office | Kind::FitnessClub | Kind::Clinic => "quarterly",
        Kind::RentalStudio | Kind::RentalApartment => "maintenancePeriod",
        Kind::Condo => "sale",
        Kind::HotelSingle | Kind::HotelDouble | Kind::HotelSuite => "nightly",
        _ => unreachable!("{kind:?} has a price but no rent cadence"),
    }
}

/// `rules.priceOptions(kind)` as a [`Rent`]: the canon ladder in Classic for
/// the kinds that have one, the tuned band in Modern for every priced kind.
fn rent_for(mode: GameMode, kind: Kind) -> Option<Rent> {
    match mode {
        GameMode::Classic => classic_ladder(kind).map(|values| Rent::Ladder {
            cadence: rent_cadence(kind),
            default: values[2],
            rungs: values
                .iter()
                .enumerate()
                .map(|(i, &value)| Rung {
                    level: i as i64,
                    label: RUNG_LABELS[i],
                    value,
                })
                .collect(),
            no_rate: true,
        }),
        GameMode::Modern => rent_config(kind).map(|c| Rent::Band {
            cadence: rent_cadence(kind),
            default: c.default,
            min: c.min,
            max: c.max,
            step: c.step,
            no_rate: false,
        }),
    }
}

fn pool_key(kind: Kind) -> Option<&'static str> {
    POOLED_CAPS
        .iter()
        .position(|p| p.kinds.contains(&kind))
        .map(|i| POOL_KEYS[i])
}

fn facility_entry(mode: GameMode, kind: Kind) -> FacilityEntry {
    let f = kind.facility();
    let transport = kind.is_transport();
    FacilityEntry {
        key: f.key,
        name: f.name,
        category: f.category.as_str(),
        width: f.width,
        floors: kind.floors(),
        cost: f.cost,
        min_star: f.min_star,
        population: f.population,
        attendance: f.attendance,
        modern_only: f.modern_only,
        transport,
        staff_only: f.staff_only,
        basement: f.basement,
        no_basement: no_basement(kind),
        available: !f.modern_only || mode.is_modern(),
        build_minutes: if transport { 0.0 } else { kind.build_minutes() },
        resale_refund: kind.resale_refund(),
        build_cap: build_cap(kind),
        pool: pool_key(kind),
        max_span: transport.then(|| kind.max_span()),
        fixed_span: kind.is_fixed_span(),
        max_cars: kind.is_elevator().then(|| kind.max_cars()),
        car_capacity: transport.then(|| kind.car_capacity()),
        subtypes: kind.subtype_list().map(|l| l.to_vec()),
        rent: rent_for(mode, kind),
        daily_income: commercial_daily_income(mode, kind),
        spend_per_customer: kind
            .subtype_list()
            .and(commercial_daily_income(mode, kind))
            .and_then(|_| retail_spend_per_customer(kind)),
        upkeep_monthly: service_maintenance_monthly(kind),
        open_hours: kind
            .has_business_hours()
            .then(|| (0..24).map(|hour| kind.is_open_at(hour)).collect()),
        own_household: kind.has_household(),
    }
}

/// The catalog for `mode`.
pub fn catalog(mode: GameMode) -> Catalog {
    Catalog {
        version: CATALOG_VERSION,
        mode: mode.as_str(),
        world: World {
            lot_width: LOT_WIDTH,
            min_floor: MIN_FLOOR,
            max_floor: MAX_FLOOR,
            ground_floor: 1,
            ground_floor_structure: ground_floor_structure_kind(Kind::Floor, 1).as_str(),
            lobby_interval: LOBBY_INTERVAL,
        },
        economy: Economy {
            starting_money: STARTING_MONEY,
            add_car_cost: ADD_CAR_COST,
            car_resale_refund: car_resale_refund(),
            transport_floor_cost: TRANSPORT_FLOOR_COST,
            calendars: calendars_for(mode),
            maintenance_per_car_monthly: MAINTENANCE_PER_CAR_MONTHLY,
            overhead_per_unit_monthly: mode.operating_overhead_per_unit(),
            condo_hold_tax_rate: mode.condo_hold_tax_rate(),
            cinema_booking_monthly: CINEMA_BOOKING_MONTHLY,
            cinema_booking_blockbuster_monthly: CINEMA_BOOKING_BLOCKBUSTER,
            nightclub_dj_monthly: NIGHTCLUB_DJ_MONTHLY,
            exterminator: mode
                .infestation_recovery()
                .map(|(callout_fee, per_room_fee)| ExterminatorFees {
                    callout_fee,
                    per_room_fee,
                }),
            auto_bridge_toggleable: mode.bridging_toggleable(),
        },
        pools: POOLED_CAPS
            .iter()
            .zip(POOL_KEYS)
            .map(|(p, key)| PoolEntry {
                key,
                label: p.label,
                cap: p.cap,
                kinds: p.kinds.iter().map(|k| k.as_str()).collect(),
            })
            .collect(),
        facilities: FACILITIES
            .iter()
            .map(|f| facility_entry(mode, f.kind))
            .collect(),
    }
}

/// The catalog for `mode` as a JSON value.
pub fn catalog_value(mode: GameMode) -> Value {
    serde_json::to_value(catalog(mode)).expect("the catalog serializes")
}

/// The catalog for `mode` as canonical JSON text: the bytes the lock hashes,
/// and what the WASM binding returns.
pub fn catalog_json(mode: GameMode) -> String {
    canonical_json(&catalog_value(mode))
}

/// The canonical hash of the catalog for `mode`, as
/// `conformance/catalog-digests.json` records it: the lock view, so the
/// exempt footprints do not move it.
pub fn catalog_digest(mode: GameMode) -> String {
    digest(&lock_view(&catalog_value(mode)))
}

#[cfg(test)]
mod tests;

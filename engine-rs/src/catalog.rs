//! The catalog: every price, size and build rule a frontend reads, resolved
//! for one game mode. Port of `src/engine/catalog.ts` (`catalogFor`), which
//! builds the same JSON from the TypeScript tables; `conformance/catalog.json`
//! pins the canonical hash of each mode's catalog, and both engines must
//! reproduce it.
//!
//! Everything here reads the tables the simulation itself reads (the
//! facility rows, the caps and pools, the rent bands and ladders, the rule
//! methods on the mode), so the catalog cannot drift from what the engine
//! enforces. Presentation (colors, descriptions, labels, icons) stays with
//! the frontend. Where a price depends on placement (a shaft's span, a sold
//! condo's household) the catalog carries the formula's inputs and this
//! module the function. `transport_build_cost` returns NaN for a span the
//! engine refuses, so a frontend never quotes a placement that cannot be
//! built.
//!
//! Open hours are whole hours by construction: the clock hands `is_open_at`
//! an integer hour (`Clock::hour` floors the minute of the day), so the 24
//! hourly samples are the whole schedule.

use serde::Serialize;

use crate::canonical::digest;
use crate::churn::HOUSEHOLD_SIZES;
use crate::clock::GameMode;
use crate::econ::{car_resale_refund, ADD_CAR_COST, GUTTED_RESALE_REFUND, TRANSPORT_FLOOR_COST};
use crate::economy::{commercial_daily_income, daily_traffic_income, retail_spend_per_customer};
use crate::facilities::{
    build_cap, ground_floor_structure_kind, is_available_in_mode, is_lobby_floor,
    is_sky_lobby_floor, max_cars_entry, no_basement, Kind, FACILITIES, GROUND_FLOOR,
    LOBBY_INTERVAL, LOT_WIDTH, MAX_FLOOR, MIN_FLOOR, POOLED_CAPS, WEDDING_HALL_FLOOR,
};
use crate::rent::{price_options, PriceOptions};
use crate::rules::CLASSIC_HOUSEHOLD;

pub use crate::churn::household_price;
pub use crate::econ::{transport_build_cost, transport_floor_cost};

/// The rung labels of the Classic ladder, in rung order.
const RUNG_LABELS: [&str; 4] = ["Very Low", "Low", "Average", "High"];

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub mode: &'static str,
    pub facilities: Vec<CatalogFacility>,
    pub world: CatalogWorld,
    pub economy: CatalogEconomy,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFacility {
    pub key: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    /// Width in tiles.
    pub width: i64,
    /// Height in floors (1 for a single-story room).
    pub floors: i64,
    pub cost: f64,
    pub min_star: i64,
    pub population: i64,
    /// Seat capacity of an attendance venue, else null.
    pub attendance: Option<i64>,
    pub modern_only: bool,
    /// Whether the kind can be built at all in this mode.
    pub available: bool,
    pub transport: bool,
    pub staff_only: bool,
    /// Basement only: the whole facility sits below floor 1.
    pub basement: bool,
    /// Never below floor 1 (offices, condos, hotels need daylight).
    pub no_basement: bool,
    /// The one floor the kind may sit on (the wedding hall), else null.
    pub only_floor: Option<i64>,
    /// What this tool lays on the ground floor when that differs from the
    /// kind (the floor tool lays lobby there), else null.
    pub ground_floor_kind: Option<&'static str>,
    pub commercial: bool,
    /// The hours (0 to 23) a venue with posted hours is open, else null.
    /// Whole hours by construction (see the module docs).
    pub open_hours: Option<Vec<i64>>,
    /// In-game minutes from placement to opening.
    pub build_minutes: f64,
    /// What selling a working unit returns (a gutted one returns
    /// `economy.guttedResaleRefund`).
    pub resale_refund: f64,
    /// The per-tower cap, or the shared cap of the pool the kind is in. No
    /// kind is in both an individual cap table and a pool (a test pins it);
    /// if one ever were, the catalog would need both caps as separate fields.
    pub build_cap: Option<i64>,
    /// The pool's name when `build_cap` is shared with other kinds.
    pub cap_pool: Option<&'static str>,
    /// Transports: the most floors of span (top minus bottom).
    pub max_span: Option<i64>,
    /// Transports: placed as a fixed two-floor flight, never dragged.
    pub fixed_span: bool,
    /// Elevators: the most cars one shaft holds.
    pub max_cars: Option<i64>,
    /// Transports: riders one car (or one flight) carries per trip.
    pub car_capacity: Option<f64>,
    /// Transports: the price of each floor of span (top minus bottom) on top
    /// of `cost` (`transport_floor_cost`, which `transport_build_cost` reads);
    /// zero for a walkway.
    pub floor_cost: Option<f64>,
    pub subtypes: Option<Vec<&'static str>>,
    /// The mode's headline daily take for a commercial venue.
    pub daily_income: Option<f64>,
    /// The tuned daily take the venue diagnostics score against in both
    /// modes (`ECON.dailyTrafficIncome`).
    pub traffic_baseline: Option<f64>,
    /// The average ticket per customer the diagnostics divide by.
    pub spend_per_customer: Option<f64>,
    pub rent: Option<CatalogRent>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRung {
    pub level: i64,
    pub label: &'static str,
    pub value: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogBand {
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogHousehold {
    /// The household sizes a sale can roll.
    pub sizes: Vec<i64>,
    /// The size the asking price is quoted for: the sale fetches
    /// `household_price(asking, size)`, round(asking * size / reference).
    pub reference: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogRent {
    /// When the price is collected: `quarter`, `month`, `night` or `sale`.
    pub cadence: &'static str,
    /// `ladder` (Classic rungs) or `band` (Modern range).
    pub shape: &'static str,
    /// What a unit charges at its neutral price: the Average rung on a
    /// ladder, the band default on a band.
    pub default: f64,
    pub ladder: Option<Vec<CatalogRung>>,
    pub band: Option<CatalogBand>,
    /// Whether the unit can be taken off the market (No Rate).
    pub no_rate: bool,
    /// Whether the price locks once the unit has sold (a condo).
    pub locked_once_sold: bool,
    /// Modern condos sell to a rolled household that scales the price.
    pub household: Option<CatalogHousehold>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogWorld {
    pub lot_width: i64,
    pub min_floor: i64,
    pub max_floor: i64,
    pub ground_floor: i64,
    pub lobby_interval: i64,
    /// Every floor a lobby may go on: the ground floor and every
    /// `lobby_interval`th floor above it.
    pub lobby_floors: Vec<i64>,
    /// The sky-lobby floors (a claimed one takes no rooms anywhere on it).
    pub sky_lobby_floors: Vec<i64>,
    pub escalators_on_office_floors: bool,
    pub auto_bridge_toggleable: bool,
    pub preview_shows_reason: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEconomy {
    pub add_car_cost: f64,
    pub car_resale_refund: f64,
    pub transport_floor_cost: f64,
    pub gutted_resale_refund: f64,
}

/// The cadence a priced kind collects on.
fn cadence(kind: Kind) -> &'static str {
    if kind == Kind::Condo {
        "sale"
    } else if kind.is_hotel() {
        "night"
    } else if kind.is_rental() {
        "month"
    } else {
        "quarter"
    }
}

fn rent(mode: GameMode, kind: Kind) -> Option<CatalogRent> {
    let opts = price_options(mode, kind)?;
    let (shape, ladder, band) = match opts {
        PriceOptions::Ladder { rungs, .. } => {
            // A rung's level is its place on the ladder (Very Low is 0).
            let rungs = (0..)
                .zip(rungs)
                .map(|(level, value): (usize, f64)| CatalogRung {
                    level: level as i64,
                    label: RUNG_LABELS[level],
                    value,
                })
                .collect();
            ("ladder", Some(rungs), None)
        }
        PriceOptions::Band(c) => (
            "band",
            None,
            Some(CatalogBand {
                default: c.default,
                min: c.min,
                max: c.max,
                step: c.step,
            }),
        ),
    };
    let household =
        (mode.has_variant_households() && kind == Kind::Condo).then(|| CatalogHousehold {
            sizes: HOUSEHOLD_SIZES.to_vec(),
            reference: CLASSIC_HOUSEHOLD,
        });
    Some(CatalogRent {
        cadence: cadence(kind),
        shape,
        default: opts.neutral(),
        ladder,
        band,
        no_rate: opts.offers_no_rate(),
        locked_once_sold: kind == Kind::Condo,
        household,
    })
}

fn facility(mode: GameMode, kind: Kind) -> CatalogFacility {
    let f = kind.facility();
    let pool = POOLED_CAPS.iter().find(|p| p.kinds.contains(&kind));
    let ground = ground_floor_structure_kind(kind, GROUND_FLOOR);
    CatalogFacility {
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
        available: is_available_in_mode(kind, mode),
        transport: f.transport,
        staff_only: f.staff_only,
        basement: f.basement,
        no_basement: no_basement(kind),
        only_floor: (kind == Kind::WeddingHall).then_some(WEDDING_HALL_FLOOR),
        ground_floor_kind: (ground != kind).then(|| ground.as_str()),
        commercial: kind.is_commercial(),
        open_hours: kind
            .has_business_hours()
            .then(|| (0..24).filter(|&h| kind.is_open_at(h)).collect()),
        build_minutes: kind.build_minutes(),
        resale_refund: kind.resale_refund(),
        build_cap: build_cap(kind).or(pool.map(|p| p.cap)),
        cap_pool: pool.map(|p| p.label),
        max_span: f.transport.then(|| kind.max_span()),
        fixed_span: kind.is_fixed_span(),
        max_cars: max_cars_entry(kind),
        car_capacity: f.transport.then(|| kind.car_capacity()),
        floor_cost: f.transport.then(|| transport_floor_cost(kind)),
        subtypes: kind.subtype_list().map(|l| l.to_vec()),
        daily_income: commercial_daily_income(mode, kind),
        traffic_baseline: daily_traffic_income(kind),
        spend_per_customer: retail_spend_per_customer(kind),
        rent: rent(mode, kind),
    }
}

/// The catalog for `mode`: every facility in catalog order, the lot, and the
/// economy constants a frontend shows.
pub fn catalog(mode: GameMode) -> Catalog {
    let floors = MIN_FLOOR..=MAX_FLOOR;
    Catalog {
        mode: mode.as_str(),
        facilities: FACILITIES.iter().map(|f| facility(mode, f.kind)).collect(),
        world: CatalogWorld {
            lot_width: LOT_WIDTH,
            min_floor: MIN_FLOOR,
            max_floor: MAX_FLOOR,
            ground_floor: GROUND_FLOOR,
            lobby_interval: LOBBY_INTERVAL,
            lobby_floors: floors.clone().filter(|&f| is_lobby_floor(f)).collect(),
            sky_lobby_floors: floors.filter(|&f| is_sky_lobby_floor(f)).collect(),
            escalators_on_office_floors: mode.allows_escalator_on_office_floors(),
            auto_bridge_toggleable: mode.bridging_toggleable(),
            preview_shows_reason: mode.shows_preview_reason(),
        },
        economy: CatalogEconomy {
            add_car_cost: ADD_CAR_COST,
            car_resale_refund: car_resale_refund(),
            transport_floor_cost: TRANSPORT_FLOOR_COST,
            gutted_resale_refund: GUTTED_RESALE_REFUND,
        },
    }
}

/// The catalog as a JSON value, the shape both the binding and the hash use.
pub fn catalog_json(mode: GameMode) -> serde_json::Value {
    serde_json::to_value(catalog(mode)).expect("the catalog serializes")
}

/// The canonical hash of `mode`'s catalog, the value `conformance/catalog.json`
/// pins.
pub fn catalog_digest(mode: GameMode) -> String {
    digest(&catalog_json(mode))
}

/// Read the pinned catalog hashes from `conformance/catalog.json`.
pub fn pinned_digests(text: &str) -> Result<Vec<(GameMode, String)>, String> {
    let v: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("catalog.json: {e}"))?;
    let modes = v
        .get("catalog")
        .and_then(|c| c.as_object())
        .ok_or("catalog.json: no catalog object")?;
    let mut out = Vec::new();
    for mode in [GameMode::Classic, GameMode::Modern] {
        let hash = modes
            .get(mode.as_str())
            .and_then(|h| h.as_str())
            .ok_or_else(|| format!("catalog.json: no {} hash", mode.as_str()))?;
        out.push((mode, hash.to_string()));
    }
    if modes.len() != out.len() {
        return Err("catalog.json: a mode other than classic and modern".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both modes' catalogs hash to the values the TypeScript engine pinned.
    #[test]
    fn catalog_matches_the_pinned_hashes() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/catalog.json");
        let text = std::fs::read_to_string(path).expect("conformance/catalog.json");
        for (mode, want) in pinned_digests(&text).unwrap() {
            assert_eq!(catalog_digest(mode), want, "{} catalog", mode.as_str());
        }
    }

    /// Look a row up by its key, the way a frontend reads the catalog.
    fn row<'a>(c: &'a Catalog, key: &str) -> &'a CatalogFacility {
        c.facilities
            .iter()
            .find(|f| f.key == key)
            .unwrap_or_else(|| panic!("no catalog row {key}"))
    }

    /// The canon section of CLAUDE.md, as the catalog states it.
    #[test]
    fn catalog_states_the_canon_caps_and_pools() {
        let c = catalog(GameMode::Classic);
        for k in ["elevatorStandard", "elevatorService", "elevatorExpress"] {
            assert_eq!(row(&c, k).build_cap, Some(24));
            assert_eq!(row(&c, k).cap_pool, Some("elevator shafts"));
            assert_eq!(row(&c, k).max_cars, Some(8));
        }
        for k in ["stairs", "escalator"] {
            assert_eq!(row(&c, k).build_cap, Some(64));
            assert!(row(&c, k).fixed_span);
            assert_eq!(row(&c, k).max_span, Some(1));
            assert_eq!(row(&c, k).max_cars, None);
        }
        assert_eq!(row(&c, "elevatorStandard").max_span, Some(30));
        assert_eq!(row(&c, "elevatorService").max_span, Some(30));
        assert_eq!(row(&c, "elevatorExpress").max_span, Some(109));
        assert_eq!(row(&c, "metro").build_cap, Some(1));
        assert_eq!(row(&c, "metro").cap_pool, None);
        assert_eq!(row(&c, "office").build_cap, None);
        assert_eq!(row(&c, "weddingHall").only_floor, Some(WEDDING_HALL_FLOOR));
        assert_eq!(row(&c, "floor").ground_floor_kind, Some("lobby"));
    }

    /// The catalog states one cap per kind (`build_cap`, with `cap_pool`
    /// naming a pool). That holds only while no kind sits in both an
    /// individual cap table and a pool; if one ever did, the catalog would
    /// need both caps as separate fields.
    #[test]
    fn no_kind_is_in_both_a_cap_table_and_a_pool() {
        for pool in POOLED_CAPS.iter() {
            for &k in pool.kinds {
                assert_eq!(build_cap(k), None, "{k:?}");
            }
        }
    }

    /// Open hours are whole hours by construction: `Clock::hour` is an
    /// integer, so the 24 hourly samples are the whole schedule.
    #[test]
    fn open_hours_cover_every_minute_of_the_day() {
        let cal = crate::clock::REAL_WORLD;
        for mode in [GameMode::Classic, GameMode::Modern] {
            for f in catalog(mode).facilities {
                let kind = FACILITIES.iter().find(|r| r.key == f.key).unwrap().kind;
                let Some(listed) = f.open_hours else {
                    assert!(!kind.has_business_hours(), "{}", f.key);
                    continue;
                };
                let mut open: Vec<i64> = Vec::new();
                for m in 0..1440 {
                    let hour = crate::clock::Clock::new(1440.0 + m as f64, cal).hour();
                    if kind.is_open_at(hour) && !open.contains(&hour) {
                        open.push(hour);
                    }
                }
                assert_eq!(open, listed, "{}", f.key);
            }
        }
    }

    #[test]
    fn rent_resolves_per_mode() {
        let classic = catalog(GameMode::Classic);
        let modern = catalog(GameMode::Modern);
        let condo = row(&classic, "condo").rent.as_ref().unwrap();
        assert_eq!(condo.shape, "ladder");
        assert_eq!(condo.default, 150_000.0);
        assert!(condo.no_rate && condo.household.is_none());
        let labels: Vec<_> = condo
            .ladder
            .as_ref()
            .unwrap()
            .iter()
            .map(|r| (r.level, r.label))
            .collect();
        assert_eq!(
            labels,
            vec![(0, "Very Low"), (1, "Low"), (2, "Average"), (3, "High")]
        );
        let condo = row(&modern, "condo").rent.as_ref().unwrap();
        assert_eq!(condo.shape, "band");
        assert_eq!(condo.default, 160_000.0);
        assert!(!condo.no_rate);
        assert_eq!(condo.household.as_ref().unwrap().sizes, vec![2, 3, 4, 5]);
        // A Modern-only priced kind has no Classic ladder and is not
        // available there.
        let fit = row(&classic, "fitnessClub");
        assert!(fit.rent.is_none() && !fit.available);
        assert!(row(&modern, "fitnessClub").available);
        assert!(row(&classic, "lobby").rent.is_none());
    }

    const TRANSPORTS: [Kind; 5] = [
        Kind::ElevatorStandard,
        Kind::ElevatorService,
        Kind::ElevatorExpress,
        Kind::Stairs,
        Kind::Escalator,
    ];

    /// The build path charges what the catalog quotes, for every transport
    /// kind.
    #[test]
    fn transport_cost_matches_the_build_path() {
        let mut sim = crate::sim::Simulation::new_game(7, GameMode::Classic);
        sim.money = 10_000_000.0;
        sim.star = 5;
        for x in 150..230 {
            for fl in 1..=12 {
                let r = sim.build(Kind::Floor, fl, x);
                assert!(r.ok, "floor {fl} @ {x}: {:?}", r.reason);
            }
        }
        let shafts = [
            (Kind::ElevatorStandard, 155, 10),
            (Kind::ElevatorService, 170, 11),
            (Kind::ElevatorExpress, 185, 7),
            (Kind::Stairs, 200, 1),
            (Kind::Escalator, 215, 1),
        ];
        for (kind, x, span) in shafts {
            let before = sim.money;
            let r = sim.build_transport(kind, x, 1, 1 + span);
            assert!(r.ok, "{kind:?}: {:?}", r.reason);
            assert_eq!(
                before - sim.money,
                transport_build_cost(kind, span),
                "{kind:?}"
            );
        }
        assert_eq!(transport_build_cost(Kind::ElevatorStandard, 10), 250_000.0);
        assert_eq!(transport_build_cost(Kind::Stairs, 1), 5_000.0);
        assert_eq!(household_price(160_000.0, Some(5)), 266_667.0);
    }

    /// Every valid span quotes the formula the build path charges.
    #[test]
    fn transport_quote_matches_the_formula_for_every_valid_span() {
        for kind in TRANSPORTS {
            for span in 1..=kind.max_span() {
                assert_eq!(
                    transport_build_cost(kind, span),
                    crate::econ::transport_cost_for_span(kind, span),
                    "{kind:?} {span}"
                );
            }
        }
    }

    /// A span the engine refuses gets no price.
    #[test]
    fn transport_quote_is_nan_for_a_refused_span() {
        for kind in TRANSPORTS {
            let max = kind.max_span();
            for span in [0, -1, max + 1] {
                assert!(transport_build_cost(kind, span).is_nan(), "{kind:?} {span}");
            }
            if kind.is_fixed_span() {
                assert!(transport_build_cost(kind, 2).is_nan(), "{kind:?}");
            }
        }
        assert!(transport_build_cost(Kind::ElevatorStandard, 31).is_nan());
        assert!(transport_build_cost(Kind::ElevatorExpress, 110).is_nan());
        assert!(!transport_build_cost(Kind::ElevatorExpress, 109).is_nan());
        assert!(transport_build_cost(Kind::Office, 1).is_nan());
    }
}

//! The running charges the catalog quotes, charged by the engine itself: the
//! maintenance period (car and service upkeep, Modern overhead, the condo hold
//! tax, the film and DJ bookings), each rent cadence on every calendar a mode
//! runs, and the exterminator. The build, sell, car and extend prices are
//! charged in `tests.rs`. Each expectation is built from the catalog's
//! numbers, so a frontend that quotes them cannot drift from the treasury
//! once no second engine checks them (#926 item 6).

use super::*;
use crate::clock::CalendarKind;
use crate::jsmath;
use crate::services::ExterminatorRefusal;
use crate::sim::Simulation;
use crate::tower::UnitState;

const MODES: [GameMode; 2] = [GameMode::Classic, GameMode::Modern];

/// The top floor of the test tower; one elevator serves floors 1 to it.
const TOP_FLOOR: i64 = 14;
/// The tower's left and right edges, and where each room starts.
const LEFT: i64 = 100;
const RIGHT: i64 = 260;
const ROOM_X: i64 = 110;

fn entry<'a>(c: &'a Catalog, key: &str) -> &'a FacilityEntry {
    c.facilities
        .iter()
        .find(|e| e.key == key)
        .unwrap_or_else(|| panic!("no {key} in the catalog"))
}

/// The quoted default price and cadence of a priced kind.
fn rent_quote(e: &FacilityEntry) -> (f64, &'static str) {
    match e
        .rent
        .as_ref()
        .unwrap_or_else(|| panic!("{} has no rent", e.key))
    {
        Rent::Ladder {
            default, cadence, ..
        }
        | Rent::Band {
            default, cadence, ..
        } => (*default, *cadence),
    }
}

/// A lobby, floor tiles up to [`TOP_FLOOR`] and one standard elevator serving
/// every floor, on `calendar`, with every star unlocked and money to spare.
fn tower(mode: GameMode, calendar: &CalendarEntry) -> Simulation {
    let mut sim =
        Simulation::new_game_with(1, mode, CalendarKind::parse(calendar.key).unwrap(), false);
    assert_eq!(sim.clock.calendar.quarter_days, calendar.quarter_days);
    assert_eq!(
        sim.clock.calendar.maint_period_days,
        calendar.maintenance_period_days
    );
    sim.star = 5;
    sim.money = 1e12;
    for x in LEFT..RIGHT {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=TOP_FLOOR {
        for x in LEFT..RIGHT {
            assert!(sim.build(Kind::Floor, floor, x).ok);
        }
    }
    assert!(
        sim.build_transport(Kind::ElevatorStandard, LEFT + 2, 1, TOP_FLOOR)
            .ok
    );
    sim
}

/// Builds `kind` at [`ROOM_X`] on `floor` and leaves it in `state`.
fn room(sim: &mut Simulation, kind: Kind, floor: i64, state: UnitState) -> i64 {
    room_at(sim, kind, floor, ROOM_X, state)
}

fn room_at(sim: &mut Simulation, kind: Kind, floor: i64, x: i64, state: UnitState) -> i64 {
    let placed = sim.build(kind, floor, x);
    assert!(placed.ok, "{kind:?} on floor {floor}: {:?}", placed.reason);
    let id = sim.tower.unit_at(floor, x).unwrap().id;
    sim.tower.get_unit_mut(id).unwrap().state = state;
    id
}

/// The basement floors the test lays for the basement-only services.
const BASEMENT: std::ops::RangeInclusive<i64> = -3..=0;

/// The upkeep the shafts' cars cost for one period, as the catalog quotes it.
fn car_upkeep(sim: &Simulation, c: &Catalog, scale: f64) -> f64 {
    sim.tower
        .transports
        .iter()
        .filter(|t| t.kind.is_elevator())
        .map(|t| jsmath::round(t.cars as f64 * c.economy.maintenance_per_car_monthly * scale))
        .sum()
}

fn maintenance_charge(sim: &mut Simulation) -> f64 {
    let before = sim.money;
    sim.pay_maintenance();
    before - sim.money
}

#[test]
fn a_maintenance_period_charges_the_quoted_upkeep() {
    for mode in MODES {
        let c = catalog(mode);
        for calendar in &c.economy.calendars {
            let scale = calendar.maintenance_scale;
            let mut sim = tower(mode, calendar);
            let mut expected = car_upkeep(&sim, &c, scale);
            assert!(expected > 0.0, "the shaft starts with cars");
            for floor in BASEMENT.rev() {
                for x in LEFT..RIGHT {
                    let laid = sim.build(Kind::Floor, floor, x);
                    assert!(laid.ok, "basement floor {floor}: {:?}", laid.reason);
                }
            }
            let services: Vec<&FacilityEntry> = c
                .facilities
                .iter()
                .filter(|e| e.upkeep_monthly.is_some() && e.available)
                .collect();
            let keys: Vec<&str> = services.iter().map(|e| e.key).collect();
            for key in ["security", "medical", "housekeeping", "recycling", "metro"] {
                assert!(keys.contains(&key), "{mode:?} quotes {key} upkeep");
            }
            let mut above = 2;
            let mut basement_x = ROOM_X;
            for e in &services {
                let kind = Kind::parse(e.key).unwrap();
                // A station still under construction pays its upkeep. The
                // metro takes the bottom basement rows; the other basement
                // service sits beside it.
                if e.basement {
                    let floor = if kind == Kind::Metro {
                        *BASEMENT.start()
                    } else {
                        BASEMENT.end() + 1 - e.floors
                    };
                    room_at(&mut sim, kind, floor, basement_x, UnitState::Construction);
                    basement_x += e.width + 1;
                } else {
                    room(&mut sim, kind, above, UnitState::Construction);
                    above += 1;
                }
                expected += jsmath::round(e.upkeep_monthly.unwrap() * scale);
            }
            assert_eq!(
                maintenance_charge(&mut sim),
                expected,
                "{mode:?} {}",
                calendar.key
            );
        }
    }
}

#[test]
fn overhead_and_the_condo_hold_tax_follow_the_quote() {
    for mode in MODES {
        let c = catalog(mode);
        let economy = &c.economy;
        assert_eq!(
            (
                economy.overhead_per_unit_monthly > 0.0,
                economy.condo_hold_tax_rate > 0.0
            ),
            (mode.is_modern(), mode.is_modern()),
            "only Modern charges overhead and the hold tax"
        );
        for calendar in &economy.calendars {
            let scale = calendar.maintenance_scale;
            let mut sim = tower(mode, calendar);
            let mut expected = car_upkeep(&sim, &c, scale);
            let overhead = jsmath::round(economy.overhead_per_unit_monthly * scale);
            room(&mut sim, Kind::Office, 2, UnitState::Empty);
            if economy.overhead_per_unit_monthly > 0.0 {
                expected += overhead;
            }
            // An unsold condo pays the hold tax on its quoted price and the
            // overhead; a sold one pays neither.
            let (condo_price, _) = rent_quote(entry(&c, "condo"));
            room(&mut sim, Kind::Condo, 3, UnitState::Empty);
            if economy.condo_hold_tax_rate > 0.0 {
                expected +=
                    jsmath::round((condo_price * economy.condo_hold_tax_rate).ceil() * scale);
            }
            if economy.overhead_per_unit_monthly > 0.0 {
                expected += overhead;
            }
            let sold = room(&mut sim, Kind::Condo, 4, UnitState::Occupied);
            sim.tower.get_unit_mut(sold).unwrap().ever_occupied = true;
            assert_eq!(
                maintenance_charge(&mut sim),
                expected,
                "{mode:?} {}",
                calendar.key
            );
        }
    }
}

#[test]
fn film_and_dj_bookings_follow_the_quote() {
    for mode in MODES {
        let c = catalog(mode);
        let economy = &c.economy;
        for calendar in &economy.calendars {
            let scale = calendar.maintenance_scale;
            let mut sim = tower(mode, calendar);
            let cars = car_upkeep(&sim, &c, scale);
            let cinema = room(&mut sim, Kind::Cinema, 2, UnitState::Empty);
            let overhead = |e: &FacilityEntry| {
                if e.rent.is_some() || e.daily_income.is_some() {
                    jsmath::round(economy.overhead_per_unit_monthly * scale)
                } else {
                    0.0
                }
            };
            let cinema_overhead = overhead(entry(&c, "cinema"));
            for (policy, booking) in [
                ("feature", economy.cinema_booking_monthly),
                ("blockbuster", economy.cinema_booking_blockbuster_monthly),
            ] {
                assert_eq!(sim.set_film_policy(cinema, policy), Some(policy));
                assert_eq!(
                    maintenance_charge(&mut sim),
                    cars + cinema_overhead + jsmath::round(booking * scale),
                    "{mode:?} {} {policy}",
                    calendar.key
                );
            }
            let club = entry(&c, "nightclub");
            if !club.available {
                continue;
            }
            sim.tower.get_unit_mut(cinema).unwrap().state = UnitState::Gutted;
            room(&mut sim, Kind::Nightclub, 4, UnitState::Empty);
            assert_eq!(
                maintenance_charge(&mut sim),
                cars + overhead(club) + jsmath::round(economy.nightclub_dj_monthly * scale),
                "{mode:?} {} DJ",
                calendar.key
            );
        }
    }
}

/// Every priced kind the mode offers, with its quoted default and cadence.
fn priced(c: &Catalog) -> Vec<(Kind, f64, &'static str)> {
    c.facilities
        .iter()
        .filter(|e| e.rent.is_some() && e.available)
        .map(|e| {
            let (price, cadence) = rent_quote(e);
            (Kind::parse(e.key).unwrap(), price, cadence)
        })
        .collect()
}

#[test]
fn each_rent_cadence_collects_the_quoted_price() {
    for mode in MODES {
        let c = catalog(mode);
        let kinds = priced(&c);
        let cadences: Vec<&str> = kinds.iter().map(|k| k.2).collect();
        for cadence in ["quarterly", "maintenancePeriod", "sale", "nightly"] {
            assert_eq!(
                cadences.contains(&cadence),
                cadence != "maintenancePeriod" || mode.is_modern(),
                "{mode:?} {cadence}"
            );
        }
        for calendar in &c.economy.calendars {
            let mut sim = tower(mode, calendar);
            let mut quarterly = 0.0;
            let mut monthly = 0.0;
            let mut nightly = 0.0;
            for (floor, &(kind, price, cadence)) in (2..).zip(&kinds) {
                match cadence {
                    "quarterly" => {
                        room(&mut sim, kind, floor, UnitState::Occupied);
                        quarterly += jsmath::round(price * calendar.quarterly_rent_scale);
                    }
                    "maintenancePeriod" => {
                        room(&mut sim, kind, floor, UnitState::Occupied);
                        monthly += price;
                    }
                    "nightly" => {
                        room(&mut sim, kind, floor, UnitState::Asleep);
                        nightly += price;
                    }
                    "sale" => {
                        room(&mut sim, kind, floor, UnitState::Empty);
                    }
                    other => panic!("{kind:?} has cadence {other}"),
                }
            }
            let label = format!("{mode:?} {}", calendar.key);
            assert!(quarterly > 0.0 && nightly > 0.0, "{label} rents something");
            assert_eq!(monthly > 0.0, mode.is_modern(), "{label} rentals");
            let before = sim.money;
            sim.collect_rent();
            assert_eq!(sim.money - before, quarterly, "{label} quarterly");
            let before = sim.money;
            sim.collect_monthly_rent();
            assert_eq!(
                sim.money - before,
                jsmath::round(monthly * calendar.maintenance_scale),
                "{label} maintenance period"
            );
            let before = sim.money;
            sim.hotel_checkout();
            sim.hotel_late_checkout();
            assert_eq!(sim.money - before, nightly, "{label} nightly");
        }
    }
}

/// A condo sells once. Classic sells at the quoted price; a Modern sale
/// scales the quote by the household it rolls, as the catalog's household
/// block states it (`round(price * residents / population)`, at most
/// `maxHousehold` residents).
#[test]
fn a_condo_sells_once_at_the_quoted_household_price() {
    for mode in MODES {
        let c = catalog(mode);
        let condo = entry(&c, "condo");
        let (price, cadence) = rent_quote(condo);
        assert_eq!(cadence, "sale");
        for calendar in &c.economy.calendars {
            let mut sim = tower(mode, calendar);
            let id = room(&mut sim, Kind::Condo, 2, UnitState::Empty);
            let i = sim.tower.units.iter().position(|u| u.id == id).unwrap();
            let before = sim.money;
            sim.move_in(i);
            let sold = sim.money - before;
            match sim.tower.units[i].residents {
                None => {
                    assert!(!mode.is_modern());
                    assert_eq!(sold, price);
                }
                Some(residents) => {
                    assert!(mode.is_modern());
                    assert!((1..=condo.max_household.unwrap()).contains(&residents));
                    assert_eq!(
                        sold,
                        jsmath::round(price * residents as f64 / condo.population as f64)
                    );
                }
            }
            let before = sim.money;
            sim.move_in(i);
            assert_eq!(sim.money, before, "a condo sells once");
        }
    }
}

#[test]
fn the_exterminator_bills_the_quoted_fees() {
    for mode in MODES {
        let c = catalog(mode);
        for calendar in &c.economy.calendars {
            let mut sim = tower(mode, calendar);
            room(&mut sim, Kind::HotelSingle, 2, UnitState::Infested);
            room(&mut sim, Kind::HotelDouble, 3, UnitState::Infested);
            let before = sim.money;
            match &c.economy.exterminator {
                None => {
                    assert!(!mode.is_modern());
                    assert_eq!(
                        sim.call_exterminator(),
                        Err(ExterminatorRefusal::Unavailable)
                    );
                    assert_eq!(sim.money, before);
                }
                Some(fees) => {
                    let cost = fees.callout_fee + 2.0 * fees.per_room_fee;
                    assert_eq!(sim.call_exterminator(), Ok((cost, 2)), "{}", calendar.key);
                    assert_eq!(before - sim.money, cost);
                }
            }
        }
    }
}

/// Every price the catalog offers for a kind: each ladder rung, or the band's
/// floor, default and ceiling.
fn price_levels(e: &FacilityEntry) -> (Vec<f64>, bool) {
    match e.rent.as_ref().unwrap() {
        Rent::Ladder { rungs, no_rate, .. } => (rungs.iter().map(|r| r.value).collect(), *no_rate),
        Rent::Band {
            default,
            min,
            max,
            no_rate,
            ..
        } => (vec![*min, *default, *max], *no_rate),
    }
}

/// What one collection of `kind`'s cadence pays.
fn collect(sim: &mut Simulation, cadence: &str) -> f64 {
    let before = sim.money;
    match cadence {
        "quarterly" => sim.collect_rent(),
        "maintenancePeriod" => sim.collect_monthly_rent(),
        "nightly" => {
            sim.hotel_checkout();
            sim.hotel_late_checkout();
        }
        other => panic!("no collector for {other}"),
    }
    sim.money - before
}

/// Each priced level, and No Rate where the catalog offers it, is collected
/// at that price on every calendar.
#[test]
fn every_offered_price_is_the_one_collected() {
    for mode in MODES {
        let c = catalog(mode);
        for calendar in &c.economy.calendars {
            for (kind, _, cadence) in priced(&c) {
                if cadence == "sale" {
                    continue;
                }
                let e = entry(&c, kind.as_str());
                let (levels, offers_no_rate) = price_levels(e);
                let scale = match cadence {
                    "quarterly" => calendar.quarterly_rent_scale,
                    "maintenancePeriod" => calendar.maintenance_scale,
                    _ => 1.0,
                };
                let tenant = if cadence == "nightly" {
                    UnitState::Asleep
                } else {
                    UnitState::Occupied
                };
                let mut sim = tower(mode, calendar);
                let id = room(&mut sim, kind, 2, tenant);
                let label = format!("{mode:?} {} {kind:?}", calendar.key);
                for level in levels {
                    let u = sim.tower.get_unit_mut(id).unwrap();
                    (u.rent, u.no_rate, u.state) = (Some(level), false, tenant);
                    assert_eq!(
                        collect(&mut sim, cadence),
                        jsmath::round(level * scale),
                        "{label} at {level}"
                    );
                }
                if offers_no_rate {
                    let u = sim.tower.get_unit_mut(id).unwrap();
                    (u.no_rate, u.state) = (true, tenant);
                    assert_eq!(collect(&mut sim, cadence), 0.0, "{label} No Rate");
                }
            }
        }
    }
}

/// The hold tax rounds up each condo's share before the period scale rounds
/// the charge, at every offered price and at an off-step price a player's
/// save can carry.
#[test]
fn the_hold_tax_rounds_each_offered_price() {
    let c = catalog(GameMode::Modern);
    let economy = &c.economy;
    let (mut levels, _) = price_levels(entry(&c, "condo"));
    levels.push(levels[0] + 1.0);
    for calendar in &economy.calendars {
        let scale = calendar.maintenance_scale;
        let mut sim = tower(GameMode::Modern, calendar);
        let base = maintenance_charge(&mut sim);
        let id = room(&mut sim, Kind::Condo, 2, UnitState::Empty);
        for &price in &levels {
            sim.tower.get_unit_mut(id).unwrap().rent = Some(price);
            let tax = jsmath::round((price * economy.condo_hold_tax_rate).ceil() * scale);
            let overhead = jsmath::round(economy.overhead_per_unit_monthly * scale);
            assert_eq!(
                maintenance_charge(&mut sim),
                base + tax + overhead,
                "{} at {price}",
                calendar.key
            );
        }
    }
}

//! Economy depth: which kinds pay the Modern operating overhead, and the
//! cinema's film policy as a player choice. The overhead and hold tax on an
//! office and a condo, and each film policy's booking, are pinned by
//! `catalog::charge_tests::{overhead_and_the_condo_hold_tax_follow_the_quote,
//! film_and_dj_bookings_follow_the_quote}`. This file holds the kind list,
//! the refusal on a non-cinema and the policy's trip through a save.
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lay_row, put, unit, MID};

/// What one maintenance period charges, in `mode` on the canon calendar,
/// for a tower of a lobby row and floor slabs holding `kind` (or nothing
/// more when it is `None`).
fn upkeep_with(mode: GameMode, kind: Option<Kind>) -> f64 {
    let mut sim = Simulation::new_game_with(1, mode, CalendarKind::Canon, false);
    sim.money = 1e12;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in [2, 3, 0, -1, -2, -3] {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    if let Some(kind) = kind {
        let floor = match kind {
            Kind::Metro => -3,
            Kind::Parking | Kind::ParkingRamp | Kind::Recycling => -1,
            _ => 2,
        };
        let id = put(&mut sim, kind, floor, MID);
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Occupied;
        // An unsold condo's hold tax reads its price, and an off-market one
        // has none, so only the overhead is left to compare.
        u.no_rate = kind == Kind::Condo;
        if kind == Kind::Cinema {
            assert_eq!(sim.set_film_policy(id, "feature"), Some("feature"));
        }
    }
    let before = sim.money;
    sim.pay_maintenance();
    before - sim.money
}

/// The Modern charge over the Classic one: the overhead alone, since
/// nothing else in these towers differs by mode (neither mode charges a
/// cinema for its film each period, #1950).
fn overhead_of(kind: Option<Kind>) -> f64 {
    upkeep_with(GameMode::Modern, kind) - upkeep_with(GameMode::Classic, kind)
}

#[test]
fn leasable_and_trading_rooms_pay_the_overhead_and_services_structure_and_transport_do_not() {
    let office = overhead_of(Some(Kind::Office));
    assert!(office > 0.0, "Modern charges an office the overhead");
    for kind in [
        Kind::Condo,
        Kind::HotelSingle,
        Kind::HotelDouble,
        Kind::HotelSuite,
        Kind::FastFood,
        Kind::Restaurant,
        Kind::Shop,
        Kind::Cinema,
        Kind::PartyHall,
    ] {
        assert_eq!(
            overhead_of(Some(kind)),
            office,
            "{kind:?} pays the overhead"
        );
    }
    for kind in [
        Kind::Security,
        Kind::Medical,
        Kind::Housekeeping,
        Kind::Recycling,
        Kind::Metro,
        Kind::Parking,
        Kind::ParkingRamp,
    ] {
        assert_eq!(overhead_of(Some(kind)), 0.0, "{kind:?} pays no overhead");
    }
    // The lobby row and the floor slabs every tower stands on pay none.
    // Stairs and elevators are shafts, not units, and the overhead is
    // charged per unit, so it never reaches them.
    assert_eq!(overhead_of(None), 0.0, "lobby and floor tiles");
}

#[test]
fn a_film_policy_is_refused_for_a_non_cinema_and_survives_a_save() {
    let mut sim = Simulation::new_game(6, GameMode::Classic);
    sim.money = 1e9;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    lay_row(&mut sim, Kind::Floor, 3);
    let office = put(&mut sim, Kind::Office, 2, MID + 40);
    assert_eq!(sim.set_film_policy(office, "blockbuster"), None);
    assert_eq!(unit(&sim, office).extras().film_policy, None);
    let cinema = put(&mut sim, Kind::Cinema, 2, 0);
    assert_eq!(
        sim.set_film_policy(cinema, "blockbuster"),
        Some("blockbuster")
    );
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(
        unit(&loaded, cinema).extras().film_policy,
        Some("blockbuster")
    );
    // A hand-edited value outside the three policies loads as no choice,
    // which plays as auto.
    let mut raw = sim.serialize();
    for u in raw["units"].as_array_mut().unwrap() {
        if u["kind"] == "cinema" {
            u["filmPolicy"] = "garbage".into();
        }
    }
    let loaded = deserialize(&raw).unwrap();
    assert_eq!(unit(&loaded, cinema).extras().film_policy, None);
}

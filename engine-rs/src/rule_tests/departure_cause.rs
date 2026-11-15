//! The cause a tenant is named for when its notice runs out (#550). The
//! notice is stamped with the cause that drove the rating to zero; if the
//! player fixes that cause and another keeps the rating down, the tenant
//! leaves for the one that holds now. A stamped cause that still holds is
//! kept, even when another outranks it, and so is one with nothing else
//! wrong (the rating simply has not climbed back yet).
use crate::clock::GameMode;
use crate::econ::rent_config;
use crate::facilities::Kind;
use crate::satisfaction::vacate_reason_text;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::walking_penalties::{hours, served};
use super::{put, seat, unit};

/// A tenant of `kind` on `floor` that gave notice for `stamped` an hour
/// before it is due to leave.
fn on_notice(sim: &mut Simulation, kind: Kind, floor: i64, stamped: &'static str) -> i64 {
    let id = put(sim, kind, floor, 40);
    seat(sim, id, UnitState::Vacating, 0.0);
    let leave_at = sim.clock.minutes + 30.0;
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.extras_mut().vacate_reason = Some(stamped);
    u.extras_mut().vacate_at = Some(leave_at);
    id
}

/// The cause the departure message names, once the tenant has left.
fn left_for(sim: &mut Simulation, id: i64) -> &'static str {
    hours(sim, 1);
    assert_eq!(unit(sim, id).state, UnitState::Empty, "the tenant left");
    let last = &sim.log.last().unwrap().text;
    [
        "access",
        "noTransport",
        "congestion",
        "rent",
        "noise",
        "transportFar",
        "lobbyFar",
        "unmetDemand",
        "trash",
        "parking",
        "homeParking",
        "relocation",
    ]
    .into_iter()
    .find(|cause| last.contains(&format!("({})", vacate_reason_text(cause))))
    .unwrap_or_else(|| panic!("no cause named in {last:?}"))
}

#[test]
fn a_tenant_whose_rent_was_fixed_leaves_for_the_far_lobby_that_still_holds() {
    // Floor 13 is very far from the only lobby: the drain pins the rating at
    // zero, so the notice never rescinds. The rent is at the default.
    let mut sim = served(41, GameMode::Classic, 14, 3);
    let id = on_notice(&mut sim, Kind::Office, 13, "rent");
    assert_eq!(left_for(&mut sim, id), "lobbyFar");
}

#[test]
fn a_cause_that_still_holds_is_kept_even_when_another_outranks_it() {
    let mut sim = served(42, GameMode::Classic, 14, 3);
    let id = on_notice(&mut sim, Kind::Office, 13, "lobbyFar");
    let over = rent_config(Kind::Office).unwrap().max;
    sim.tower.get_unit_mut(id).unwrap().rent = Some(over);
    assert_eq!(left_for(&mut sim, id), "lobbyFar");
}

#[test]
fn with_nothing_wrong_now_the_tenant_leaves_for_the_cause_it_gave() {
    let mut sim = served(43, GameMode::Classic, 3, 3);
    let id = on_notice(&mut sim, Kind::Office, 2, "rent");
    assert_eq!(left_for(&mut sim, id), "rent");
}

#[test]
fn a_relocating_household_is_never_renamed() {
    let mut sim = served(44, GameMode::Classic, 14, 3);
    let id = on_notice(&mut sim, Kind::Condo, 13, "relocation");
    assert_eq!(left_for(&mut sim, id), "relocation");
}

#[test]
fn an_office_by_a_nightclub_whose_noisy_neighbor_left_goes_for_the_rent() {
    // The club's halo drains homes and guest rooms, never an office, so an
    // office stamped "noise" with no noisy neighbor left is named for what
    // holds: the rent. Modern, where noise can evict (in Classic the
    // notice pass re-stamps a noise notice before it runs out).
    let mut sim = served(45, GameMode::Modern, 14, 3);
    let club = put(&mut sim, Kind::Nightclub, 12, 80);
    seat(&mut sim, club, UnitState::Occupied, 1.0);
    assert!(sim.near_nightclub(13));
    let id = on_notice(&mut sim, Kind::Office, 13, "noise");
    let over = rent_config(Kind::Office).unwrap().max;
    sim.tower.get_unit_mut(id).unwrap().rent = Some(over);
    assert_eq!(left_for(&mut sim, id), "rent");
}

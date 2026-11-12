//! Modern homes need parking for a share of their households (#1973): from
//! three stars, one space per 2 condos, per 3 apartments and per 6 studios,
//! halved with offices' need while a Metro station works. Offices and homes
//! share the spaces the hotel suites leave, lowest rooms first. A home without
//! parking is held at Good and fills more slowly, but never leaves for it.
//! Classic homes never need parking, and a Classic Metro changes no demand.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH as W};
use crate::satisfaction::shortfall::{HOME_PARKING_CAUSE, PARKING_CAUSE, SHORTFALL_CAP};
use crate::satisfaction::VACATE_RESCIND;
use crate::services::{HOME_MOVE_IN_SHORT_FACTOR, METRO_PARKING_SHARE};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::stocked_services::{lay_basement, stock_recycling};
use super::{lay_row, seat, unit};

/// A tower at `star` with floors 2..=top, an elevator every 40 tiles, a
/// basement to floor -4 (the Metro's row) and one recycling center on -3 (so
/// only parking can fall short). No parking yet.
fn bare_tower(mode: GameMode, star: i64, top: i64) -> Simulation {
    let mut sim = Simulation::new_game(43, mode);
    sim.money = 1e12;
    sim.star = star;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    for x in (10..W - 10).step_by(40) {
        assert!(sim.build_transport(Kind::ElevatorStandard, x, 1, top).ok);
    }
    lay_basement(&mut sim, METRO_FLOOR);
    stock_recycling(&mut sim, -3, 0, 1);
    sim
}

/// `count` units of `kind` on `floor`, side by side from tile 14, each moved
/// in and content. Answers their ids.
fn occupied_row(sim: &mut Simulation, kind: Kind, floor: i64, count: usize) -> Vec<i64> {
    let width = kind.facility().width;
    let mut ids = Vec::new();
    let mut x = 14;
    while ids.len() < count {
        assert!(x + width < W - 10, "{kind:?} row on {floor} is full");
        if let Some(id) = sim.tower.place(kind, floor, x).unit_id {
            seat(sim, id, UnitState::Occupied, 1.0);
            ids.push(id);
            x += width;
        } else {
            x += 1;
        }
    }
    ids
}

/// A ramp at tile 0 on floor 0 with `spaces` spaces beside it.
fn park(sim: &mut Simulation, spaces: i64) {
    assert!(sim.tower.place(Kind::ParkingRamp, 0, 0).ok);
    for i in 0..spaces {
        assert!(
            sim.tower.place(Kind::Parking, 0, 16 + i * 4).ok,
            "space {i}"
        );
    }
}

/// The bottom basement row, where a Metro station stands.
const METRO_FLOOR: i64 = -4;

/// A working Metro station on the bottom row, clear of the recycling center.
fn metro(sim: &mut Simulation) {
    let placed = sim.tower.place(Kind::Metro, METRO_FLOOR, W - 40);
    assert!(placed.ok, "metro: {:?}", placed.reason);
}

/// The shortfall binding `id` this hour, as its cause and whether it sinks.
fn binding(sim: &Simulation, id: i64) -> Option<(&'static str, bool)> {
    let u = unit(sim, id).clone();
    sim.service_shortfalls()
        .binding_for(&u, true)
        .map(|s| (s.cause, s.sinks))
}

/// `id`'s satisfaction after `hours` hourly steps from content.
fn after_hours(sim: &mut Simulation, id: i64, hours: usize) -> f64 {
    let mut ctx = sim.build_satisfaction_context(false);
    let u = unit(sim, id).clone();
    let mut s = 1.0;
    for _ in 0..hours {
        s = sim.satisfaction_step(&u, s, &mut ctx).next;
    }
    s
}

/// Four condos, three apartments and six studios, all moved in: four
/// spaces of household need (2 + 1 + 1).
fn homes(sim: &mut Simulation) -> Vec<i64> {
    let mut ids = occupied_row(sim, Kind::Condo, 3, 4);
    ids.extend(occupied_row(sim, Kind::RentalApartment, 4, 3));
    ids.extend(occupied_row(sim, Kind::RentalStudio, 5, 6));
    ids
}

#[test]
fn modern_homes_need_a_share_of_a_space_each() {
    let mut sim = bare_tower(GameMode::Modern, 3, 5);
    homes(&mut sim);
    let d = sim.parking_demand();
    assert_eq!(d.homes, 4.0);
    assert_eq!(d.total, 4.0);
    // An empty home needs nothing.
    let studio = occupied_row(&mut sim, Kind::RentalStudio, 2, 1)[0];
    assert_eq!(sim.parking_demand().homes, 5.0, "a sixth rounds up");
    seat(&mut sim, studio, UnitState::Empty, 1.0);
    assert_eq!(sim.parking_demand().homes, 4.0);
}

#[test]
fn homes_need_nothing_below_three_stars() {
    let mut sim = bare_tower(GameMode::Modern, 2, 5);
    let ids = homes(&mut sim);
    assert_eq!(sim.parking_demand().total, 0.0);
    assert_eq!(binding(&sim, ids[0]), None);
}

#[test]
fn classic_homes_never_need_parking() {
    let mut sim = bare_tower(GameMode::Classic, 3, 3);
    let condos = occupied_row(&mut sim, Kind::Condo, 3, 4);
    assert_eq!(sim.parking_demand().homes, 0.0);
    assert_eq!(binding(&sim, condos[0]), None);
    assert_eq!(after_hours(&mut sim, condos[0], 48), 1.0);
    assert_eq!(sim.parking_move_in_reading().home_factor, 1.0);
}

#[test]
fn a_modern_metro_halves_office_and_home_need_but_not_suites() {
    let mut sim = bare_tower(GameMode::Modern, 4, 6);
    homes(&mut sim);
    occupied_row(&mut sim, Kind::Office, 2, 8);
    occupied_row(&mut sim, Kind::HotelSuite, 6, 1);
    let before = sim.parking_demand();
    assert_eq!((before.offices, before.homes), (2.0, 4.0));
    metro(&mut sim);
    let after = sim.parking_demand();
    assert_eq!(after.offices, before.offices * METRO_PARKING_SHARE);
    assert_eq!(after.homes, before.homes * METRO_PARKING_SHARE);
    assert_eq!(after.suites, 1.0);
    assert_eq!(after.suites, before.suites);
}

#[test]
fn a_classic_metro_changes_no_parking_demand() {
    let mut sim = bare_tower(GameMode::Classic, 4, 3);
    occupied_row(&mut sim, Kind::Office, 2, 8);
    let before = sim.parking_demand();
    metro(&mut sim);
    assert_eq!(sim.parking_demand(), before);
    assert_eq!(before.offices, 2.0);
}

#[test]
fn a_modern_home_without_parking_holds_at_good_and_never_leaves() {
    let mut sim = bare_tower(GameMode::Modern, 3, 5);
    let ids = homes(&mut sim);
    for &id in &ids {
        assert_eq!(binding(&sim, id), Some((HOME_PARKING_CAUSE, false)));
    }
    let held = after_hours(&mut sim, ids[0], 24 * 30);
    assert_eq!(held, SHORTFALL_CAP);
    assert!(held >= VACATE_RESCIND);
    // A month of game hours: nobody gives notice over parking. (A fire may
    // still burn a room; that is not parking's doing.)
    for _ in 0..(30 * 24) {
        sim.tick(60.0);
        for &id in &ids {
            let u = unit(&sim, id);
            assert_ne!(u.state, UnitState::Vacating, "{:?} on {}", u.kind, u.floor);
            assert_ne!(u.extras().vacate_reason, Some(HOME_PARKING_CAUSE));
        }
    }
}

#[test]
fn offices_and_homes_share_the_spaces_lowest_first() {
    let mut sim = bare_tower(GameMode::Modern, 3, 5);
    let offices = occupied_row(&mut sim, Kind::Office, 2, 8);
    let ids = homes(&mut sim);
    // Two spaces park floor 2's offices (48 workers) and nobody above.
    park(&mut sim, 2);
    assert_eq!(binding(&sim, offices[0]), None);
    assert_eq!(binding(&sim, *offices.last().unwrap()), None);
    assert_eq!(binding(&sim, ids[0]), Some((HOME_PARKING_CAUSE, false)));
    // Offices and homes need six spaces together: two cover a third, so a
    // late office would sink while homes only hold.
    let coverage = sim.service_shortfalls().parking_coverage().unwrap();
    assert!((coverage - 2.0 / 6.0).abs() < 1e-9, "{coverage}");
    // Three more spaces park the condos (two) and the apartments (one) on
    // the floors above, and leave the studios short.
    for i in 2..5 {
        assert!(sim.tower.place(Kind::Parking, 0, 16 + i * 4).ok);
    }
    assert_eq!(binding(&sim, ids[0]), None, "a condo on floor 3");
    assert_eq!(binding(&sim, ids[4]), None, "an apartment on floor 4");
    assert_eq!(binding(&sim, ids[7]), Some((HOME_PARKING_CAUSE, false)));
}

#[test]
fn a_late_office_sinks_when_homes_take_the_spaces() {
    let mut sim = bare_tower(GameMode::Modern, 3, 6);
    homes(&mut sim);
    let office = occupied_row(&mut sim, Kind::Office, 6, 1)[0];
    park(&mut sim, 1);
    // One space against 4.25 spaces of need: under half, and the office on
    // the top floor is the one left without.
    assert_eq!(binding(&sim, office), Some((PARKING_CAUSE, true)));
    assert!(after_hours(&mut sim, office, 24) < VACATE_RESCIND);
}

#[test]
fn homes_fill_more_slowly_under_half_coverage() {
    let mut sim = bare_tower(GameMode::Modern, 3, 5);
    homes(&mut sim);
    assert_eq!(
        sim.parking_move_in_reading().home_factor,
        HOME_MOVE_IN_SHORT_FACTOR
    );
    park(&mut sim, 2);
    let reading = sim.parking_move_in_reading();
    assert_eq!(reading.home_factor, 1.0, "half covered keeps the pace");
    assert!(reading.office_short, "still short, so offices halve too");
    for i in 2..4 {
        assert!(sim.tower.place(Kind::Parking, 0, 16 + i * 4).ok);
    }
    assert!(!sim.parking_move_in_reading().office_short);
}

#[test]
fn the_inspector_names_home_parking_and_its_coverage() {
    let mut sim = bare_tower(GameMode::Modern, 3, 5);
    let ids = homes(&mut sim);
    park(&mut sim, 1);
    sim.tower.get_unit_mut(ids[12]).unwrap().satisfaction = SHORTFALL_CAP;
    let g = sim.diagnostic_facts(ids[12]).unwrap().gripe.unwrap();
    assert_eq!(g.cause, HOME_PARKING_CAUSE);
    let coverage = g.coverage.unwrap();
    assert!((coverage - 0.25).abs() < 1e-9, "{coverage}");
}

#[test]
fn the_spaces_run_out_partway_along_a_floor_left_to_right() {
    let mut sim = bare_tower(GameMode::Modern, 3, 4);
    let studios = occupied_row(&mut sim, Kind::RentalStudio, 2, 6);
    let condos = occupied_row(&mut sim, Kind::Condo, 3, 4);
    // Six studios take one space below; the second parks the first two
    // condos (half a space each) and leaves the third and fourth short.
    park(&mut sim, 2);
    assert_eq!(binding(&sim, studios[5]), None);
    assert_eq!(binding(&sim, condos[1]), None);
    assert_eq!(binding(&sim, condos[2]), Some((HOME_PARKING_CAUSE, false)));
    assert_eq!(binding(&sim, condos[3]), Some((HOME_PARKING_CAUSE, false)));
}

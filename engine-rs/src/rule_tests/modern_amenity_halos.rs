//! The Modern venues' cross-floor halos (the audit and round table of
//! 2026-11-12): the nightclub is felt only while it is open and never brings
//! a home to notice by itself; the fitness club, spa and daycare lift the
//! ceiling a capped room is held to; the spa and daycare make no noise for
//! the rooms beside them. Classic has none of it.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::rules::{
    AMENITY_CAP_LIFT_MAX, DAYCARE_HALO_MAX, DAYCARE_SMALLEST_FAMILY_SHARE, FITNESS_HALO_MAX,
};
use crate::satisfaction::{GRIPE_WARN, NOISE_CAP, VACATE_RESCIND};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lot_tower, put, seat, unit, MID as C};

/// A content, sold condo of three on floor 3 of a small Modern tower.
fn condo_tower(seed: u32) -> (Simulation, i64) {
    let mut sim = lot_tower(seed, GameMode::Modern, 6);
    let condo = put(&mut sim, Kind::Condo, 3, C);
    seat(&mut sim, condo, UnitState::Occupied, 1.0);
    let u = sim.tower.get_unit_mut(condo).unwrap();
    u.residents = Some(3);
    u.ever_occupied = true;
    (sim, condo)
}

fn open_venue(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let id = put(sim, kind, floor, x);
    seat(sim, id, UnitState::Occupied, 1.0);
    id
}

/// Runs the hourly satisfaction update from midnight for `hours` hours,
/// returning the room's satisfaction after each hour, indexed by clock hour.
fn run_hours(sim: &mut Simulation, id: i64, hours: i64) -> Vec<(i64, f64)> {
    let mut out = Vec::new();
    for h in 0..hours {
        sim.clock.minutes = h as f64 * 60.0;
        sim.update_satisfaction();
        out.push((sim.clock.hour(), unit(sim, id).satisfaction));
    }
    out
}

#[test]
fn a_nightclub_on_a_condos_floor_dips_it_overnight_and_never_brings_notice() {
    let (mut sim, condo) = condo_tower(11);
    // Far along the floor: outside the same-floor noise band.
    open_venue(&mut sim, Kind::Nightclub, 3, C - 60);
    let u = unit(&sim, condo).clone();
    assert!(!sim.noise_afflicted(&u), "the cross-floor halo only");
    let trace = run_hours(&mut sim, condo, 24 * 4);
    let lowest = trace.iter().map(|&(_, s)| s).fold(1.0, f64::min);
    assert!(
        lowest <= GRIPE_WARN,
        "the club's own floor dips to Good overnight: {lowest}"
    );
    assert!(lowest >= VACATE_RESCIND, "never toward notice: {lowest}");
    assert_eq!(unit(&sim, condo).state, UnitState::Occupied);
    for &(hour, s) in &trace {
        if hour == 19 {
            assert_eq!(s, 1.0, "refilled before the club opens again");
        }
    }
    let (mut quiet_sim, quiet) = condo_tower(11);
    let club = open_venue(&mut quiet_sim, Kind::Nightclub, 3, C - 60);
    seat(&mut quiet_sim, quiet, UnitState::Occupied, 0.9);
    quiet_sim.clock.minutes = 12.0 * 60.0;
    quiet_sim.update_satisfaction();
    assert!(
        unit(&quiet_sim, quiet).satisfaction > 0.9,
        "a closed club ({club}) drains nothing at noon"
    );
}

#[test]
fn the_daycare_reaches_every_family_and_the_biggest_most() {
    let modern = GameMode::Modern;
    let full = DAYCARE_HALO_MAX;
    assert_eq!(modern.daycare_family_bonus(0.0, 1.0), 0.0, "no family");
    assert_eq!(
        modern.daycare_family_bonus(0.0, 2.0),
        full * DAYCARE_SMALLEST_FAMILY_SHARE
    );
    assert_eq!(modern.daycare_family_bonus(0.0, 5.0), full);
    let three = modern.daycare_family_bonus(0.0, 3.0);
    let four = modern.daycare_family_bonus(0.0, 4.0);
    assert!(full * DAYCARE_SMALLEST_FAMILY_SHARE < three && three < four && four < full);
    assert_eq!(GameMode::Classic.daycare_family_bonus(0.0, 5.0), 0.0);
}

#[test]
fn a_nearby_fitness_club_lifts_a_noisy_condos_ceiling() {
    // A fast food beside the condo caps it at the noise ceiling.
    let (mut capped, condo) = condo_tower(12);
    put(&mut capped, Kind::FastFood, 3, C - 20);
    let u = unit(&capped, condo).clone();
    assert!(capped.noise_afflicted(&u));
    let without = run_hours(&mut capped, condo, 48).last().unwrap().1;
    assert!(without <= NOISE_CAP, "held at or under the cap: {without}");

    let (mut lifted, condo) = condo_tower(12);
    put(&mut lifted, Kind::FastFood, 3, C - 20);
    open_venue(&mut lifted, Kind::FitnessClub, 3, C + 40);
    let with = run_hours(&mut lifted, condo, 48).last().unwrap().1;
    assert!(
        with > GRIPE_WARN,
        "the gym lifts it past the Good line: {with}"
    );
    assert!(with <= NOISE_CAP + AMENITY_CAP_LIFT_MAX + 1e-9, "{with}");
    assert_eq!(
        GameMode::Modern.amenity_cap_lift(FITNESS_HALO_MAX, FITNESS_HALO_MAX),
        AMENITY_CAP_LIFT_MAX
    );
    assert_eq!(
        GameMode::Classic.amenity_cap_lift(FITNESS_HALO_MAX, FITNESS_HALO_MAX),
        0.0
    );
}

#[test]
fn the_spa_and_daycare_make_no_noise_for_their_neighbors() {
    for (home, venue) in [
        (Kind::HotelSingle, Kind::Spa),
        (Kind::Condo, Kind::Daycare),
        (Kind::Office, Kind::Spa),
    ] {
        let mut sim = lot_tower(13, GameMode::Modern, 4);
        let id = put(&mut sim, home, 3, C);
        put(&mut sim, venue, 3, C - 16);
        let u = unit(&sim, id).clone();
        assert!(!sim.noise_afflicted(&u), "{venue:?} beside {home:?}");
    }
    let mut control = lot_tower(13, GameMode::Modern, 4);
    let id = put(&mut control, Kind::HotelSingle, 3, C);
    put(&mut control, Kind::BoutiqueBay, 3, C - 16);
    let u = unit(&control, id).clone();
    assert!(control.noise_afflicted(&u), "another venue still does");
}

#[test]
fn an_amenity_never_lifts_the_far_walk_ceiling() {
    // An apartment far along the floor from the only shaft walks too far to
    // transport; a gym beside it does not shorten that walk.
    let mut sim = lot_tower(14, GameMode::Modern, 4);
    let apt = put(&mut sim, Kind::RentalApartment, 3, 10);
    seat(&mut sim, apt, UnitState::Occupied, 1.0);
    let u = sim.tower.get_unit_mut(apt).unwrap();
    u.residents = Some(3);
    u.ever_occupied = true;
    open_venue(&mut sim, Kind::FitnessClub, 3, 40);
    let s = run_hours(&mut sim, apt, 48).last().unwrap().1;
    let r = {
        let u = unit(&sim, apt).clone();
        let mut ctx = sim.build_satisfaction_context(false);
        sim.satisfaction_step(&u, u.satisfaction, &mut ctx)
    };
    assert!(r.far_walk, "the walk to transport is too far");
    assert!(s <= NOISE_CAP + 1e-9, "held at the far-walk ceiling: {s}");
}

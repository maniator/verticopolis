//! The commute-stress accumulator (#514): each finished tenant trip folds
//! its whole wait onto its tenant's floor (its origin, or its destination
//! when it starts in a lobby), and that real wait drains the floor's
//! tenants (#1971). The averages' listing and seeding
//! are `crowd::tests::commute_stress_lists_each_floor_in_order` and its
//! neighbors.
use crate::clock::GameMode;
use crate::crowd::motion::finish;
use crate::crowd::spawn::add;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::rules::{CLASSIC_WAIT_LIMIT, MODERN_WAIT_LIMIT};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::MID;

const C: i64 = MID - 15;

/// Lobby and floors 2 to 6, an occupied office on 5, one elevator.
fn commuter_tower(seed: u32) -> Simulation {
    commuter_tower_in(seed, GameMode::Classic)
}

fn commuter_tower_in(seed: u32, mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(seed, mode);
    sim.money = 1e9;
    for x in C..C + 30 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=6 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let id = sim.tower.place(Kind::Office, 5, C).unit_id.unwrap();
    let office = sim.tower.get_unit_mut(id).unwrap();
    office.state = UnitState::Occupied;
    office.ever_occupied = true;
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, C + 20, 1, 6)
            .ok
    );
    sim
}

fn stress(sim: &Simulation, floor: i64) -> f64 {
    sim.crowd
        .commute_wait_by_floor
        .get(&floor)
        .copied()
        .unwrap_or(0.0)
}

/// Finishes a rider whose trip began on `origin` with these waits.
fn finished(sim: &mut Simulation, origin: i64, trip_wait: f64, wait: f64, staff: bool) {
    let i = add(&mut sim.crowd, &sim.tower, 3, 6, None, None).unwrap();
    let p = &mut sim.crowd.people[i];
    (p.origin_floor, p.trip_wait, p.wait, p.staff) = (origin, trip_wait, wait, staff);
    if staff {
        sim.crowd.staff_count += 1;
    }
    finish(&mut sim.crowd, i, &mut sim.tower);
}

#[test]
fn a_finished_trip_folds_its_whole_wait_onto_its_origin_floor_only() {
    let mut sim = commuter_tower(1);
    assert_eq!(stress(&sim, 4), 0.0);
    sim.crowd.record_commute(4, 40.0);
    assert_eq!(stress(&sim, 4), 40.0, "the first sample seeds the average");
    // A return leg starts on the venue floor (3) but its home is 50.
    finished(&mut sim, 50, 80.0, 0.0, false);
    assert_eq!(
        (stress(&sim, 50), stress(&sim, 3), stress(&sim, 6)),
        (80.0, 0.0, 0.0)
    );
    // A give-up while queued counts the trailing wait too.
    finished(&mut sim, 2, 10.0, 50.0, false);
    assert_eq!(stress(&sim, 2), 60.0);
}

#[test]
fn staff_never_count_toward_tenant_stress() {
    let mut sim = commuter_tower(1);
    finished(&mut sim, 5, 99.0, 0.0, true);
    assert!(sim.crowd.commute_wait_by_floor.is_empty());
}

#[test]
fn the_same_seed_builds_the_same_averages_and_a_save_keeps_none() {
    let snap = |sim: &Simulation| {
        let mut rows: Vec<_> = sim
            .crowd
            .commute_wait_by_floor
            .iter()
            .map(|(f, w)| (*f, *w))
            .collect();
        rows.sort_by_key(|row| row.0);
        rows
    };
    let (mut a, mut b) = (commuter_tower(1), commuter_tower(1));
    for _ in 0..200 {
        a.tick(1.0);
        b.tick(1.0);
    }
    assert!(!snap(&a).is_empty());
    assert_eq!(snap(&a), snap(&b));
    assert!(deserialize(&a.serialize())
        .unwrap()
        .crowd
        .commute_wait_by_floor
        .is_empty());
}

#[test]
fn a_trip_from_the_lobby_counts_on_the_tenant_floor_it_serves() {
    let mut sim = commuter_tower(1);
    // The morning commuter rides from the lobby (1) up to the office on 5.
    let i = add(&mut sim.crowd, &sim.tower, 1, 5, None, None).unwrap();
    (sim.crowd.people[i].trip_wait, sim.crowd.people[i].wait) = (30.0, 0.0);
    finish(&mut sim.crowd, i, &mut sim.tower);
    assert_eq!((stress(&sim, 5), stress(&sim, 1)), (30.0, 0.0));
}

#[test]
fn a_trip_off_the_metro_counts_on_the_tenant_floor_it_serves() {
    // A Metro rider starts on the platform, a floor with no lobby: the wait
    // still lands on the office it heads for, while the same trip by
    // anyone else stays on the floor it left.
    for (from_metro, office_wait, platform_wait) in [(true, 30.0, 0.0), (false, 0.0, 30.0)] {
        let mut sim = commuter_tower(1);
        let i = add(&mut sim.crowd, &sim.tower, 3, 5, None, None).unwrap();
        sim.crowd.people[i].from_metro = from_metro;
        (sim.crowd.people[i].trip_wait, sim.crowd.people[i].wait) = (30.0, 0.0);
        finish(&mut sim.crowd, i, &mut sim.tower);
        assert_eq!(
            (stress(&sim, 5), stress(&sim, 3)),
            (office_wait, platform_wait)
        );
    }
}

/// The office's satisfaction after `hours` hourly passes, starting at 0.6,
/// with its floor's average wait pinned at `wait` seconds.
fn office_after(mode: GameMode, wait: f64, hours: usize) -> f64 {
    let mut sim = commuter_tower_in(3, mode);
    let id = sim.tower.units_of_kind(Kind::Office).next().unwrap().id;
    sim.tower.get_unit_mut(id).unwrap().satisfaction = 0.6;
    for _ in 0..hours {
        sim.crowd.commute_wait_by_floor.insert(5, wait);
        sim.update_satisfaction();
    }
    sim.tower.get_unit(id).unwrap().satisfaction
}

#[test]
fn long_real_waits_drain_tenants_and_short_ones_let_them_recover() {
    let short = office_after(GameMode::Classic, 10.0, 4);
    let long = office_after(GameMode::Classic, 2.0 * CLASSIC_WAIT_LIMIT, 4);
    assert!(short > 0.6, "a quick commute recovers: {short}");
    assert!(long < 0.6, "a jammed commute drains: {long}");
}

#[test]
fn modern_tolerates_a_wait_that_drains_a_classic_tenant() {
    let wait = (CLASSIC_WAIT_LIMIT + MODERN_WAIT_LIMIT) / 2.0;
    assert!(office_after(GameMode::Classic, wait, 4) < 0.6);
    assert!(office_after(GameMode::Modern, wait, 4) > 0.6);
    assert!(office_after(GameMode::Modern, 2.0 * MODERN_WAIT_LIMIT, 4) < 0.6);
}

#[test]
fn each_mode_reads_a_wait_at_its_own_limit_and_a_lobby_reads_none() {
    assert_eq!(
        GameMode::Classic.commute_wait_congestion(CLASSIC_WAIT_LIMIT),
        1.0
    );
    assert_eq!(
        GameMode::Modern.commute_wait_congestion(MODERN_WAIT_LIMIT),
        1.0
    );
    let mut sim = commuter_tower(1);
    sim.crowd.commute_wait_by_floor.insert(1, 1_000.0);
    sim.crowd
        .commute_wait_by_floor
        .insert(5, CLASSIC_WAIT_LIMIT);
    assert_eq!(sim.commute_wait_congestion(1), 0.0);
    assert_eq!(sim.commute_wait_congestion(5), 1.0);
    assert_eq!(
        sim.commute_wait_congestion(4),
        0.0,
        "no finished trip, no wait"
    );
}

#[test]
fn a_jammed_commute_names_congestion_as_the_gripe() {
    let mut sim = commuter_tower(1);
    sim.crowd
        .commute_wait_by_floor
        .insert(5, 2.0 * CLASSIC_WAIT_LIMIT);
    let office = sim
        .tower
        .units_of_kind(Kind::Office)
        .next()
        .unwrap()
        .clone();
    let mut ctx = sim.build_satisfaction_context(false);
    let step = sim.satisfaction_step(&office, 0.6, &mut ctx);
    assert!(
        step.cong > 1.0 && step.next < 0.6,
        "{:?}",
        (step.cong, step.next)
    );
    assert_eq!(sim.dominant_gripe(&office, &step), Some("congestion"));
}

//! The commute-stress accumulator (#514): each finished tenant trip folds
//! its whole wait onto its tenant's floor (its origin, or its destination
//! when it starts in a lobby), and that real wait drains the floor's
//! tenants (#1971). The averages' listing and seeding
//! are `crowd::tests::commute_stress_lists_each_floor_in_order` and its
//! neighbors.
use crate::clock::GameMode;
use crate::crowd::motion::{advance, finish};
use crate::crowd::spawn::add;
use crate::crowd::{PState, COMMUTE_STRESS_ALPHA, COMMUTE_STRESS_PRIOR, GIVE_UP};
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

/// What one trip of `wait` seconds leaves on a floor with no average yet:
/// the average moves from no wait by the alpha (#2435).
fn lone(wait: f64) -> f64 {
    COMMUTE_STRESS_PRIOR + (wait - COMMUTE_STRESS_PRIOR) * COMMUTE_STRESS_ALPHA
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
    assert_eq!(stress(&sim, 4), lone(40.0));
    // A return leg starts on the venue floor (3) but its home is 50.
    finished(&mut sim, 50, 80.0, 0.0, false);
    assert_eq!(
        (stress(&sim, 50), stress(&sim, 3), stress(&sim, 6)),
        (lone(80.0), 0.0, 0.0)
    );
    // A give-up while queued counts the trailing wait too.
    finished(&mut sim, 2, 10.0, 50.0, false);
    assert_eq!(stress(&sim, 2), lone(60.0));
}

#[test]
fn staff_never_count_toward_tenant_stress() {
    let mut sim = commuter_tower(1);
    finished(&mut sim, 5, 99.0, 0.0, true);
    assert!(sim.crowd.commute_wait_by_floor.is_empty());
}

#[test]
fn the_same_seed_builds_the_same_averages_and_a_save_keeps_them() {
    let snap = |sim: &Simulation| {
        sim.crowd
            .commute_wait_by_floor
            .sorted()
            .into_iter()
            .map(|(f, w)| (*f, *w))
            .collect::<Vec<_>>()
    };
    let (mut a, mut b) = (commuter_tower(1), commuter_tower(1));
    for _ in 0..200 {
        a.tick(1.0);
        b.tick(1.0);
    }
    assert!(!snap(&a).is_empty());
    assert_eq!(snap(&a), snap(&b));
    let save = a.serialize();
    assert_eq!(snap(&deserialize(&save).unwrap()), snap(&a));
    // A save from before saves carried the crowd keeps none.
    let mut old = save;
    old.as_object_mut().unwrap().remove("crowd");
    assert!(snap(&deserialize(&old).unwrap()).is_empty());
}

#[test]
fn a_trip_from_the_lobby_counts_on_the_tenant_floor_it_serves() {
    let mut sim = commuter_tower(1);
    // The morning commuter rides from the lobby (1) up to the office on 5.
    let i = add(&mut sim.crowd, &sim.tower, 1, 5, None, None).unwrap();
    (sim.crowd.people[i].trip_wait, sim.crowd.people[i].wait) = (30.0, 0.0);
    finish(&mut sim.crowd, i, &mut sim.tower);
    assert_eq!((stress(&sim, 5), stress(&sim, 1)), (lone(30.0), 0.0));
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
            (lone(office_wait), lone(platform_wait))
        );
    }
}

/// A rider bound from the lobby to the office on 5 who has run out of
/// patience at the elevator, standing `back` tiles from where they set out.
fn stranded_commuter(mode: GameMode, back: i64) -> Simulation {
    let mut sim = commuter_tower_in(3, mode);
    strand_one(&mut sim, back);
    sim
}

/// Adds one more such stranded rider to `sim`.
fn strand_one(sim: &mut Simulation, back: i64) {
    let i = add(&mut sim.crowd, &sim.tower, 1, 5, Some(C + 2), None).unwrap();
    let p = &mut sim.crowd.people[i];
    p.x = (C + 2 + back) as f64;
    p.age = 10.0 * GIVE_UP;
}

/// Moves the crowd alone (no new trips) until nobody is left.
fn until_everyone_is_done(sim: &mut Simulation) {
    for _ in 0..600 {
        if sim.crowd.people.is_empty() {
            return;
        }
        advance(&mut sim.crowd, 0.1, &mut sim.tower);
    }
    panic!("the crowd never finished: {:?}", sim.crowd.people.len());
}

#[test]
fn a_trip_that_gives_up_counts_as_an_over_limit_wait_in_each_mode() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let over = mode.given_up_commute_wait();
        assert!(over > mode.commute_wait_limit(), "{mode:?}");
        // (gave up, waited) -> what the office floor (5) records.
        for (gave_up, waited, recorded) in [
            (true, 10.0, over),
            (true, 2.0 * over, 2.0 * over),
            (false, 10.0, 10.0),
        ] {
            let mut sim = commuter_tower_in(1, mode);
            let i = add(&mut sim.crowd, &sim.tower, 1, 5, None, None).unwrap();
            let p = &mut sim.crowd.people[i];
            (p.gave_up, p.trip_wait, p.wait) = (gave_up, waited, 0.0);
            finish(&mut sim.crowd, i, &mut sim.tower);
            assert_eq!(
                stress(&sim, 5),
                lone(recorded),
                "{mode:?} {gave_up} {waited}"
            );
        }
    }
}

/// #2019's rule: a floor whose commuters give up drains in both modes, where
/// before a turned-back rider counted no wait at all. One give-up alone
/// moves the floor only part way (#2435); a run of them is a jam.
#[test]
fn a_floor_whose_commuters_give_up_drains_in_both_modes() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = stranded_commuter(mode, 18);
        until_everyone_is_done(&mut sim);
        assert_eq!(
            stress(&sim, 5),
            lone(mode.given_up_commute_wait()),
            "{mode:?}"
        );
        assert!(
            sim.commute_wait_congestion(5) < 1.0,
            "{mode:?}: one is no jam"
        );
        for _ in 0..4 {
            strand_one(&mut sim, 18);
            until_everyone_is_done(&mut sim);
        }
        assert!(sim.commute_wait_congestion(5) > 1.0, "{mode:?}: five are");
        let id = sim.tower.units_of_kind(Kind::Office).next().unwrap().id;
        sim.tower.get_unit_mut(id).unwrap().satisfaction = 0.6;
        for _ in 0..4 {
            sim.update_satisfaction();
        }
        let after = sim.tower.get_unit(id).unwrap().satisfaction;
        assert!(after < 0.6, "{mode:?}: the stranded floor drains: {after}");
    }
}

/// Only patience counts as giving up: a rider sent back because the player
/// removed their elevator, or one who found another way, records the wait
/// they really had.
#[test]
fn a_trip_cut_short_by_a_removed_elevator_is_no_give_up() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = stranded_commuter(mode, 18);
        sim.crowd.people[0].age = 0.0;
        let shaft = sim.tower.transports[0].id;
        assert!(sim.tower.remove_transport(shaft).is_some());
        until_everyone_is_done(&mut sim);
        assert!(
            sim.crowd.commute_wait_by_floor.get(&5).is_some(),
            "recorded"
        );
        assert!(
            stress(&sim, 5) < mode.commute_wait_limit(),
            "{mode:?}: {}",
            stress(&sim, 5)
        );
    }
}

#[test]
fn a_save_keeps_a_give_up_that_is_still_walking_back() {
    let mut sim = stranded_commuter(GameMode::Classic, 18);
    // Patience runs out only in the line (#2386), so the rider walks to the
    // shaft first and gives up there.
    for _ in 0..600 {
        if sim.crowd.people[0].gave_up {
            break;
        }
        advance(&mut sim.crowd, 0.1, &mut sim.tower);
    }
    assert!(sim.crowd.people[0].gave_up && sim.crowd.people[0].returning);
    let mut loaded = deserialize(&sim.serialize()).unwrap();
    assert!(loaded.crowd.people[0].gave_up, "the save carries it");
    until_everyone_is_done(&mut loaded);
    assert_eq!(
        stress(&loaded, 5),
        lone(GameMode::Classic.given_up_commute_wait())
    );
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

/// A lone tenant two elevators away in an otherwise idle tower (#514): the
/// 1994 game charges each Sim every landing it waits at, so the far floor
/// must carry the waits of both legs, summed, even though nobody else rides.
#[test]
fn a_lone_far_tenant_carries_the_wait_of_every_landing_it_changes_at() {
    let mut sim = Simulation::new_game(5, GameMode::Classic);
    sim.money = 1e9;
    for x in C..C + 30 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=24 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let low = sim
        .tower
        .place_transport(Kind::ElevatorStandard, C + 4, 1, 12);
    let high = sim
        .tower
        .place_transport(Kind::ElevatorStandard, C + 20, 12, 24);
    assert!(low.ok && high.ok);
    // Heading home to the lobby: both cars idle at their bottom floors, so
    // each landing waits for a car to come up.
    let i = add(&mut sim.crowd, &sim.tower, 24, 1, Some(C + 26), Some(C + 2)).unwrap();
    let id = sim.crowd.people[i].id;
    let mut leg_waits = Vec::new();
    let mut last_wait = 0.0;
    let mut was_waiting = false;
    for _ in 0..3_000 {
        sim.tick(0.25);
        let Some(p) = sim.crowd.people.iter().find(|p| p.id == id) else {
            break;
        };
        let waiting = p.state == PState::Waiting;
        if was_waiting && !waiting {
            leg_waits.push(last_wait);
        }
        (was_waiting, last_wait) = (waiting, p.wait);
    }
    assert!(
        sim.crowd.people.iter().all(|p| p.id != id),
        "the rider arrives"
    );
    assert_eq!(leg_waits.len(), 2, "one wait per elevator: {leg_waits:?}");
    assert!(leg_waits.iter().all(|&w| w > 0.0), "{leg_waits:?}");
    let summed: f64 = leg_waits.iter().sum();
    let recorded = stress(&sim, 24);
    assert!(
        recorded >= lone(summed) && recorded > lone(leg_waits[0].max(leg_waits[1])),
        "the far floor carries both landings: {recorded} vs {leg_waits:?}"
    );
    assert_eq!(stress(&sim, 12), 0.0, "the transfer floor is no one's home");
}

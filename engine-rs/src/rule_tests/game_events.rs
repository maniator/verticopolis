//! Every random event through its daily roll and the player's choice: a
//! fire raises a rescue offer that is paid or declined, spreads upward and
//! auto-declines on the next roll, a bomb threat arrives only from four
//! stars and a paid ransom passes quietly, the thief and the bomb blast
//! place their effects, and a quiet day may print a headline. The rolls are
//! scripted by restoring the stream at a state whose draws fit
//! (`super::rng_state_where`). A refused ransom starts a search in both
//! modes (it no longer settles at once, see the mapping notes); its sweep
//! and detonation are `events_bomb_tests::{enough_guards_find_the_bomb_before_the_deadline,
//! with_no_security_the_bomb_goes_off_at_the_deadline, a_refused_ransom_never_settles_at_once_in_either_mode}`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::rng::Rng;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::rng_state_where;

const BASE_FIRE_CHANCE: f64 = 0.025;
const BOMB_WINDOW: f64 = 0.05;
const FIRE_CONTROL_WITHOUT_SERVICES: f64 = 0.5;
const THIEF_DAILY_CHANCE: f64 = 0.025;
const WIDTH: i64 = 20;

/// A lobby and floor 2 twenty tiles wide (optionally Security there), then
/// one finished office per floor on floors 3 to 6, all at x 0.
fn office_tower(mode: GameMode, star: i64, security: bool) -> Simulation {
    let mut sim = Simulation::new_game(7, mode);
    sim.money = 1_000_000.0;
    sim.star = star;
    for x in 0..WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    if security {
        assert!(sim.tower.place(Kind::Security, 2, 0).ok);
    }
    for floor in 3..=6 {
        for x in 0..WIDTH {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
        assert!(sim.tower.place(Kind::Office, floor, 0).ok);
    }
    sim
}

fn script_main(sim: &mut Simulation, script: impl Fn(&mut Rng) -> bool) {
    let state = rng_state_where(script);
    sim.rng.restore(state);
}

fn script_events(sim: &mut Simulation, script: impl Fn(&mut Rng) -> bool) {
    let state = rng_state_where(script);
    sim.events.extra.restore(state);
}

fn logged(sim: &Simulation, needle: &str) -> bool {
    sim.log.iter().any(|e| e.text.contains(needle))
}

fn any_in(sim: &Simulation, state: UnitState) -> bool {
    sim.tower.units.iter().any(|u| u.state == state)
}

/// A daily roll that sets a fire.
fn fire_day(sim: &mut Simulation) {
    script_main(sim, |r| r.next() < BASE_FIRE_CHANCE);
    sim.maybe_random_event();
}

#[test]
fn a_low_roll_sets_a_fire_and_offers_the_rescue() {
    let mut sim = office_tower(GameMode::Classic, 2, false);
    fire_day(&mut sim);
    assert_eq!(sim.events.count(), 1);
    let offer = sim.events.pending.as_ref().unwrap();
    assert_eq!((offer.kind, offer.cost), ("fireRescue", 150_000.0));
    assert!(logged(&sim, "Fire broke out"));
}

#[test]
fn a_paid_rescue_charges_the_fee_ends_the_blaze_and_guts_the_room() {
    let mut sim = office_tower(GameMode::Classic, 2, false);
    fire_day(&mut sim);
    sim.resolve_choice(true);
    assert_eq!(sim.money, 1_000_000.0 - 150_000.0);
    assert_eq!(sim.events.count(), 0);
    assert!(any_in(&sim, UnitState::Gutted));
    assert!(!any_in(&sim, UnitState::Fire));
}

#[test]
fn a_declined_rescue_leaves_the_fire_burning() {
    let mut sim = office_tower(GameMode::Classic, 2, false);
    fire_day(&mut sim);
    sim.resolve_choice(false);
    assert_eq!(sim.money, 1_000_000.0);
    assert_eq!(sim.events.count(), 1);
    assert!(any_in(&sim, UnitState::Fire));
}

#[test]
fn an_uncontained_blaze_climbs_to_the_room_above() {
    let mut sim = office_tower(GameMode::Classic, 2, false);
    // Ignite, pick the first of the four offices, then fail containment.
    script_main(&mut sim, |r| {
        r.next() < BASE_FIRE_CHANCE && r.next() < 0.25 && r.next() >= FIRE_CONTROL_WITHOUT_SERVICES
    });
    sim.maybe_random_event();
    let lit = sim
        .tower
        .units
        .iter()
        .find(|u| u.state == UnitState::Fire)
        .unwrap();
    assert_eq!(lit.floor, 3);
    let above = sim.tower.room_at(4, 0).unwrap().id;
    assert_ne!(sim.tower.get_unit(above).unwrap().state, UnitState::Fire);
    sim.maybe_random_event();
    assert_eq!(sim.tower.get_unit(above).unwrap().state, UnitState::Fire);
}

#[test]
fn an_unanswered_choice_is_declined_on_the_next_roll() {
    let mut sim = office_tower(GameMode::Classic, 2, false);
    script_main(&mut sim, |r| {
        r.next() < BASE_FIRE_CHANCE && {
            r.next();
            r.next() >= FIRE_CONTROL_WITHOUT_SERVICES
        }
    });
    sim.maybe_random_event();
    assert_eq!(sim.events.pending.as_ref().unwrap().kind, "fireRescue");
    sim.maybe_random_event();
    assert!(sim.events.pending.is_none());
    assert!(sim.events.count() >= 1, "declined, never paid");
    assert_eq!(sim.money, 1_000_000.0);
}

/// A roll past the fire chance but inside the bomb window.
fn bomb_roll(r: &mut Rng) -> bool {
    let roll = r.next();
    (BASE_FIRE_CHANCE..BASE_FIRE_CHANCE + BOMB_WINDOW).contains(&roll)
}

#[test]
fn a_bomb_threat_arrives_on_the_roll_only_from_four_stars() {
    let mut four = office_tower(GameMode::Modern, 4, false);
    script_main(&mut four, bomb_roll);
    four.maybe_random_event();
    let threat = four.events.pending.as_ref().unwrap();
    assert_eq!((threat.kind, threat.cost), ("bombThreat", 300_000.0));

    let mut three = office_tower(GameMode::Modern, 3, false);
    script_main(&mut three, bomb_roll);
    three.maybe_random_event();
    assert!(three.events.pending.is_none());
}

#[test]
fn a_paid_ransom_passes_quietly() {
    let mut sim = office_tower(GameMode::Modern, 4, false);
    script_main(&mut sim, bomb_roll);
    sim.maybe_random_event();
    sim.resolve_choice(true);
    assert_eq!(sim.money, 1_000_000.0 - 300_000.0);
    assert!(logged(&sim, "ransom"));
    assert!(!any_in(&sim, UnitState::Gutted));
    assert!(sim.events.bomb.is_none(), "no search follows a paid ransom");
}

#[test]
fn an_unguarded_blast_flashes_at_the_epicenter_and_a_guarded_sweep_never_does() {
    let mut boom = office_tower(GameMode::Classic, 4, false);
    boom.bomb_threat();
    assert_eq!(boom.fx.explosion.seq, 1);
    assert!((3..=6).contains(&boom.fx.explosion.floor));
    assert!(boom.fx.explosion.x >= 0.0);
    assert!(any_in(&boom, UnitState::Gutted));

    let mut safe = office_tower(GameMode::Classic, 4, true);
    safe.bomb_threat();
    assert_eq!(safe.fx.explosion.seq, 0);
    assert!(logged(&safe, "found nothing"));
}

#[test]
fn a_thief_is_caught_with_security_and_gets_away_without() {
    let mut guarded = office_tower(GameMode::Classic, 2, true);
    script_events(&mut guarded, |r| r.next() < THIEF_DAILY_CHANCE);
    script_main(&mut guarded, |r| r.next() >= 0.5);
    guarded.maybe_random_event();
    let mut bare = office_tower(GameMode::Classic, 2, false);
    script_events(&mut bare, |r| r.next() < THIEF_DAILY_CHANCE);
    script_main(&mut bare, |r| r.next() >= 0.5);
    bare.maybe_random_event();
    // Nobody is inside yet, so the thief prowls the ground lobby.
    let thief = |s: &Simulation| (s.fx.thief.seq, s.fx.thief.caught, s.fx.thief.floor);
    assert_eq!(thief(&guarded), (1, true, 1));
    assert_eq!(thief(&bare), (1, false, 1));
    assert!(bare.money < 1_000_000.0);
    assert_eq!(guarded.money, 1_000_000.0);
}

#[test]
fn the_thief_prowls_a_floor_someone_is_on_asleep_guests_included() {
    for (floor, state) in [(5, UnitState::Occupied), (4, UnitState::Asleep)] {
        let mut sim = office_tower(GameMode::Classic, 2, true);
        let id = sim.tower.room_at(floor, 0).unwrap().id;
        sim.tower.get_unit_mut(id).unwrap().state = state;
        script_events(&mut sim, |r| r.next() < THIEF_DAILY_CHANCE);
        script_main(&mut sim, |r| r.next() >= 0.5);
        sim.maybe_random_event();
        assert_eq!((sim.fx.thief.caught, sim.fx.thief.floor), (true, floor));
    }
}

#[test]
fn a_quiet_day_may_print_a_headline() {
    let mut sim = office_tower(GameMode::Classic, 2, false);
    script_main(&mut sim, |r| {
        r.next() >= 0.5 && r.next() < 0.15 && r.next() < 0.5
    });
    sim.maybe_random_event();
    assert!(logged(&sim, "praised"));
    assert_eq!(sim.events.count(), 0);
    assert!(sim.events.pending.is_none());
}

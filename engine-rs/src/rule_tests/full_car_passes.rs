//! A Modern car its riders fill passes the hall calls on its way and stops
//! only where someone aboard gets off, so another car takes those calls
//! (`rules::elevators::full_cars_pass_hall_calls`). Before, a full car
//! stopped at every floor with someone waiting, though nobody could board,
//! and on the owner's split tower all eight cars of a shaft crawled up
//! together at the evening rush while riders above the lobby waited over an
//! hour. Classic keeps stopping: its crowd is a sample too small to fill a
//! car, and no source says what the 1994 game does with a full one.
use crate::clock::GameMode;
use crate::crowd::fasthash::FastMap;
use crate::crowd::ElevatorCalls;
use crate::dispatch::{ElevatorDispatch, Leaving};
use crate::schedule::Schedule;

use super::classic_elevator_dispatch::{schedule, shaft_tower, HOUR, TOP, WEEKDAY};

/// Two cars parked at the lobby. Car 0 sets off for the top with a rider
/// (a full cab when `full`), then a call comes in at floor 10 as it climbs.
/// The car that first stops at floor 10, and whether car 0 ever stops there.
fn who_answers(mode: GameMode, full: bool) -> (Option<usize>, bool) {
    let s = Schedule {
        home_floors: Some(vec![1, 1]),
        ..schedule(None)
    };
    let (mut tower, id) = shaft_tower(mode, 2, s);
    let mut d = ElevatorDispatch::new();
    let mut calls = ElevatorCalls::default();
    let cab = FastMap::from_iter([(0, [TOP].into_iter().collect())]);
    calls.cab.insert(id, cab);
    if full {
        calls.full.push((id, 0));
    }
    for _ in 0..2 {
        d.move_cars(&mut tower, 0.5, &calls, HOUR, WEEKDAY);
    }
    calls
        .hall
        .insert(id, FastMap::from_iter([(10, 1.0.into())]));
    let (mut first, mut car_0_stopped) = (None, false);
    for _ in 0..60 {
        let before = tower.transports[0].car_positions.clone();
        d.move_cars(&mut tower, 0.5, &calls, HOUR, WEEKDAY);
        let after = &tower.transports[0].car_positions;
        // A car on floor 10 at both ends of a step stood there.
        let stood = |car: usize| before[car] == 10.0 && after[car] == 10.0;
        car_0_stopped |= stood(0);
        first = first.or((0..2).find(|&car| stood(car)));
    }
    (first, car_0_stopped)
}

#[test]
fn a_full_modern_car_passes_the_call_and_another_car_takes_it() {
    assert_eq!(who_answers(GameMode::Modern, true), (Some(1), false));
}

#[test]
fn a_modern_car_with_room_answers_the_call_on_its_way() {
    assert_eq!(who_answers(GameMode::Modern, false), (Some(0), true));
}

#[test]
fn a_full_classic_car_still_stops_for_the_call() {
    assert_eq!(who_answers(GameMode::Classic, true), (Some(0), true));
    assert_eq!(who_answers(GameMode::Classic, false), (Some(0), true));
}

#[test]
fn a_modern_car_is_full_from_the_rider_who_fills_it_until_one_steps_off() {
    use crate::crowd::motion::advance;
    use crate::crowd::spawn::make_person;
    use crate::crowd::{Crowd, PState, Route};
    for (mode, marked) in [(GameMode::Modern, true), (GameMode::Classic, false)] {
        let (mut tower, id) = shaft_tower(mode, 2, schedule(None));
        let capacity = tower.transports[0].kind.car_capacity() as i64;
        let mut crowd = Crowd::new(7);
        let route = Route {
            floors: vec![1, TOP],
            shafts: vec![id],
        };
        let i = make_person(&mut crowd, &tower, route, 120.0, None);
        crowd.people[i].state = PState::Waiting;
        // One seat left in car 0, standing open at the lobby.
        crowd.car_riders.insert((id, 0), capacity - 1);
        crowd.open_cars = vec![(id, 0, 1, Leaving::Either)];
        advance(&mut crowd, 0.5, &mut tower);
        assert_eq!(crowd.people[i].state, PState::Riding, "{mode:?}");
        let calls = crowd.elevator_calls(&tower);
        assert_eq!(calls.full.contains(&(id, 0)), marked, "{mode:?} filled");
        assert!(!calls.full.contains(&(id, 1)));
        // The car reaches the rider's floor and they step off.
        tower.transports[0].car_positions[0] = TOP as f64;
        crowd.open_cars = vec![(id, 0, TOP, Leaving::Either)];
        advance(&mut crowd, 0.5, &mut tower);
        assert_ne!(crowd.people.get(i).map(|p| p.state), Some(PState::Riding));
        assert!(
            crowd.elevator_calls(&tower).full.is_empty(),
            "{mode:?} left"
        );
    }
}

/// The owner's split tower (`conformance/fixtures/regression/split-tower-26.vctower`,
/// a Modern save at 9 AM), played in one-minute steps as the game runs it
/// through the evening rush to 8 PM: the longest anyone above the lobby
/// stood in a line, in crowd seconds. Housekeepers keep their own longer
/// patience and are left out.
fn longest_wait_above_the_lobby() -> f64 {
    let bytes = include_bytes!("../../../conformance/fixtures/regression/split-tower-26.vctower");
    let save = crate::load::decode_vctower_bytes(bytes).expect("the fixture decodes");
    let mut sim = crate::load::deserialize(&save).expect("the fixture loads");
    assert_eq!(sim.tower.mode, GameMode::Modern);
    let mut longest: f64 = 0.0;
    while sim.clock.hour() < 20 {
        sim.tick(1.0);
        let above = sim.crowd.people.iter().filter(|p| p.floor >= 2 && !p.staff);
        longest = above.fold(longest, |w, p| w.max(p.wait));
    }
    longest
}

#[test]
fn nobody_above_the_lobby_of_the_owners_split_tower_waits_seventy_minutes() {
    // Full cars stopping at every waiting floor kept riders there for two
    // hours and twenty-three minutes (286 crowd seconds); with full cars
    // passing, the longest wait is just under an hour.
    let longest = longest_wait_above_the_lobby();
    assert!(longest < 140.0, "longest wait {longest} crowd seconds");
}

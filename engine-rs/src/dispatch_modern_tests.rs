//! Modern's best-car choice and spread homes, case by case. Whole-shaft
//! behavior is `rule_tests::modern_elevator_dispatch`.

use std::collections::BTreeSet;

use super::*;
use crate::dispatch::CAR_FLOORS_PER_MINUTE;

const STOPS: [i64; 20] = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
];
const SPAN: f64 = 19.0;

fn parked(pos: f64) -> CarView {
    CarView::of(pos, 0, 0.0, None, 0.8, CAR_FLOORS_PER_MINUTE)
}

fn moving(pos: f64, dir: i64) -> CarView {
    CarView::of(pos, dir, 0.0, None, 0.8, CAR_FLOORS_PER_MINUTE)
}

/// A shaft over `STOPS` with `cars` on shift.
fn shaft(cars: &[CarView], response: Option<f64>) -> BestCars {
    let mut best = BestCars::default();
    best.start(STOPS.len(), response, SPAN);
    for &car in cars {
        best.push(car, false);
    }
    best
}

/// The car `BestCars` gives the call at `floor`.
fn owner_of(cars: &[CarView], floor: i64, response: Option<f64>) -> usize {
    let k = STOPS.binary_search(&floor).unwrap();
    shaft(cars, response).owner(k, floor, None)
}

#[test]
fn the_rules_follow_the_mode() {
    let classic = DispatchRules::for_mode(GameMode::Classic);
    assert!(classic.parked_car_yields && !classic.best_car && !classic.spread_homes);
    assert!(!classic.parked_owner_boards);
    assert_eq!(classic.departure_limit, None);
    let modern = DispatchRules::for_mode(GameMode::Modern);
    assert!(!modern.parked_car_yields && modern.best_car && modern.spread_homes);
    assert!(modern.parked_owner_boards);
    assert_eq!(modern.departure_limit, Some(2.0));
    // Modern cars move twice the base speed and its express cars four
    // times, with real office commutes (`REAL_OFFICE_COMMUTES_ON`).
    assert_eq!((classic.car_speed, classic.express_speed), (1.0, 1.0));
    assert_eq!((modern.car_speed, modern.express_speed), (2.0, 4.0));
    for rules in [classic, modern] {
        assert!(rules.departure_restarts && !rules.parked_reach_gate);
    }
    let scan = DispatchRules::plain_scan();
    assert!(scan.parked_reach_gate && !scan.departure_restarts && !scan.best_car);
    assert!(!scan.parked_owner_boards);
    assert_eq!((scan.car_speed, scan.express_speed), (1.0, 1.0));
}

#[test]
fn owed_time_counts_in_the_floors_the_car_covers() {
    // A dwelling express car four times as fast owes four times the floors
    // for the same minutes, so its cost stays a measure of time.
    let slow = CarView::of(9.0, 0, 10.0, None, 0.8, CAR_FLOORS_PER_MINUTE);
    let fast = CarView::of(9.0, 0, 10.0, None, 0.8, CAR_FLOORS_PER_MINUTE * 4.0);
    assert_eq!(slow.owed, 10.0 * CAR_FLOORS_PER_MINUTE);
    assert_eq!(fast.owed, 4.0 * slow.owed);
}

#[test]
fn an_unset_home_is_the_lobby_unless_spread() {
    for car in 0..4 {
        assert_eq!(idle_home(false, &STOPS, 1, car, 4), 1);
    }
    // Car 0 at the lobby, then stops 5, 10 and 15 of the twenty.
    let spread: Vec<i64> = (0..4).map(|i| idle_home(true, &STOPS, 1, i, 4)).collect();
    assert_eq!(spread, vec![1, 6, 11, 16]);
    // A lobby that is not the bottom stop still takes car 0.
    assert_eq!(idle_home(true, &STOPS, 5, 0, 4), 5);
    // No car past the fleet, and no stops, spread anywhere.
    assert_eq!(idle_home(true, &STOPS, 1, 4, 4), 1);
    assert_eq!(idle_home(true, &[], 1, 2, 4), 1);
    // One car stays at the lobby.
    assert_eq!(idle_home(true, &STOPS, 1, 0, 1), 1);
}

#[test]
fn a_car_view_turns_at_its_farthest_promised_stop_ahead() {
    let cab: BTreeSet<i64> = [4, 12, 18].into_iter().collect();
    let up = CarView::of(10.0, 1, 0.5, Some(&cab), 0.8, CAR_FLOORS_PER_MINUTE);
    assert_eq!(up.turn, 18.0);
    // Half a minute of dwell left and three promised stops of 0.8 minutes.
    assert!((up.owed - (0.5 + 3.0 * 0.8) * CAR_FLOORS_PER_MINUTE).abs() < 1e-12);
    let down = CarView::of(10.0, -1, 0.0, Some(&cab), 0.8, CAR_FLOORS_PER_MINUTE);
    assert_eq!(down.turn, 4.0);
    // Nothing promised ahead: the car turns where it stands.
    let past: BTreeSet<i64> = [4].into_iter().collect();
    assert_eq!(
        CarView::of(10.0, 1, 0.0, Some(&past), 0.8, CAR_FLOORS_PER_MINUTE).turn,
        10.0
    );
    assert_eq!(parked(7.0).turn, 7.0);
    assert_eq!(parked(7.0).owed, 0.0);
}

#[test]
fn the_nearest_parked_car_takes_a_call() {
    let cars = [parked(1.0), parked(9.0), parked(16.0)];
    assert_eq!(owner_of(&cars, 12, None), 1);
    assert_eq!(owner_of(&cars, 18, None), 2);
    // A tie goes to the lower index.
    assert_eq!(owner_of(&[parked(8.0), parked(12.0)], 10, None), 0);
}

#[test]
fn a_car_moving_away_yields_to_a_farther_parked_car() {
    // Car 0 is two floors from the call but heading up past it.
    let cars = [moving(12.0, 1), parked(3.0)];
    assert_eq!(owner_of(&cars, 10, None), 1);
    // With no other car, the car moving away still owns it.
    assert_eq!(owner_of(&[moving(12.0, 1)], 10, None), 0);
    // A car heading toward the call is just a near car.
    assert_eq!(owner_of(&[moving(8.0, 1), parked(3.0)], 10, None), 0);
}

#[test]
fn promised_stops_and_dwell_cost_a_car_the_call() {
    let cab: BTreeSet<i64> = (11..=19).collect();
    // Car 0 is nearer but owes nine stops on the way; car 1 is free.
    let busy = CarView::of(9.0, 1, 0.0, Some(&cab), 0.8, CAR_FLOORS_PER_MINUTE);
    assert_eq!(owner_of(&[busy, parked(4.0)], 10, None), 1);
    // A long dwell left counts the same way.
    let dwelling = CarView::of(9.0, 0, 10.0, None, 0.8, CAR_FLOORS_PER_MINUTE);
    assert_eq!(owner_of(&[dwelling, parked(4.0)], 10, None), 1);
}

#[test]
fn a_car_already_coming_within_the_response_wins_outright() {
    // Car 1 is parked a floor away, car 0 is coming from five floors down
    // with a full cab: within a response of 6 the coming car keeps the call.
    let cab: BTreeSet<i64> = (11..=19).collect();
    let coming = CarView::of(5.0, 1, 0.0, Some(&cab), 0.8, CAR_FLOORS_PER_MINUTE);
    let cars = [coming, parked(11.0)];
    assert_eq!(owner_of(&cars, 10, Some(6.0)), 0);
    // Outside the response it is the plain score again.
    assert_eq!(owner_of(&cars, 10, Some(4.0)), 1);
    assert_eq!(owner_of(&cars, 10, None), 1);
    // Of two coming cars the nearer wins.
    let both = [moving(4.0, 1), moving(7.0, 1)];
    assert_eq!(owner_of(&both, 10, Some(8.0)), 1);
}

#[test]
fn a_car_that_will_pass_callers_bound_the_other_way_yields_the_call() {
    // Car 0 climbs from 3 with a rider for 15; car 1 is parked at 10. A
    // caller at 6 bound down would wait for car 0 to come back from 15.
    let cab = BTreeSet::from([15]);
    let climbing = CarView::of(3.0, 1, 0.0, Some(&cab), 0.8, CAR_FLOORS_PER_MINUTE);
    let best = shaft(&[climbing, parked(10.0)], None);
    let k6 = 5;
    assert_eq!(best.owner(k6, 6, Some(-1)), 1, "bound down");
    // Bound up, or bound either way, car 0 picks them up on its way.
    for bound in [Some(1), None] {
        let best = shaft(&[climbing, parked(10.0)], None);
        assert_eq!(best.owner(k6, 6, bound), 0, "{bound:?}");
    }
    // With no rider beyond 6, car 0 turns there, so it still takes them.
    let turning = moving(3.0, 1);
    let best = shaft(&[turning, parked(10.0)], None);
    assert_eq!(best.owner(k6, 6, Some(-1)), 0);
}

#[test]
fn a_stop_keeps_the_owner_it_was_first_given() {
    let mut best = shaft(&[parked(1.0), parked(20.0)], None);
    let (k3, k18) = (2, 17);
    assert_eq!(best.owner(k3, 3, None), 0);
    assert_eq!(best.owner(k18, 18, None), 1);
    // A car added after the answer does not change it.
    best.push(parked(3.0), false);
    assert_eq!(best.owner(k3, 3, None), 0);
    // A new step starts every stop over.
    best.start(STOPS.len(), None, SPAN);
    best.push(parked(20.0), false);
    assert_eq!(best.owner(k3, 3, None), 0);
    // Nobody on shift: the calls stay unowned.
    best.start(STOPS.len(), None, SPAN);
    assert_eq!(best.owner(k3, 3, None), NO_CAR);
}

/// How far the express and the standard car climb in one 2.5-minute chunk
/// toward a call at the top of a 40-floor `mode` tower, each car starting
/// parked at the lobby.
fn climbs(mode: GameMode) -> (f64, f64) {
    use crate::crowd::ElevatorCalls;
    use crate::dispatch::ElevatorDispatch;
    use crate::facilities::Kind;
    use crate::tower::Tower;
    let mut tower = Tower::new();
    tower.mode = mode;
    let lobby = Kind::Lobby.facility().width;
    for x in (100..140).step_by(lobby as usize) {
        assert!(tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=40 {
        for x in 100..140 {
            assert!(tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let standard = tower.place_transport(Kind::ElevatorStandard, 110, 1, 30);
    let express = tower.place_transport(Kind::ElevatorExpress, 120, 1, 40);
    let ids = [standard.unit_id.unwrap(), express.unit_id.unwrap()];
    let mut calls = ElevatorCalls::default();
    for (id, top) in ids.into_iter().zip([30, 40]) {
        let t = tower.transports.iter_mut().find(|t| t.id == id).unwrap();
        t.skip_floors = None;
        t.cars = 1;
        (t.car_positions, t.car_dir) = (vec![1.0], vec![0]);
        calls
            .hall
            .get_or_insert_with(id, Default::default)
            .insert(top, 1.0.into());
    }
    tower.reindex();
    ElevatorDispatch::new().move_cars(&mut tower, 2.5, &calls, 10, false);
    let at = |id| {
        tower
            .transports
            .iter()
            .find(|t| t.id == id)
            .unwrap()
            .car_positions[0]
            - 1.0
    };
    (at(ids[0]), at(ids[1]))
}

#[test]
fn modern_cars_climb_twice_and_express_four_times_as_far_as_classic() {
    let (classic, classic_express) = climbs(GameMode::Classic);
    assert!(classic > 0.0, "the Classic car set off");
    assert_eq!(classic_express, classic, "Classic keeps one speed");
    let (standard, express) = climbs(GameMode::Modern);
    let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
    assert!(near(standard, 2.0 * classic), "{classic} vs {standard}");
    assert!(near(express, 4.0 * classic), "{classic} vs {express}");
}

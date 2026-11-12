//! Modern's best-car choice and spread homes, case by case. Whole-shaft
//! behavior is `rule_tests::modern_elevator_dispatch`.

use std::collections::BTreeSet;

use super::*;

const STOPS: [i64; 20] = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
];
const SPAN: f64 = 19.0;

fn parked(pos: f64) -> CarView {
    CarView::of(pos, 0, 0.0, None, 0.8)
}

fn moving(pos: f64, dir: i64) -> CarView {
    CarView::of(pos, dir, 0.0, None, 0.8)
}

/// The bit set over `STOPS` with a call at each of `floors`.
fn calls_at(floors: &[i64]) -> Vec<u64> {
    let mut bits = vec![0u64; 1];
    for f in floors {
        let k = STOPS.binary_search(f).unwrap();
        bits[0] |= 1 << k;
    }
    bits
}

/// The car `assign_best_cars` gives the one call at `floor`.
fn owner_of(cars: &[CarView], floor: i64, response: Option<f64>) -> usize {
    let mut owner = Vec::new();
    assign_best_cars(
        cars,
        &STOPS,
        &calls_at(&[floor]),
        response,
        SPAN,
        &mut owner,
    );
    owner[STOPS.binary_search(&floor).unwrap()]
}

#[test]
fn the_rules_follow_the_mode() {
    let classic = DispatchRules::for_mode(GameMode::Classic);
    assert!(classic.parked_car_yields && !classic.best_car && !classic.spread_homes);
    assert_eq!(classic.departure_limit, None);
    let modern = DispatchRules::for_mode(GameMode::Modern);
    assert!(!modern.parked_car_yields && modern.best_car && modern.spread_homes);
    assert_eq!(modern.departure_limit, Some(2.0));
    for rules in [classic, modern] {
        assert!(rules.departure_restarts && !rules.parked_reach_gate);
    }
    let scan = DispatchRules::plain_scan();
    assert!(scan.parked_reach_gate && !scan.departure_restarts && !scan.best_car);
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
    let up = CarView::of(10.0, 1, 0.5, Some(&cab), 0.8);
    assert_eq!(up.turn, 18.0);
    // Half a minute of dwell left and three promised stops of 0.8 minutes.
    assert!((up.owed - (0.5 + 3.0 * 0.8) * CAR_FLOORS_PER_MINUTE).abs() < 1e-12);
    let down = CarView::of(10.0, -1, 0.0, Some(&cab), 0.8);
    assert_eq!(down.turn, 4.0);
    // Nothing promised ahead: the car turns where it stands.
    let past: BTreeSet<i64> = [4].into_iter().collect();
    assert_eq!(CarView::of(10.0, 1, 0.0, Some(&past), 0.8).turn, 10.0);
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
    let busy = CarView::of(9.0, 1, 0.0, Some(&cab), 0.8);
    assert_eq!(owner_of(&[busy, parked(4.0)], 10, None), 1);
    // A long dwell left counts the same way.
    let dwelling = CarView::of(9.0, 0, 10.0, None, 0.8);
    assert_eq!(owner_of(&[dwelling, parked(4.0)], 10, None), 1);
}

#[test]
fn a_car_already_coming_within_the_response_wins_outright() {
    // Car 1 is parked a floor away, car 0 is coming from five floors down
    // with a full cab: within a response of 6 the coming car keeps the call.
    let cab: BTreeSet<i64> = (11..=19).collect();
    let coming = CarView::of(5.0, 1, 0.0, Some(&cab), 0.8);
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
fn every_called_stop_gets_an_owner_and_nothing_else_does() {
    let cars = [parked(1.0), parked(20.0)];
    let mut owner = vec![7; 3];
    let calls = calls_at(&[3, 18]);
    assign_best_cars(&cars, &STOPS, &calls, None, SPAN, &mut owner);
    assert_eq!(owner.len(), STOPS.len());
    for (k, &o) in owner.iter().enumerate() {
        let want = match STOPS[k] {
            3 => 0,
            18 => 1,
            _ => NO_CAR,
        };
        assert_eq!(o, want, "stop {}", STOPS[k]);
    }
    // Nobody on shift: the calls stay unowned.
    assign_best_cars(&[], &STOPS, &calls, None, SPAN, &mut owner);
    assert!(owner.iter().all(|&o| o == NO_CAR));
}

//! Buying a car through `add_car` puts it on the shaft's duty pattern, and
//! the pattern survives a save and load (#1546).

use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load_stream::load_save_text;
use crate::schedule::Schedule;

fn pattern(sim: &Simulation, id: i64) -> (Vec<i64>, Vec<i64>) {
    let s = sim
        .tower
        .get_transport(id)
        .unwrap()
        .schedule
        .as_ref()
        .unwrap();
    (s.weekday.clone().unwrap(), s.weekend.clone().unwrap())
}

#[test]
fn a_bought_car_inherits_the_authored_pattern_and_keeps_it_through_a_save() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    for x in 10..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 10, 1, 2).ok);
    let lift = sim.tower.transport_at(1, 10).unwrap().id;
    sim.money = 1_000_000.0;
    // One car on every hour, and nobody on shift overnight on weekends.
    let weekend: Vec<i64> = (0..24).map(|h| if h < 6 { 0 } else { 1 }).collect();
    sim.tower.transports[0].schedule = Some(Schedule {
        weekday: Some(vec![1; 24]),
        weekend: Some(weekend.clone()),
        waiting_car_response: None,
        standard_floor_departure: None,
        home_floors: None,
        held_back: None,
        auto_tune: false,
    });
    assert!(sim.add_car(lift).ok);
    assert!(sim.add_car(lift).ok);
    let bought_weekend: Vec<i64> = weekend
        .iter()
        .map(|n| if *n == 0 { 0 } else { 3 })
        .collect();
    assert_eq!(pattern(&sim, lift), (vec![3; 24], bought_weekend.clone()));

    let loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.tower.get_transport(lift).unwrap().cars, 3);
    assert_eq!(pattern(&loaded, lift), (vec![3; 24], bought_weekend));
}

fn four_car_shaft() -> (Simulation, i64, Vec<i64>, Vec<i64>) {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    for x in 10..40 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 10, 1, 2).ok);
    let lift = sim.tower.transport_at(1, 10).unwrap().id;
    sim.money = 1_000_000.0;
    assert!(sim.tower.set_cars(lift, 4));
    // Hours at 4, 3, 2, 1 and 0 active cars, the weekend the other way round.
    let weekday: Vec<i64> = (0..24).map(|h| [4, 3, 2, 1, 0][h % 5]).collect();
    let weekend: Vec<i64> = (0..24).map(|h| [0, 1, 2, 3, 4][h % 5]).collect();
    sim.tower.transports[0].schedule = Some(Schedule {
        weekday: Some(weekday.clone()),
        weekend: Some(weekend.clone()),
        waiting_car_response: None,
        standard_floor_departure: None,
        home_floors: Some(vec![1, 2, 1, 2]),
        held_back: None,
        auto_tune: false,
    });
    (sim, lift, weekday, weekend)
}

fn installed(sim: &Simulation, id: i64) -> (usize, usize, Vec<i64>) {
    let t = sim.tower.get_transport(id).unwrap();
    let homes = t.schedule.as_ref().unwrap().home_floors.clone().unwrap();
    (t.car_positions.len(), t.car_dir.len(), homes)
}

#[test]
fn a_sold_car_clamps_the_pattern_and_a_rebuy_follows_the_inheritance_rule() {
    let (mut sim, lift, weekday, weekend) = four_car_shaft();
    let money = sim.money;
    let clamp =
        |row: &[i64], cars: i64| -> Vec<i64> { row.iter().map(|n| (*n).min(cars)).collect() };

    assert_eq!(
        sim.remove_car(lift),
        ChargeResult::paid(car_resale_refund())
    );
    assert_eq!(
        pattern(&sim, lift),
        (clamp(&weekday, 3), clamp(&weekend, 3))
    );
    assert_eq!(installed(&sim, lift), (3, 3, vec![1, 2, 1]));
    assert_eq!(
        sim.remove_car(lift),
        ChargeResult::paid(car_resale_refund())
    );
    assert_eq!(
        pattern(&sim, lift),
        (clamp(&weekday, 2), clamp(&weekend, 2))
    );
    assert_eq!(installed(&sim, lift), (2, 2, vec![1, 2]));
    assert_eq!(sim.money, money + 2.0 * car_resale_refund());

    let loaded = load_save_text(sim.save_text().as_bytes()).unwrap();
    assert_eq!(loaded.tower.get_transport(lift).unwrap().cars, 2);
    assert_eq!(
        pattern(&loaded, lift),
        (clamp(&weekday, 2), clamp(&weekend, 2))
    );
    assert_eq!(installed(&loaded, lift), (2, 2, vec![1, 2]));

    // The hours the player cut back that the sales left at the fleet's size
    // are held back (#1546), and the save keeps them as version 10.
    let held =
        |row: &[i64]| -> Vec<usize> { (0..24).filter(|&h| (2..4).contains(&row[h])).collect() };
    let held_back = |sim: &Simulation| {
        let s = sim
            .tower
            .get_transport(lift)
            .unwrap()
            .schedule
            .clone()
            .unwrap();
        s.held_back.map(|h| (h.weekday, h.weekend))
    };
    assert_eq!(held_back(&sim), Some((held(&weekday), held(&weekend))));
    let text = sim.save_text();
    // The held hour takes version 10 (this tower lists no floor run).
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap()["version"],
        10
    );
    assert_eq!(
        held_back(&load_save_text(text.as_bytes()).unwrap()),
        held_back(&sim)
    );

    // Buying one back: only the hours that ran the whole fleet run 3. A
    // held-back hour keeps the 2 the sale left it, and stops being held once
    // that is below the fleet.
    assert!(sim.add_car(lift).ok);
    let regrown = |row: &[i64]| -> Vec<i64> {
        row.iter()
            .map(|n| if *n == 4 { 3 } else { (*n).min(2) })
            .collect()
    };
    assert_eq!(pattern(&sim, lift), (regrown(&weekday), regrown(&weekend)));
    assert_eq!(held_back(&sim), None);
    let text = sim.save_text();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&text).unwrap()["version"],
        7
    );

    // The last car is never sold.
    assert!(sim.tower.set_cars(lift, 1));
    assert_eq!(sim.remove_car(lift), ChargeResult::refuse(LAST_CAR));
}

/// A player's edit keeps the held hours whose counts it leaves as they were,
/// so pressing OK changes nothing, and drops one it sets to another count; a
/// schedule that lists them, as a save does, keeps the ones at the fleet's
/// size and drops the rest (#1546).
#[test]
fn an_edit_keeps_untouched_held_hours_and_held_hours_stay_only_at_the_fleet_size() {
    let (mut sim, lift, _, _) = four_car_shaft();
    assert!(sim.remove_car(lift).ok);
    let schedule = |sim: &Simulation| {
        sim.tower
            .get_transport(lift)
            .unwrap()
            .schedule
            .clone()
            .unwrap()
    };
    let held = schedule(&sim);
    let was = held
        .held_back
        .clone()
        .expect("the sale held the 3-car hours back");
    assert!(!was.weekday.is_empty() && !was.weekend.is_empty());

    // OK with nothing changed: every held hour stays held.
    let mut edit = held.to_json();
    edit.as_object_mut().unwrap().remove("heldBack");
    assert!(sim.tower.set_schedule(lift, &edit));
    assert_eq!(schedule(&sim).held_back, Some(was.clone()));

    // The player sets the first held weekday hour to 2: it stops being held,
    // and every other held hour stays.
    let first = was.weekday[0];
    edit["activeCars"]["weekday"][first] = serde_json::json!(2);
    assert!(sim.tower.set_schedule(lift, &edit));
    let after = schedule(&sim);
    let mut weekday = was.weekday.clone();
    weekday.remove(0);
    assert_eq!(
        after.held_back,
        Some(crate::schedule::HeldBack {
            weekday,
            weekend: was.weekend.clone()
        })
    );
    assert_eq!(after.weekday.as_ref().unwrap()[first], 2);

    // A car bought back joins neither the held hours nor the one set to 2.
    assert!(sim.add_car(lift).ok);
    let bought = schedule(&sim);
    for &h in &was.weekend {
        assert_eq!(
            bought.weekend.as_ref().unwrap()[h],
            3,
            "weekend {h} stays held at 3"
        );
    }
    assert_eq!(bought.weekday.as_ref().unwrap()[first], 2);

    // On a fresh shaft sold to 3: hour 1 runs the fleet of 3 on weekdays,
    // hour 0 runs 3 and hour 2 runs 2, so only the whole, in-range hours at
    // the fleet's size are kept, once.
    let (mut sim, lift, _, _) = four_car_shaft();
    assert!(sim.remove_car(lift).ok);
    let mut listed = held.to_json();
    listed["heldBack"] = serde_json::json!({
        "weekday": [1, 1, 0, 2, 24, -1, 1.5, "1", null],
        "weekend": "every hour"
    });
    assert!(sim.tower.set_schedule(lift, &listed));
    let weekday = held.weekday.clone().unwrap();
    assert_eq!((weekday[0], weekday[1], weekday[2]), (3, 3, 2));
    assert_eq!(
        schedule(&sim).held_back,
        Some(crate::schedule::HeldBack {
            weekday: vec![0, 1],
            weekend: vec![]
        })
    );
}

/// A refit that holds nothing leaves no held list, so the save keeps the
/// version older builds open (#1546 review).
#[test]
fn a_refit_that_holds_nothing_leaves_no_held_list_and_the_old_save_version() {
    let (mut sim, _, _, _) = four_car_shaft();
    let mut whole = Schedule {
        weekday: Some(vec![4; 24]),
        weekend: Some(vec![4; 24]),
        waiting_car_response: None,
        standard_floor_departure: None,
        home_floors: None,
        held_back: None,
        auto_tune: false,
    };
    whole.refit(4, 3);
    assert_eq!(
        whole.held_back, None,
        "a sale that cut no hour back holds none"
    );
    whole.refit(3, 4);
    assert_eq!(whole.held_back, None, "a buy holds nothing");
    assert!(!whole.holds_an_hour());

    let s = sim.tower.transports[0].schedule.as_mut().unwrap();
    s.held_back = Some(crate::schedule::HeldBack::default());
    s.refit(4, 5);
    assert_eq!(s.held_back, None);
    let s = sim.tower.transports[0].schedule.as_mut().unwrap();
    s.held_back = Some(crate::schedule::HeldBack::default());
    assert!(
        !sim.tower.holds_an_hour_back(),
        "an empty held list holds nothing"
    );
    let text = sim.save_text();
    let version = serde_json::from_str::<serde_json::Value>(&text).unwrap()["version"].clone();
    assert_eq!(version, 7);
}

//! The morning checkout's latch of yesterday's housekeeping shift.

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

#[test]
fn the_morning_checkout_latches_yesterdays_shift() {
    let mut sim = Simulation::new_game(9, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    for x in 170..200 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
        assert!(sim.build(Kind::Floor, 2, x).ok);
    }
    assert!(sim.build(Kind::HotelSingle, 2, 172).ok);
    assert!(sim.build(Kind::HotelSingle, 2, 180).ok);
    assert_eq!(sim.housekeeping.yesterday, None);
    for u in sim
        .tower
        .units
        .iter_mut()
        .filter(|u| u.kind == Kind::HotelSingle)
    {
        u.state = UnitState::Dirty;
    }
    sim.housekeeping.cleaned_today = 3;
    sim.housekeeping_before_checkout();
    assert_eq!(sim.housekeeping.yesterday, Some((3, 2)));
    assert_eq!(sim.housekeeping.cleaned_today, 0);
    // A quiet day latches the zero result too.
    for u in sim
        .tower
        .units
        .iter_mut()
        .filter(|u| u.kind == Kind::HotelSingle)
    {
        u.state = UnitState::Empty;
    }
    sim.housekeeping_before_checkout();
    assert_eq!(sim.housekeeping.yesterday, Some((0, 0)));
}

/// A tower with two hotel rooms, served by nobody yet.
fn hotel_tower() -> Simulation {
    let mut sim = Simulation::new_game(9, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    for x in 170..200 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
        assert!(sim.build(Kind::Floor, 2, x).ok);
    }
    assert!(sim.build(Kind::HotelSingle, 2, 172).ok);
    assert!(sim.build(Kind::HotelSingle, 2, 180).ok);
    sim
}

fn reload(sim: &Simulation) -> Simulation {
    crate::load_stream::load_save_text(sim.save_text().as_bytes()).unwrap()
}

#[test]
fn a_reload_mid_day_keeps_the_rooms_cleaned_and_yesterdays_shift() {
    let mut sim = hotel_tower();
    sim.housekeeping.cleaned_today = 7;
    sim.housekeeping.yesterday = Some((5, 1));
    let mut loaded = reload(&sim);
    assert_eq!(loaded.housekeeping.cleaned_today, 7);
    assert_eq!(loaded.housekeeping.yesterday, Some((5, 1)));
    // The morning checkout then says the same as the unbroken game.
    sim.housekeeping_before_checkout();
    loaded.housekeeping_before_checkout();
    let line = |s: &Simulation| s.log.last().map(|e| e.text.clone());
    assert_eq!(line(&loaded), line(&sim));
    assert!(line(&sim).unwrap().contains("cleaned 7 hotel room(s)"));
    assert_eq!(loaded.housekeeping.yesterday, sim.housekeeping.yesterday);
}

#[test]
fn a_tower_with_nothing_to_tally_saves_no_housekeeping_key() {
    let sim = hotel_tower();
    assert!(sim.serialize().get("housekeeping").is_none());
    let loaded = reload(&sim);
    assert_eq!(loaded.housekeeping.cleaned_today, 0);
    assert_eq!(loaded.housekeeping.yesterday, None);
}

#[test]
fn a_save_without_the_tallies_or_with_bad_ones_starts_them_fresh() {
    let mut sim = hotel_tower();
    sim.housekeeping.cleaned_today = 4;
    sim.housekeeping.yesterday = Some((2, 2));
    let saved = sim.serialize();
    for tallies in [
        None,
        Some(serde_json::json!({ "cleanedToday": -3, "yesterday": [1] })),
        Some(serde_json::json!({ "cleanedToday": 1.5, "yesterday": [-1, 2] })),
        Some(serde_json::json!("seven")),
    ] {
        let mut raw = saved.clone();
        match tallies {
            Some(t) => raw["housekeeping"] = t,
            None => {
                raw.as_object_mut().unwrap().remove("housekeeping");
            }
        }
        let loaded = crate::load::deserialize(&raw).unwrap();
        assert_eq!(loaded.housekeeping.cleaned_today, 0, "{raw}");
        assert_eq!(loaded.housekeeping.yesterday, None, "{raw}");
    }
}

#[test]
fn a_reload_keeps_the_days_the_nudges_last_fired() {
    let mut sim = hotel_tower();
    sim.housekeeping.nudged_day = 3;
    sim.housekeeping.commute_nudged_day = 2;
    let loaded = crate::load::deserialize(&sim.serialize()).unwrap();
    assert_eq!(loaded.housekeeping.nudged_day, 3);
    assert_eq!(loaded.housekeeping.commute_nudged_day, 2);
    let mut raw = sim.serialize();
    raw["housekeeping"]["nudgedDay"] = serde_json::json!(-4);
    raw["housekeeping"]["commuteNudgedDay"] = serde_json::json!("two");
    let loaded = crate::load::deserialize(&raw).unwrap();
    assert_eq!(loaded.housekeeping.nudged_day, -1);
    assert_eq!(loaded.housekeeping.commute_nudged_day, -1);
}

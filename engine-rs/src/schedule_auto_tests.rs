//! The daily Auto-tune: new Modern elevators start on it, the 05:00 pass
//! writes only the rows from the proposal, the flag saves and loads, a save
//! with it is stamped 12, and undo survives a re-tune (owner and party,
//! 2026-11-17).

use serde_json::json;

use super::{AUTO_TUNE_HOUR, AUTO_TUNE_SAVE_VERSION};
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::load::deserialize;
use crate::schedule::{HeldBack, Schedule};
use crate::schedule_authoring::tests::{tower, warm_ring, TOP};
use crate::sim::Simulation;

/// The hours [`warm_ring`] samples, so a day reads as measured.
fn warm_sampled() -> Vec<bool> {
    (0..24).map(|h| (8..14).contains(&h)).collect()
}

/// Seed shaft `id`'s rings: `weekday` and `weekend` loads over the warm
/// hours, or a cold (unsampled) day for `None`.
fn seed(sim: &mut Simulation, id: i64, weekday: Option<f64>, weekend: Option<f64>) {
    let day = |load: Option<f64>| match load {
        Some(l) => (warm_ring(l), warm_sampled()),
        None => (vec![0.0; 24], vec![false; 24]),
    };
    let ((wd, wds), (we, wes)) = (day(weekday), day(weekend));
    let doc = json!({
        "util": [],
        "hourly": [[id, { "weekday": wd, "weekend": we,
                          "weekdaySampled": wds, "weekendSampled": wes }]],
    });
    sim.seed_telemetry(&doc).expect("a telemetry document");
}

fn schedule(sim: &Simulation, id: i64) -> Schedule {
    let t = sim.tower.get_transport(id).unwrap();
    t.schedule.clone().expect("a schedule")
}

/// Move the clock to `hour` on the same day.
fn at_hour(sim: &mut Simulation, hour: i64) {
    let day = sim.clock.day() as f64;
    sim.clock.minutes = day * 1440.0 + hour as f64 * 60.0;
}

/// A hand-set schedule with Auto on: every hour at 8 cars, homes, door time
/// and waiting response the player chose.
fn hand_set_auto(sim: &mut Simulation, id: i64) {
    let raw = json!({
        "activeCars": { "weekday": vec![8; 24], "weekend": vec![8; 24] },
        "waitingCarResponse": 5,
        "standardFloorDeparture": 30,
        "homeFloors": [1, 6],
        "autoTune": true,
    });
    assert!(sim.tower.set_schedule(id, &raw));
}

#[test]
fn a_new_modern_elevator_starts_on_auto_and_nothing_else_does() {
    let (sim, id) = tower(GameMode::Modern, 8);
    let s = schedule(&sim, id);
    assert!(s.auto_tune);
    assert_eq!(s, Schedule::auto_only(), "Auto alone, every car every hour");
    assert!(!s.is_empty(), "an Auto schedule with no rows is kept");
    let (classic, cid) = tower(GameMode::Classic, 8);
    assert!(classic.tower.get_transport(cid).unwrap().schedule.is_none());
    let (mut sim, _) = tower(GameMode::Modern, 8);
    assert!(sim.build_transport(Kind::Stairs, 10, 1, 2).ok);
    let stairs = sim.tower.transports.iter().find(|t| t.kind == Kind::Stairs);
    assert!(
        stairs.unwrap().schedule.is_none(),
        "stairs keep no schedule"
    );
}

#[test]
fn the_morning_pass_writes_the_rows_and_keeps_the_players_settings() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    hand_set_auto(&mut sim, id);
    seed(&mut sim, id, Some(0.5), Some(0.25));
    at_hour(&mut sim, AUTO_TUNE_HOUR);
    sim.retune_auto_schedules();
    let s = schedule(&sim, id);
    // The measured hours (8 to 13) cut to the fewest cars their load leaves
    // short of full: half of 8 cars' load is 4 cars' worth, which 4 cars
    // would run full, so 5; a quarter is 2 cars' worth, so 3. The hours
    // nobody has measured keep the 8 cars they run.
    let row = |cut: i64| -> Option<Vec<i64>> {
        Some(
            (0..24)
                .map(|h| if (8..14).contains(&h) { cut } else { 8 })
                .collect(),
        )
    };
    assert_eq!(s.weekday, row(5), "half load on 8 cars");
    assert_eq!(s.weekend, row(3), "a quarter on 8 cars");
    assert_eq!(s.home_floors, Some(vec![1, 6]), "staging is the player's");
    assert_eq!(s.waiting_car_response, Some(5.0));
    assert_eq!(s.standard_floor_departure, Some(30.0));
    assert!(s.auto_tune);
}

/// On a tower of twins the pass writes, for every Auto shaft, the rows the
/// dialog's proposal gives against its current schedule, the twins' load
/// included, though it reads every stop list once for the whole pass.
#[test]
fn the_pass_writes_each_shafts_proposal_with_its_twins() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    assert!(sim.build_transport(Kind::ElevatorStandard, 20, 1, TOP).ok);
    assert!(sim.build_transport(Kind::ElevatorStandard, 40, 1, 5).ok);
    let ids: Vec<i64> = sim.tower.transports.iter().map(|t| t.id).collect();
    let warm = |wd: f64, we: f64| {
        json!({ "weekday": warm_ring(wd), "weekend": warm_ring(we),
                "weekdaySampled": warm_sampled(), "weekendSampled": warm_sampled() })
    };
    let loads = [(0.0, 0.0), (0.5, 0.25), (1.0, 1.0)];
    let mut hourly = Vec::new();
    for (&shaft, &(wd, we)) in ids.iter().zip(&loads) {
        sim.tower.set_cars(shaft, 8);
        let raw = json!({ "activeCars": { "weekday": vec![8; 24], "weekend": vec![8; 24] },
                          "autoTune": true });
        assert!(sim.tower.set_schedule(shaft, &raw));
        hourly.push(json!([shaft, warm(wd, we)]));
    }
    let doc = json!({ "util": [], "hourly": hourly });
    sim.seed_telemetry(&doc).expect("a telemetry document");
    let proposed: Vec<_> = ids
        .iter()
        .map(|&shaft| {
            let draft = schedule(&sim, shaft);
            let p = sim.auto_tune_proposal(shaft, Some(&draft), false);
            let p = p.proposal.expect("a warm shaft");
            (p.weekday, p.weekend)
        })
        .collect();
    at_hour(&mut sim, AUTO_TUNE_HOUR);
    sim.retune_auto_schedules();
    for (&shaft, (weekday, weekend)) in ids.iter().zip(&proposed) {
        let s = schedule(&sim, shaft);
        assert_eq!(&s.weekday, weekday, "shaft {shaft} weekday");
        assert_eq!(&s.weekend, weekend, "shaft {shaft} weekend");
    }
    let idle = schedule(&sim, id);
    assert_eq!(idle.weekday.unwrap()[9], 5, "its twin's half load");
}

#[test]
fn the_pass_runs_at_five_only_and_from_the_hourly_pass() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    hand_set_auto(&mut sim, id);
    seed(&mut sim, id, Some(0.5), Some(0.5));
    for hour in (0..24).filter(|&h| h != AUTO_TUNE_HOUR) {
        at_hour(&mut sim, hour);
        sim.retune_auto_schedules();
        assert_eq!(schedule(&sim, id).weekday, Some(vec![8; 24]), "{hour}:00");
    }
    at_hour(&mut sim, AUTO_TUNE_HOUR);
    sim.on_hour();
    assert_eq!(schedule(&sim, id).weekday.unwrap()[9], 5, "the 05:00 pass");
}

#[test]
fn a_cold_day_keeps_its_row() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    hand_set_auto(&mut sim, id);
    seed(&mut sim, id, Some(0.5), None);
    at_hour(&mut sim, AUTO_TUNE_HOUR);
    sim.retune_auto_schedules();
    let s = schedule(&sim, id);
    assert_eq!(s.weekday.unwrap()[9], 5);
    assert_eq!(s.weekend, Some(vec![8; 24]), "nothing measured, row kept");
}

#[test]
fn a_shaft_off_auto_and_a_classic_tower_are_left_alone() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    let mut raw = json!({ "activeCars": { "weekday": vec![8; 24] } });
    assert!(sim.tower.set_schedule(id, &raw));
    seed(&mut sim, id, Some(0.5), Some(0.5));
    at_hour(&mut sim, AUTO_TUNE_HOUR);
    sim.retune_auto_schedules();
    assert_eq!(schedule(&sim, id).weekday, Some(vec![8; 24]), "hand-set");
    assert!(!schedule(&sim, id).auto_tune);

    let (mut classic, cid) = tower(GameMode::Classic, 8);
    raw["autoTune"] = json!(true);
    assert!(classic.tower.set_schedule(cid, &raw));
    assert!(!schedule(&classic, cid).auto_tune, "Classic drops the flag");
    // A hand-edited save could still carry it; the pass ignores Classic.
    classic.tower.transports[0]
        .schedule
        .as_mut()
        .unwrap()
        .auto_tune = true;
    seed(&mut classic, cid, Some(0.5), Some(0.5));
    at_hour(&mut classic, AUTO_TUNE_HOUR);
    classic.retune_auto_schedules();
    assert_eq!(schedule(&classic, cid).weekday, Some(vec![8; 24]));
}

#[test]
fn the_pass_clears_held_hours() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    hand_set_auto(&mut sim, id);
    sim.tower.transports[0].schedule.as_mut().unwrap().held_back = Some(HeldBack {
        weekday: vec![3],
        weekend: vec![],
    });
    seed(&mut sim, id, Some(0.5), Some(0.5));
    at_hour(&mut sim, AUTO_TUNE_HOUR);
    sim.retune_auto_schedules();
    assert_eq!(schedule(&sim, id).held_back, None);
}

#[test]
fn the_flag_saves_loads_and_stamps_version_12() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    hand_set_auto(&mut sim, id);
    let save = sim.serialize();
    assert_eq!(save["version"], AUTO_TUNE_SAVE_VERSION);
    assert_eq!(save["transports"][0]["schedule"]["autoTune"], true);
    let back = deserialize(&save).unwrap();
    assert_eq!(schedule(&back, id), schedule(&sim, id));
    assert_eq!(back.serialize(), save);

    // A save from before the flag: the same schedule with no `autoTune`.
    let mut old = save.clone();
    old["version"] = json!(11);
    old.as_object_mut().unwrap().remove("elevatorLoad");
    old["transports"][0]["schedule"]
        .as_object_mut()
        .unwrap()
        .remove("autoTune");
    let loaded = deserialize(&old).unwrap();
    assert!(!schedule(&loaded, id).auto_tune, "an old save loads off");
    assert_eq!(loaded.serialize(), old, "and saves back byte for byte");
}

/// Every committed tower, saved by builds before Auto existed, loads with
/// no shaft on Auto and writes the same version it was read at.
#[test]
fn committed_towers_load_with_auto_off() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut seen = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("vctower") {
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        let save = crate::load::decode_vctower(&text).unwrap();
        let sim = deserialize(&save).unwrap();
        assert!(!sim.tower.runs_an_auto_schedule(), "{}", path.display());
        let written = sim.serialize();
        assert!(!written.to_string().contains("autoTune"));
        assert!(written["version"].as_i64() < Some(AUTO_TUNE_SAVE_VERSION));
        seen += 1;
    }
    assert!(seen > 0, "no committed tower under {dir}");
}

/// The re-tune is not a gesture, and an older step on the shaft still
/// applies after it.
#[test]
fn undo_survives_a_morning_re_tune() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    sim.begin_undo_journal("Edit");
    hand_set_auto(&mut sim, id);
    let step = sim.end_undo_journal().expect("the edit is a step");
    seed(&mut sim, id, Some(0.5), Some(0.5));
    at_hour(&mut sim, AUTO_TUNE_HOUR);
    sim.retune_auto_schedules();
    assert_eq!(schedule(&sim, id).weekday.unwrap()[9], 5);
    sim.apply_undo_step(&step).expect("the step still applies");
    assert_eq!(schedule(&sim, id), Schedule::auto_only());
}

/// Saving at 04:59 and loading plays the morning the same as not saving.
#[test]
fn a_save_before_the_pass_plays_it_the_same() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    hand_set_auto(&mut sim, id);
    let before_the_pass = 1440.0 + (AUTO_TUNE_HOUR * 60 - 1) as f64;
    while sim.clock.minutes < before_the_pass {
        sim.tick((before_the_pass - sim.clock.minutes).min(2.0));
    }
    seed(&mut sim, id, Some(0.5), Some(0.5));
    let mut loaded = deserialize(&sim.serialize()).unwrap();
    for _ in 0..3 {
        sim.tick(1.0);
        loaded.tick(1.0);
    }
    assert_eq!(schedule(&sim, id).weekday.unwrap()[9], 5, "the pass ran");
    assert_eq!(loaded.save_text(), sim.save_text());
}

/// Pre-registered (party, 2026-11-17): on a steady tower, the daily loop
/// settles. Over 21 days no hour of either row changes more than once in
/// the last 7.
#[test]
fn a_steady_tower_settles() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    for f in 2..=TOP {
        for x in (LOT_WIDTH / 2 - 60..LOT_WIDTH / 2 - 4).step_by(9) {
            assert!(sim.build(Kind::Office, f, x).ok, "office at {f},{x}");
        }
    }
    let mut rows: Vec<Schedule> = Vec::new();
    for _ in 0..21 {
        let day = sim.clock.day();
        while sim.clock.day() == day {
            sim.tick(2.0);
        }
        rows.push(schedule(&sim, id));
    }
    let last = &rows[14..];
    for h in 0..24 {
        for weekend in [false, true] {
            let at = |s: &Schedule| {
                let row = if weekend { &s.weekend } else { &s.weekday };
                row.as_ref().map(|r| r[h])
            };
            let changes = last.windows(2).filter(|w| at(&w[0]) != at(&w[1])).count();
            assert!(
                changes <= 1,
                "hour {h} weekend {weekend}: {changes} changes"
            );
        }
    }
    assert!(rows[20].weekday.is_some(), "the pass tuned the weekday row");
}

/// Run every morning, a cut hour must not swing back and forth: an hour cut
/// so its cars run full measures at least 0.9 of each and gains a car the
/// next morning, then measures what it carries. For every load from none to
/// the whole fleet, 30 mornings of the telemetry's 0.3 blend, with each day
/// measuring no more than the cars running carry, settle on one count whose
/// cars have room.
#[test]
fn a_cut_hour_never_swings_back_and_forth() {
    for tenths in 0..=80 {
        let riders = tenths as f64 / 10.0;
        let (mut sim, id) = tower(GameMode::Modern, 8);
        hand_set_auto(&mut sim, id);
        let mut ring = riders / 8.0;
        let mut counts = Vec::new();
        for _ in 0..30 {
            let running = schedule(&sim, id).weekday.unwrap()[9] as f64;
            ring = 0.3 * riders.min(running) / 8.0 + 0.7 * ring;
            seed(&mut sim, id, Some(ring), None);
            at_hour(&mut sim, AUTO_TUNE_HOUR);
            sim.retune_auto_schedules();
            counts.push(schedule(&sim, id).weekday.unwrap()[9]);
        }
        let settled = counts[29];
        assert!(
            counts[10..].iter().all(|&n| n == settled),
            "{riders} cars' worth: {counts:?}"
        );
        assert!(
            // The blend lands a hair either side of an exact 0.9.
            settled == 8 || riders / (settled as f64) < 0.9 + 1e-9,
            "{riders}: {settled} cars run full"
        );
    }
}

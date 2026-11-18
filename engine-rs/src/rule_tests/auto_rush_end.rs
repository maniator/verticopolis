//! Auto re-tune and the last busy hour of a rush (#2466). The sample at the
//! top of each hour is filed under the hour that just ended, so 7 AM reads
//! the 8:00 crowd. Read alone, that rule gave the last hour of an evening
//! rush the thinned crowd after it, and the 5 AM re-tune gave that hour too
//! few cars. Each hour now reads the larger crowd of its two ends, and a
//! save keeps the start of the hour under way, so a reload tunes as a
//! continuous run does.
use crate::clock::GameMode;
use crate::crowd::line_count::Line;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::schedule::{Schedule, SCHEDULE_HOURS};
use crate::sim::Simulation;

use super::{shaft, strip_tower};

const TOP: i64 = 15;
const CARS: i64 = 8;

/// A Modern tower with one Auto shaft over floors 1 to `TOP`, `CARS` cars
/// and rows that run one car every hour.
fn auto_shaft() -> (Simulation, i64) {
    let mut sim = strip_tower(5, GameMode::Modern, 20, TOP);
    let id = shaft(&mut sim, Kind::ElevatorStandard, 4, 1, TOP);
    assert!(sim.tower.set_cars(id, CARS));
    let t = sim
        .tower
        .transports
        .iter_mut()
        .find(|t| t.id == id)
        .unwrap();
    t.schedule = Some(Schedule {
        weekday: Some(vec![1; SCHEDULE_HOURS]),
        weekend: Some(vec![1; SCHEDULE_HOURS]),
        auto_tune: true,
        ..Schedule::default()
    });
    (sim, id)
}

/// Stand three carloads in line at the lobby, or clear the line.
fn line_at_lobby(sim: &mut Simulation, id: i64, busy: bool) {
    if busy {
        let riders = 3 * Kind::ElevatorStandard.car_capacity() as i64;
        let line = Line {
            riders,
            oldest: 0.0,
        };
        sim.crowd.shaft_lines.insert((id, 1), line);
    } else {
        sim.crowd.shaft_lines.remove(&(id, 1));
    }
}

/// The sample at `hour`:00 of day 0 (a weekday), with the line there when
/// `busy` says so.
fn sample_at(sim: &mut Simulation, id: i64, hour: usize, busy: bool) {
    line_at_lobby(sim, id, busy);
    sim.clock.minutes = hour as f64 * 60.0;
    sim.sample_elevator_util();
}

/// Samples the weekday's 24 hours with the line standing at the snapshots
/// `busy` names, then runs the next morning's re-tune. Returns the weekday
/// ring and the row the re-tune writes.
fn retuned_after(
    sim: &mut Simulation,
    id: i64,
    busy: impl Fn(usize) -> bool,
) -> (Vec<f64>, Vec<i64>) {
    for hour in 0..SCHEDULE_HOURS {
        sample_at(sim, id, hour, busy(hour));
    }
    sim.clock.minutes = (24 + crate::schedule_auto::AUTO_TUNE_HOUR) as f64 * 60.0;
    sim.retune_auto_schedules();
    let ring = sim.telemetry.hourly[&id].weekday.clone();
    let t = sim.tower.get_transport(id).unwrap();
    (ring, t.schedule.as_ref().unwrap().weekday.clone().unwrap())
}

#[test]
fn a_rush_that_ends_on_the_hour_keeps_its_last_busy_hour() {
    let (mut sim, id) = auto_shaft();
    // Busy from 5 to 7 PM: the snapshots at 17:00 and 18:00 see the line,
    // and the one at 19:00 is taken after it has gone.
    let (ring, row) = retuned_after(&mut sim, id, |h| (17..19).contains(&h));
    assert!(ring[18] > 0.0, "6 PM reads its own start: {ring:?}");
    assert_eq!(ring[19], 0.0, "7 PM is quiet at both ends: {ring:?}");
    assert!(
        row[18] >= 4,
        "three carloads need four cars at 6 PM: {row:?}"
    );
    assert!(
        row[19] < row[18],
        "the quiet hour after needs fewer: {row:?}"
    );
}

#[test]
fn a_rush_that_starts_on_the_hour_still_counts_in_the_hour_before() {
    let (mut sim, id) = auto_shaft();
    // The 8:00 snapshot sees the morning line, which built up after 7:00.
    let (ring, row) = retuned_after(&mut sim, id, |h| h == 8);
    assert!(ring[7] > 0.0, "7 AM reads the 8:00 crowd: {ring:?}");
    assert!(row[7] >= 4, "{row:?}");
    assert_eq!(ring[6], 0.0, "{ring:?}");
}

#[test]
fn a_reload_mid_hour_samples_as_a_continuous_run() {
    let (mut run, id) = auto_shaft();
    for hour in 0..=18 {
        sample_at(&mut run, id, hour, (17..19).contains(&hour));
    }
    let mut reloaded = deserialize(&run.serialize()).expect("the save loads");
    assert_eq!(
        reloaded.telemetry.hour_start, run.telemetry.hour_start,
        "the save keeps the hour's start"
    );
    sample_at(&mut run, id, 19, false);
    sample_at(&mut reloaded, id, 19, false);
    assert_eq!(reloaded.telemetry.hourly[&id], run.telemetry.hourly[&id]);
    assert!(run.telemetry.hourly[&id].weekday[18] > 0.0);
}

#[test]
fn a_save_from_before_the_hour_start_reads_the_hours_end_alone() {
    let (mut sim, id) = auto_shaft();
    sample_at(&mut sim, id, 18, true);
    let mut save = sim.serialize();
    let entry = &mut save["elevatorLoad"][0][1];
    assert!(
        entry.as_object_mut().unwrap().remove("hourStart").is_some(),
        "{entry}"
    );
    let mut old = deserialize(&save).expect("an older save loads");
    assert!(old.telemetry.hour_start.is_empty());
    sample_at(&mut old, id, 19, false);
    assert_eq!(
        old.telemetry.hourly[&id].weekday[18], 0.0,
        "as the game that saved it read 6 PM"
    );
}

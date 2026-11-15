//! Modern office workers who come in by the Metro step off a real train
//! (`crowd::metro_train::hold_for_train`): a worker whose minute comes while
//! no train stands at the station is held for the next one, and the station
//! is saved on the booking, so a reload while workers wait plays on the same.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load_stream::load_save_text;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::office_commute::{occupants, visible};
use super::{at_time, room, LEFT};

/// A worker who comes in by the Metro steps off a train: nobody appears on
/// the platform while no train stands there. A worker whose minute comes
/// between trains waits for the next one, and the Metro still brings its
/// share of the morning's workers.
#[test]
fn a_worker_coming_by_metro_steps_off_a_train() {
    use crate::crowd::metro_train::train_in_at;
    let (mut sim, offices) = metro_office_tower();
    let station = sim.tower.metro_stations().next().unwrap().id;
    let mut seen: std::collections::HashSet<i64> = sim.crowd.people.iter().map(|p| p.id).collect();
    let mut by_metro = 0;
    for _ in 0..4 * 60 {
        let before = sim.clock.minute_of_day();
        sim.tick(1.0);
        let after = sim.clock.minute_of_day();
        let train_in =
            train_in_at(&sim.tower, before, station) || train_in_at(&sim.tower, after, station);
        for p in &sim.crowd.people {
            if seen.insert(p.id) && p.commuter && p.from_metro {
                by_metro += 1;
                assert!(train_in, "worker {} came off no train at {after}", p.id);
            }
        }
    }
    assert!(by_metro > 0, "some workers come by the Metro");
    assert!(visible(&sim, &offices) > 0, "the workers reach their desks");
}

/// A Modern tower with a served Metro station and two rented offices on
/// floor 2, at 6 AM on a Monday.
fn metro_office_tower() -> (Simulation, Vec<i64>) {
    let mut sim = super::metro_shoppers::metro_tower(GameMode::Modern, true);
    let offices = [LEFT + 10, LEFT + 40]
        .iter()
        .map(|&x| room(&mut sim, Kind::Office, 2, x, UnitState::Occupied))
        .collect();
    at_time(&mut sim, 0, 6);
    (sim, offices)
}

/// A worker held for the next train is saved with the station they wait
/// for, so a tower saved (as text or as a binary file) while workers wait
/// plays on as it would have.
#[test]
fn a_reload_while_workers_wait_for_a_train_plays_on_as_it_would_have() {
    use crate::load::encode_simulation_vctower_binary;
    use crate::load_stream::load_vctower_bytes;
    let (mut sim, offices) = metro_office_tower();
    let held = |sim: &Simulation| {
        sim.crowd
            .shifts
            .iter()
            .filter(|s| s.station.is_some())
            .count()
    };
    let mut minutes = 0;
    while held(&sim) == 0 {
        sim.tick(1.0);
        minutes += 1;
        assert!(minutes < 4 * 60, "some worker waits for a train");
    }
    let mut from_text = load_save_text(sim.save_text().as_bytes()).unwrap();
    let file = encode_simulation_vctower_binary(&sim, "test", 0.0).unwrap();
    let mut from_file = load_vctower_bytes(&file, None).unwrap();
    for loaded in [&from_text, &from_file] {
        assert_eq!(loaded.crowd.shifts, sim.crowd.shifts);
    }
    for _ in 0..90 {
        sim.tick(1.0);
        from_text.tick(1.0);
        from_file.tick(1.0);
    }
    for loaded in [&from_text, &from_file] {
        assert_eq!(loaded.crowd.view(), sim.crowd.view());
        assert_eq!(loaded.crowd.desks, sim.crowd.desks);
        for &id in &offices {
            assert_eq!(occupants(loaded, id), occupants(&sim, id));
        }
    }
}

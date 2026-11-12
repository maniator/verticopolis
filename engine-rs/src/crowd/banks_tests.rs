//! `shaft_banks`: which shafts are interchangeable for a leg, and what the
//! table costs to build after an edit (A18 in #1158, PR #1977).

use super::shaft_banks;
use crate::clock::GameMode;
use crate::crowd::Crowd;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower_index::work_counts::LANDING_SEGS_CALLS;

const TOP: i64 = 12;

/// A lobby on floor 1, floor tiles on floors 2 to `TOP` (x 100 to 199),
/// and two standard elevators from the lobby to the top floor.
fn two_shaft_tower() -> (Simulation, Vec<i64>) {
    let mut sim = Simulation::new_game(5, GameMode::Classic);
    sim.money = 1e12;
    for x in 100..200 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=TOP {
        for x in 100..200 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    let mut ids = Vec::new();
    for x in [120, 150] {
        let placed = sim.tower.place_transport(Kind::ElevatorStandard, x, 1, TOP);
        assert!(placed.ok, "{:?}", placed.reason);
        ids.push(sim.tower.transports.last().unwrap().id);
    }
    ids.sort();
    (sim, ids)
}

fn total_stops(sim: &Simulation) -> usize {
    sim.tower
        .transports
        .iter()
        .map(|t| sim.tower.stops_of(t).len())
        .sum()
}

fn landing_calls_for(build: impl FnOnce()) -> usize {
    LANDING_SEGS_CALLS.with(|n| n.set(0));
    build();
    LANDING_SEGS_CALLS.with(|n| n.get())
}

#[test]
fn two_shafts_over_the_same_floors_share_every_bank() {
    let (sim, ids) = two_shaft_tower();
    let mut crowd = Crowd::new(1);
    let stops = sim.tower.stops_of(&sim.tower.transports[0]).len();
    assert!(stops >= 2, "the shaft serves {stops} stops");
    let banks = shaft_banks(&mut crowd, &sim.tower);
    // One key per ordered pair of distinct stops, and both shafts in each.
    assert_eq!(banks.len(), stops * (stops - 1));
    for (key, bank) in banks {
        assert_eq!(key.0, Kind::ElevatorStandard);
        assert_ne!(key.1, key.2, "a leg never starts and ends on one landing");
        assert_eq!(bank, &ids, "{key:?}");
    }
}

#[test]
fn the_bank_table_reads_each_landing_once_per_stop() {
    let (mut sim, _) = two_shaft_tower();
    let mut crowd = Crowd::new(1);
    let stops = total_stops(&sim);
    // The pair loop is O(stops^2); the landing reads must stay O(stops),
    // or every edit on a tall tower pays them per pair again.
    let first = landing_calls_for(|| {
        shaft_banks(&mut crowd, &sim.tower);
    });
    assert_eq!(first, stops);
    // Cached on the revision: a second read builds nothing.
    let again = landing_calls_for(|| {
        shaft_banks(&mut crowd, &sim.tower);
    });
    assert_eq!(again, 0);
    // An edit rebuilds the table, at the same cost.
    assert!(sim.tower.place(Kind::Office, 5, 170).ok);
    let rebuilt = landing_calls_for(|| {
        shaft_banks(&mut crowd, &sim.tower);
    });
    assert_eq!(rebuilt, total_stops(&sim));
}

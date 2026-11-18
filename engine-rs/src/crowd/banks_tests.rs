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
    let entries = banks.entries();
    assert_eq!(entries.len(), stops * (stops - 1));
    for (key, bank) in entries {
        assert_eq!(key.0, Kind::ElevatorStandard);
        assert_ne!(key.1, key.2, "a leg never starts and ends on one landing");
        assert_eq!(bank, &ids[..], "{key:?}");
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

/// The two-shaft tower with eight cars in each shaft, the first one's
/// weekday schedule cut to one car all day.
fn one_shaft_cut_to_one_car() -> (Simulation, Vec<i64>) {
    let (mut sim, ids) = two_shaft_tower();
    for t in sim.tower.transports.iter_mut() {
        t.cars = 8;
        t.car_positions = vec![1.0; 8];
        t.car_dir = vec![0; 8];
    }
    let one_car = serde_json::json!({ "activeCars": { "weekday": vec![1; 24] } });
    assert!(sim.tower.set_schedule(ids[0], &one_car));
    (sim, ids)
}

/// How many of `n` routes from the lobby to the top floor ride `id`.
fn rides_on(crowd: &mut Crowd, sim: &Simulation, id: i64, n: usize) -> usize {
    (0..n)
        .filter(|_| {
            let r = crowd.route(&sim.tower, 1, TOP, Some(130.0), Some(130.0));
            r.expect("a route").shafts == vec![id]
        })
        .count()
}

/// A shaft its schedule has cut to one car takes a one-car share of the
/// riders, not half of them, so its line does not grow while the eight
/// cars of the shaft beside it run near empty (the 3.12.0 report: hundreds
/// queued at a one-car express). Off its schedule's hours it takes half.
#[test]
fn twin_shafts_share_riders_by_the_cars_they_run() {
    let (sim, ids) = one_shaft_cut_to_one_car();
    let mut crowd = Crowd::new(3);
    crowd.hour = Some(12);
    crowd.weekend = false;
    let n = 1800;
    let cut = rides_on(&mut crowd, &sim, ids[0], n) as f64 / n as f64;
    // One car in nine.
    assert!(
        (cut - 1.0 / 9.0).abs() < 0.03,
        "the one-car shaft took {cut:.3}"
    );
    // The weekend has no row, so both run all eight cars.
    crowd.weekend = true;
    let even = rides_on(&mut crowd, &sim, ids[0], n) as f64 / n as f64;
    assert!((even - 0.5).abs() < 0.05, "the weekend split was {even:.3}");
}

/// Shafts running alike draw exactly as the even split always has: one
/// draw per leg, the same index.
#[test]
fn twin_shafts_running_alike_draw_as_before() {
    let (sim, ids) = two_shaft_tower();
    let mut crowd = Crowd::new(9);
    crowd.hour = Some(12);
    let mut twin = Crowd::new(9);
    for _ in 0..200 {
        let r = crowd
            .route(&sim.tower, 1, TOP, Some(130.0), Some(130.0))
            .unwrap();
        let expected = ids[twin.rng.int(0, 1) as usize];
        assert_eq!(r.shafts, vec![expected]);
    }
}

/// A shaft on Auto takes its whole fleet's share, whatever its row or the
/// cars the dispatch parked: Modern sends every car out once anyone waits,
/// so a row of one car beside an eight-car twin splits the riders evenly.
/// Sized by its parked cars, it took a one-car share, nobody waited at its
/// stops, and its cars never came out (split-tower 32).
#[test]
fn an_auto_shaft_shares_riders_by_its_whole_fleet() {
    let (mut sim, ids) = one_shaft_cut_to_one_car();
    if let Some(s) = sim.tower.transports.iter_mut().find(|t| t.id == ids[0]) {
        s.schedule.as_mut().expect("the row set above").auto_tune = true;
    }
    let mut crowd = Crowd::new(3);
    crowd.hour = Some(12);
    crowd.weekend = false;
    let n = 1800;
    let all = rides_on(&mut crowd, &sim, ids[0], n) as f64 / n as f64;
    assert!((all - 0.5).abs() < 0.05, "the Auto shaft took {all:.3}");
    // Every car parked: the shaft still takes an even share.
    crowd.closed_cars = (0..8).map(|car| (ids[0], car)).collect();
    let parked = rides_on(&mut crowd, &sim, ids[0], n) as f64 / n as f64;
    assert!(
        (parked - 0.5).abs() < 0.05,
        "the parked Auto shaft took {parked:.3}"
    );
}

//! Auto-tune for a shaft riders avoid: it reads its twins' load, and an
//! hour reads the load over the cars in service (owner, 2026-11-17).

use serde_json::json;

use super::tests::{tower, warm_ring, TOP};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// Sampled hours for a day's ring: the warm-up hours of [`warm_ring`].
fn warm_sampled() -> Vec<bool> {
    (0..24).map(|h| (8..14).contains(&h)).collect()
}

/// Modern riders route around a shaft cut to one car, so its own reading
/// falls with each cut and never wins the cars back. Auto-tune reads its
/// twins instead, the shafts of its kind stopping at every floor it does
/// (owner, 2026-11-17).
#[test]
fn an_avoided_shaft_tunes_to_its_twins_load() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    assert!(sim.build_transport(Kind::ElevatorStandard, 20, 1, TOP).ok);
    assert!(sim.build_transport(Kind::ElevatorStandard, 40, 1, 5).ok);
    let other = |sim: &Simulation, top: i64| {
        let t = sim
            .tower
            .transports
            .iter()
            .find(|t| t.id != id && t.top == top);
        t.unwrap().id
    };
    let (twin, short) = (other(&sim, TOP), other(&sim, 5));
    assert!(sim.tower.set_cars(twin, 8));
    let day = |weekday: Vec<f64>, weekend: Vec<f64>| {
        json!({ "weekday": weekday, "weekend": weekend,
                "weekdaySampled": warm_sampled(), "weekendSampled": warm_sampled() })
    };
    let doc = json!({
        "util": [],
        "hourly": [
            [id, day(warm_ring(0.0), warm_ring(0.0))],
            [twin, day(warm_ring(0.5), warm_ring(0.0))],
            [short, day(warm_ring(1.0), warm_ring(1.0))],
        ],
    });
    sim.seed_telemetry(&doc).expect("a telemetry document");
    let p = sim.auto_tune_proposal(id, None, false).proposal.unwrap();
    assert_eq!(p.weekday.unwrap()[9], 5, "the twin's half load, with room");
    assert_eq!(
        p.weekend.unwrap()[9],
        1,
        "a day nobody rode either shaft, and the short shaft is no twin"
    );
    let busy = sim.auto_tune_proposal(twin, None, false).proposal.unwrap();
    assert_eq!(busy.weekday.unwrap()[9], 5, "a busier shaft keeps its own");
}

/// Tunes a `cars`-car shaft `times` times from `on` cars running, against
/// `riders` cars' worth of riders: each tune samples what the cars it runs
/// can carry (a full car reads its capacity, no more) and runs the row it
/// proposes. Returns every tune's cars.
fn tune_repeatedly(riders: f64, cars: i64, mut on: i64, times: usize) -> Vec<i64> {
    (0..times)
        .map(|_| {
            let measured = riders.min(on as f64) / cars as f64;
            on = super::tuned_row(&[measured], cars)[0];
            on
        })
        .collect()
}

/// Tune after tune, the row settles and stays: from a full fleet on the
/// first tune, and from one car within one car per tune, with the settled
/// row carrying its riders with room.
#[test]
fn auto_tune_settles_on_a_row() {
    let cars = 8;
    for tenths in 0..=80 {
        let riders = tenths as f64 / 10.0;
        for start in [cars, 1] {
            let rows = tune_repeatedly(riders, cars, start, 10);
            let last = rows[9];
            assert!(
                rows[7..].iter().all(|&n| n == last),
                "{riders} cars' worth from {start}: {rows:?}"
            );
            assert!(
                last == cars || riders / (last as f64) < super::SATURATED,
                "{riders}: {last} cars run full"
            );
            if start == cars {
                assert_eq!(rows[0], last, "{riders}: settled on the first tune");
            }
            let mut prev = start;
            for &n in &rows {
                assert!(
                    n <= prev.max(1) + 1 || start == cars,
                    "{riders}: one car a tune"
                );
                prev = n;
            }
        }
    }
}

/// An hour cut to one car that ran full is proposed a second car, where
/// proposing its rounded load kept it at one car for good.
#[test]
fn a_full_one_car_hour_wins_a_car() {
    assert_eq!(super::tuned_row(&[1.0 / 8.0], 8)[0], 2);
    assert_eq!(super::tuned_row(&[0.5 / 8.0], 8)[0], 1);
    assert_eq!(super::tuned_row(&[0.0], 8)[0], 1);
}

/// A twin is a shaft of the same kind stopping at every floor the shaft
/// does: a taller one counts, a shorter one does not, and another kind on
/// the same floors does not. The morning pass reads them from floor sets
/// built once for the whole pass.
#[test]
fn twins_are_the_same_kind_stopping_at_every_floor() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    assert!(sim.build_transport(Kind::ElevatorStandard, 20, 1, TOP).ok);
    assert!(sim.build_transport(Kind::ElevatorStandard, 40, 1, 5).ok);
    assert!(sim.build_transport(Kind::ElevatorService, 60, 1, TOP).ok);
    let ids: Vec<i64> = sim.tower.transports.iter().map(|t| t.id).collect();
    let [_, tall, short, service] = ids[..] else {
        panic!("four shafts, got {ids:?}");
    };
    let stops = sim.elevator_stop_sets();
    let twins = |id: i64| sim.twins_of(sim.tower.transport_index(id).unwrap(), &stops);
    assert_eq!(twins(id), vec![tall], "the short shaft misses floors");
    assert_eq!(twins(short), vec![id, tall], "both tall ones cover it");
    assert!(twins(service).is_empty(), "no other service elevator");
}

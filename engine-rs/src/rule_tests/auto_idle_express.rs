//! The owner's split tower 32 (Modern, 5 stars, about 8,900 people) lifts
//! its parking commuters out of B1 to B7 on five express elevators, all on
//! Auto. On 4.13.2 the morning rush stood 1,400 people in the basement
//! lines while the three expresses up to floor 75 ran one or two cars and
//! carried almost nobody: the router priced each shaft by the cars it had
//! running, so a shaft Auto had parked down to one car looked slow, nobody
//! queued for it, and with nobody in line its parked cars never came out.
//! An Auto shaft is now priced by its whole fleet, which it sends out for
//! the first rider in line.
use crate::clock::GameMode;
use crate::crowd::PState;
use crate::load::{decode_vctower_bytes, deserialize};
use crate::sim::Simulation;

/// The five expresses that serve the basements, all on Auto.
const EXPRESSES: [i64; 5] = [7648, 9280, 19336, 22508, 24797];

fn split_tower_32() -> Simulation {
    let bytes = include_bytes!("../../../conformance/fixtures/regression/split-tower-32.vctower");
    let save = decode_vctower_bytes(bytes).expect("the fixture decodes");
    let sim = deserialize(&save).expect("the fixture loads");
    assert_eq!(sim.tower.mode, GameMode::Modern);
    sim
}

/// The people waiting for an elevator on a basement floor.
fn basement_line(sim: &Simulation) -> usize {
    let in_line = |p: &&crate::crowd::Person| p.floor < 0 && p.state == PState::Waiting;
    sim.crowd.people.iter().filter(in_line).count()
}

#[test]
fn every_auto_express_carries_the_morning_rush() {
    let mut sim = split_tower_32();
    for id in EXPRESSES {
        let t = sim.tower.get_transport(id).expect("the express is there");
        assert!(
            t.schedule.as_ref().is_some_and(|s| s.auto_tune),
            "{id} is on Auto"
        );
    }
    let day = sim.clock.day();
    while sim.clock.day() == day || sim.clock.hour() < 8 {
        sim.tick(1.0);
    }
    let rides_at =
        |sim: &Simulation| EXPRESSES.map(|id| sim.tower.get_transport(id).unwrap().rides);
    let before = rides_at(&sim);
    let mut worst = 0;
    while sim.clock.hour() < 10 {
        sim.tick(1.0);
        worst = worst.max(basement_line(&sim));
    }
    let after = rides_at(&sim);
    let carried: Vec<u64> = (0..EXPRESSES.len()).map(|i| after[i] - before[i]).collect();
    let least = *carried.iter().min().unwrap();
    let most = *carried.iter().max().unwrap();
    assert!(
        least * 3 > most,
        "an express sat idle through the rush: {carried:?}"
    );
    assert!(
        worst < 700,
        "the basement lines reached {worst} ({carried:?} rides)"
    );
}

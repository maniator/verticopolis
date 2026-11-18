//! The owner's split tower 31 (Modern, 5 stars, about 7,900 people) parks
//! its office workers in basements B2 to B5 and lifts them on express
//! elevators that run on Auto. On 4.13 the morning rush stood 600 to 1,400
//! people in the basement lines every weekday and grew day by day: a line
//! too short to fill the cars on shift in one trip never brought the parked
//! cars back, while the few running cars came by full from the floors below.
//! An Auto shaft now runs every car while anyone waits at its stops.
use crate::clock::GameMode;
use crate::crowd::PState;
use crate::load::{decode_vctower_bytes, deserialize};
use crate::sim::Simulation;

fn split_tower_31() -> Simulation {
    let bytes = include_bytes!("../../../conformance/fixtures/regression/split-tower-31.vctower");
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
fn the_next_morning_rush_keeps_the_basement_lines_short() {
    let mut sim = split_tower_31();
    let (day, hour) = (sim.clock.day(), sim.clock.hour());
    assert_eq!(hour, 11, "the save is from late on a weekday morning");
    let at_load = basement_line(&sim);
    assert!(
        at_load > 400,
        "the save's basement lines are there: {at_load}"
    );
    // On to the next weekday morning, through the 5 AM re-tune.
    while sim.clock.day() == day || sim.clock.hour() < 7 {
        sim.tick(1.0);
    }
    assert!(!sim.clock.is_weekend(), "the next morning is a weekday");
    let mut worst = 0;
    while sim.clock.hour() < 12 {
        sim.tick(1.0);
        worst = worst.max(basement_line(&sim));
    }
    assert!(worst < 500, "the basement lines reached {worst}");
}

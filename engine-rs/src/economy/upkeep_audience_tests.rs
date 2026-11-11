//! The daily rollover's set audiences (#1500): a party hall counts 50 and a
//! new theatre 120 from the first night it is open, a room still being built
//! counts nothing, and a theatre's count falls as its film ages (#1932).

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

fn put(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let r = sim.build(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor},{x}: {:?}", r.reason);
    sim.tower.unit_at(floor, x).expect("a unit there").id
}

/// Floors 2 and 3 hold a hall and a theatre, open, and a second hall still
/// being built. Returns the tower and the three ids.
fn venues() -> (Simulation, [i64; 3]) {
    let mut sim = Simulation::new_game(5, GameMode::Classic);
    sim.money = 1.0e9;
    sim.star = 5;
    for x in 150..260 {
        put(&mut sim, Kind::Lobby, 1, x);
    }
    for fl in 2..=3 {
        for x in 151..259 {
            put(&mut sim, Kind::Floor, fl, x);
        }
    }
    let hall = put(&mut sim, Kind::PartyHall, 2, 152);
    let theatre = put(&mut sim, Kind::Cinema, 2, 180);
    let building = put(&mut sim, Kind::PartyHall, 2, 220);
    for id in [hall, theatre] {
        let (u, at) = sim.tower.marked_by_id(id).unwrap();
        u.set_state(at, UnitState::Empty);
    }
    assert_eq!(
        sim.tower.get_unit(building).unwrap().state,
        UnitState::Construction
    );
    (sim, [hall, theatre, building])
}

fn count(sim: &Simulation, id: i64) -> Option<u8> {
    sim.tower.get_unit(id).unwrap().visitors_yest
}

#[test]
fn an_open_hall_and_theatre_count_their_audience_after_their_first_night() {
    let (mut sim, [hall, theatre, building]) = venues();
    assert_eq!([count(&sim, hall), count(&sim, theatre)], [None, None]);
    sim.roll_over_retail_day();
    assert_eq!(count(&sim, hall), Some(50));
    assert_eq!(count(&sim, theatre), Some(120));
    assert_eq!(
        count(&sim, building),
        None,
        "a room being built counts nothing"
    );
    // The next night changes neither.
    sim.roll_over_retail_day();
    assert_eq!(
        [count(&sim, hall), count(&sim, theatre)],
        [Some(50), Some(120)]
    );
}

#[test]
fn a_theatre_counts_120_for_six_mornings_then_80_for_three_then_40() {
    let (mut sim, [hall, theatre, _]) = venues();
    let mut counts = vec![];
    for _ in 0..12 {
        sim.roll_over_retail_day();
        counts.push(count(&sim, theatre).unwrap());
    }
    assert_eq!(
        counts,
        [120, 120, 120, 120, 120, 120, 80, 80, 80, 40, 40, 40]
    );
    let film_days = sim.tower.get_unit(theatre).unwrap().extras().film_days;
    assert_eq!(film_days, Some(12));
    assert_eq!(count(&sim, hall), Some(50), "a hall's count does not age");
}

#[test]
fn a_theatre_counts_the_draw_of_the_film_age_it_loaded_with() {
    let (mut sim, [_, theatre, _]) = venues();
    let (u, _) = sim.tower.marked_by_id(theatre).unwrap();
    u.extras_mut().film_days = Some(7);
    sim.roll_over_retail_day();
    assert_eq!(count(&sim, theatre), Some(80));
    let film_days = sim.tower.get_unit(theatre).unwrap().extras().film_days;
    assert_eq!(film_days, Some(8));
}

#[test]
fn an_open_theatre_adds_its_audience_to_the_population() {
    let (mut sim, [_, theatre, _]) = venues();
    let (u, at) = sim.tower.marked_by_id(theatre).unwrap();
    u.set_state(at, UnitState::Occupied);
    let before = sim.tower.total_population();
    sim.roll_over_retail_day();
    assert_eq!(sim.tower.total_population() - before, 120);
}

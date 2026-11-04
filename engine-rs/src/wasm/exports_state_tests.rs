use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A lobby, one floor and an office on it.
fn with_office() -> (Engine, i64) {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    for x in 150..200 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let r = e.sim.tower.place(Kind::Office, 2, 160);
    assert!(r.ok);
    (e, r.unit_id.unwrap())
}

#[test]
fn set_clock_moves_the_minutes_and_keeps_the_calendar() {
    let (mut e, _) = with_office();
    let calendar = format!("{:?}", e.sim.clock.calendar);
    assert!(e.set_clock((24.0 + 18.0) * 60.0));
    assert_eq!(e.sim.clock.minutes, 42.0 * 60.0);
    assert_eq!(format!("{:?}", e.sim.clock.calendar), calendar);
    // A literal 0 is the founding 07:00, as the clock's own constructor reads it.
    assert!(e.set_clock(0.0));
    assert_eq!(e.sim.clock.minutes, 7.0 * 60.0);
    for bad in [f64::NAN, f64::INFINITY, -1.0, MAX_TOOL_CLOCK_MINUTES + 1.0] {
        assert!(!e.set_clock(bad), "{bad}");
        assert_eq!(e.sim.clock.minutes, 7.0 * 60.0, "{bad} changed the clock");
    }
}

#[test]
fn set_unit_state_writes_through_the_marked_setters() {
    let (mut e, id) = with_office();
    let before = e.sim.tower.view.marks.position();
    assert!(e.set_unit_state(id as f64, "occupied", Some(6.0)));
    let unit = e.sim.tower.get_unit(id).unwrap();
    assert_eq!((unit.state, unit.occupants), (UnitState::Occupied, 6));
    // The frame's mark log saw the change, so the views that key on it move.
    assert!(e.sim.tower.view.marks.position() > before);
    // Without occupants only the state changes.
    assert!(e.set_unit_state(id as f64, "moving_in", None));
    let unit = e.sim.tower.get_unit(id).unwrap();
    assert_eq!((unit.state, unit.occupants), (UnitState::MovingIn, 6));
}

#[test]
fn set_unit_state_refuses_what_it_cannot_write() {
    let (mut e, id) = with_office();
    let state = e.sim.tower.get_unit(id).unwrap().state;
    let marks = e.sim.tower.view.marks.position();
    for (unit, name, occupants) in [
        (id as f64, "open", None),
        (id as f64, "construction", None),
        (id as f64, "fire", None),
        (9999.0, "occupied", None),
        (-1.0, "occupied", None),
        (f64::NAN, "occupied", None),
        (f64::INFINITY, "occupied", None),
        (id as f64 + 0.5, "occupied", None),
        (id as f64, "occupied", Some(-1.0)),
        (id as f64, "occupied", Some(2.5)),
        (id as f64, "occupied", Some(f64::NAN)),
        (id as f64, "occupied", Some(f64::INFINITY)),
        (id as f64, "occupied", Some(1e300)),
    ] {
        assert!(
            !e.set_unit_state(unit, name, occupants),
            "{unit} {name} {occupants:?}"
        );
    }
    let unit = e.sim.tower.get_unit(id).unwrap();
    assert_eq!((unit.state, unit.occupants), (state, 0));
    // A refusal writes nothing, so it marks nothing either.
    assert_eq!(e.sim.tower.view.marks.position(), marks);
    // The largest count a JavaScript number holds exactly is still taken.
    assert!(e.set_unit_state(id as f64, "occupied", Some(MAX_TOOL_OCCUPANTS)));
}

#[test]
fn every_state_name_reads_back_as_its_state() {
    for state in [
        UnitState::Construction,
        UnitState::Empty,
        UnitState::Occupied,
        UnitState::MovingIn,
        UnitState::Vacating,
        UnitState::Asleep,
        UnitState::Dirty,
        UnitState::Infested,
        UnitState::Fire,
        UnitState::Gutted,
    ] {
        assert_eq!(UnitState::from_name(state.as_str()), Some(state));
    }
    assert_eq!(UnitState::from_name("Occupied"), None);
}

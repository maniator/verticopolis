//! Which shaft edits report `capacity_changed`: one event for each edit
//! that changes a shaft's cars or span, none for a no-op, a refusal or a
//! bare tower edit. The paid edits' events and refusals are also
//! `charges_tests::paid_edits_report_capacity_changed_and_refusals_report_nothing`.
//! The TypeScript suite's two reporter-ownership cases have no Rust
//! counterpart: the event queue is the simulation's own field, and a tower
//! holds no reporter to carry between simulations.
use crate::charges::ExtendEnd;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::sim::Simulation;

type Edit = fn(&mut Simulation, i64);

fn tower() -> (Simulation, i64) {
    let mut sim = Simulation::new_game(51, GameMode::Classic);
    sim.money = 1e9;
    for x in 170..200 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=4 {
        for x in 170..200 {
            assert!(sim.build(Kind::Floor, floor, x).ok);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, 172, 1, 2).ok);
    let id = sim.tower.transport_at(1, 172).unwrap().id;
    (sim, id)
}

fn limit() -> i64 {
    Kind::ElevatorStandard.max_cars()
}

fn broke(sim: &mut Simulation, edit: Edit, id: i64) {
    let money = sim.money;
    sim.money = 0.0;
    edit(sim, id);
    sim.money = money;
}

#[test]
fn each_capacity_edit_reports_once_and_a_no_op_or_refusal_reports_nothing() {
    let none: Edit = |_, _| {};
    let cases: [(&str, usize, Edit, Edit); 18] = [
        (
            "set_cars to a new count",
            1,
            |s, id| _ = s.set_cars(id, 2),
            none,
        ),
        (
            "set_cars to the same count",
            0,
            |s, id| {
                let n = s.tower.get_transport(id).unwrap().cars;
                s.set_cars(id, n);
            },
            none,
        ),
        (
            "set_cars past the limit",
            1,
            |s, id| _ = s.set_cars(id, limit() + 1),
            none,
        ),
        (
            "set_cars past the limit at it",
            0,
            |s, id| _ = s.set_cars(id, limit() + 1),
            |s, id| _ = s.set_cars(id, limit()),
        ),
        (
            "set_cars on a missing shaft",
            0,
            |s, _| _ = s.set_cars(987_654, 2),
            none,
        ),
        (
            "resize up a floor",
            1,
            |s, id| _ = s.resize_transport(id, 1, 3),
            none,
        ),
        (
            "resize to the same span",
            0,
            |s, id| _ = s.resize_transport(id, 1, 2),
            none,
        ),
        (
            "resize onto missing floors",
            0,
            |s, id| _ = s.resize_transport(id, 1, 40),
            none,
        ),
        ("add_car", 1, |s, id| _ = s.add_car(id), none),
        (
            "add_car while broke",
            0,
            |s, id| broke(s, |s, id| _ = s.add_car(id), id),
            none,
        ),
        (
            "add_car at the limit",
            0,
            |s, id| _ = s.add_car(id),
            |s, id| _ = s.set_cars(id, limit()),
        ),
        (
            "remove_car",
            1,
            |s, id| _ = s.remove_car(id),
            |s, id| _ = s.set_cars(id, 3),
        ),
        (
            "remove_car on the last car",
            0,
            |s, id| _ = s.remove_car(id),
            none,
        ),
        (
            "extend up a floor",
            1,
            |s, id| _ = s.extend_transport(id, ExtendEnd::Up, 3),
            none,
        ),
        (
            "extend to where it reaches",
            0,
            |s, id| _ = s.extend_transport(id, ExtendEnd::Up, 2),
            none,
        ),
        (
            "extend while broke",
            0,
            |s, id| broke(s, |s, id| _ = s.extend_transport(id, ExtendEnd::Up, 3), id),
            none,
        ),
        (
            "bare tower set_cars",
            0,
            |s, id| _ = s.tower.set_cars(id, 2),
            none,
        ),
        (
            "bare tower resize",
            0,
            |s, id| _ = s.tower.resize_transport(id, 1, 3),
            none,
        ),
    ];
    for (what, expected, run, setup) in cases {
        let (mut sim, id) = tower();
        setup(&mut sim, id);
        sim.gameplay.drain();
        run(&mut sim, id);
        let got: Vec<_> = sim
            .gameplay
            .drain()
            .into_iter()
            .filter(|e| matches!(e, GameplayEvent::CapacityChanged { .. }))
            .collect();
        assert_eq!(got.len(), expected, "{what}");
        for e in got {
            assert_eq!(
                e,
                GameplayEvent::CapacityChanged {
                    kind: Kind::ElevatorStandard
                },
                "{what}"
            );
        }
    }
}

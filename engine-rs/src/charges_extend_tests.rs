//! An extend drag stops just short of a floor that refuses and says why
//! (#1847), instead of refusing the whole step.
use crate::charges::{ExtendEnd, TRANSPORT_FLOOR_COST};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

const LOBBY_FIRST: &str = "Build the lobby on floor 1 first, then extend through it.";
/// The shaft's column, west of the ground lobby, so nothing stands on floor 1
/// over it.
const X: i64 = 92;

/// A Modern tower with a lobby on 100..160, basements 0 to -6 under it and
/// under the shaft's column, and a standard elevator on -5..-3 at [`X`].
fn basement_shaft() -> (Simulation, i64) {
    let mut sim = Simulation::new_game(7, GameMode::Modern);
    sim.money = 1e9;
    for x in 100..160 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in (-6..=0).rev() {
        for x in (X..160).rev() {
            let laid = sim.tower.place(Kind::Floor, floor, x);
            assert!(laid.ok, "floor {floor} x {x}: {:?}", laid.reason);
        }
    }
    let built = sim.build_transport(Kind::ElevatorStandard, X, -5, -3);
    assert!(built.ok, "{:?}", built.reason);
    let id = sim.tower.transport_at(-4, X).unwrap().id;
    (sim, id)
}

fn span(sim: &Simulation, id: i64) -> (i64, i64) {
    let t = sim.tower.get_transport(id).unwrap();
    (t.bottom, t.top)
}

#[test]
fn a_drag_past_an_unbuilt_lobby_stops_on_the_floor_below_and_says_why() {
    let (mut sim, id) = basement_shaft();
    sim.begin_extend(id);
    let money = sim.money;
    let step = sim.extend_transport(id, ExtendEnd::Up, 2);
    assert!(step.charge.ok, "the floors short of the lobby are laid");
    assert_eq!(step.charge.reason.as_deref(), Some(LOBBY_FIRST));
    assert_eq!((step.bottom, step.top, step.added), (-5, 0, 3));
    assert_eq!(span(&sim, id), (-5, 0));
    assert_eq!(sim.money, money - 3.0 * TRANSPORT_FLOOR_COST);
    let again = sim.extend_transport(id, ExtendEnd::Up, 2);
    assert!(!again.charge.ok, "no floor is left short of the lobby");
    assert_eq!(again.charge.reason.as_deref(), Some(LOBBY_FIRST));
    assert_eq!((again.bottom, again.top, again.added), (-5, 0, 0));
    assert_eq!(sim.money, money - 3.0 * TRANSPORT_FLOOR_COST);
    sim.end_extend();
}

#[test]
fn a_drag_that_stops_for_money_before_the_lobby_says_nothing_of_it() {
    let (mut sim, id) = basement_shaft();
    sim.money = TRANSPORT_FLOOR_COST;
    let step = sim.extend_transport(id, ExtendEnd::Up, 2);
    assert!(step.charge.ok);
    assert_eq!(
        step.charge.reason, None,
        "the lobby is not where it stopped"
    );
    assert_eq!((step.top, step.added), (-2, 1));
}

#[test]
fn a_built_lobby_lets_the_drag_through() {
    let (mut sim, id) = basement_shaft();
    for x in X..100 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    let step = sim.extend_transport(id, ExtendEnd::Up, 2);
    assert!(step.charge.ok, "{:?}", step.charge.reason);
    assert_eq!(step.charge.reason, None);
    assert_eq!(span(&sim, id), (-5, 2));
}

#[test]
fn a_drag_down_stops_short_of_another_shaft() {
    let (mut sim, id) = basement_shaft();
    let other = sim.build_transport(Kind::ElevatorStandard, X, -1, 0);
    assert!(other.ok, "{:?}", other.reason);
    // The first shaft's bottom dragged down past nothing reaches the lowest
    // basement.
    let down = sim.extend_transport(id, ExtendEnd::Down, -6);
    assert_eq!((down.charge.ok, down.charge.reason), (true, None));
    assert_eq!(span(&sim, id), (-6, -3));
    // The second shaft's bottom dragged down meets the first shaft on -3, so
    // it stops on -2 and says why; one more step down is refused outright.
    let other = sim.tower.transport_at(-1, X).unwrap().id;
    let short = sim.extend_transport(other, ExtendEnd::Down, -5);
    assert!(short.charge.ok);
    let overlap = Some(crate::facilities::SHAFT_OVERLAP);
    assert_eq!(short.charge.reason.as_deref(), overlap);
    assert_eq!(span(&sim, other), (-2, 0));
    let blocked = sim.extend_transport(other, ExtendEnd::Down, -5);
    assert!(!blocked.charge.ok);
    assert_eq!(blocked.charge.reason.as_deref(), overlap);
    assert_eq!(span(&sim, other), (-2, 0));
}

#[test]
fn a_drag_far_off_the_lot_is_refused_without_walking_to_it() {
    // A target past the lot is refused by the range check before any floor
    // is walked, so the port's widest number answers at once.
    let (mut sim, id) = basement_shaft();
    let far = (1_i64 << 53) - 1;
    for (end, target) in [(ExtendEnd::Up, far), (ExtendEnd::Down, -far)] {
        let r = sim.extend_transport(id, end, target);
        assert!(!r.charge.ok, "{end:?} to {target}");
        assert_eq!(
            r.charge.reason.as_deref(),
            Some("Outside the buildable range.")
        );
        assert_eq!(span(&sim, id), (-5, -3));
    }
}

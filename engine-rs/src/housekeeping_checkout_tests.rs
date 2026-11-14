//! The morning checkout's latch of yesterday's housekeeping shift.

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

#[test]
fn the_morning_checkout_latches_yesterdays_shift() {
    let mut sim = Simulation::new_game(9, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    for x in 170..200 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
        assert!(sim.build(Kind::Floor, 2, x).ok);
    }
    assert!(sim.build(Kind::HotelSingle, 2, 172).ok);
    assert!(sim.build(Kind::HotelSingle, 2, 180).ok);
    assert_eq!(sim.housekeeping.yesterday, None);
    for u in sim
        .tower
        .units
        .iter_mut()
        .filter(|u| u.kind == Kind::HotelSingle)
    {
        u.state = UnitState::Dirty;
    }
    sim.housekeeping.cleaned_today = 3;
    sim.housekeeping_before_checkout();
    assert_eq!(sim.housekeeping.yesterday, Some((3, 2)));
    assert_eq!(sim.housekeeping.cleaned_today, 0);
    // A quiet day latches the zero result too.
    for u in sim
        .tower
        .units
        .iter_mut()
        .filter(|u| u.kind == Kind::HotelSingle)
    {
        u.state = UnitState::Empty;
    }
    sim.housekeeping_before_checkout();
    assert_eq!(sim.housekeeping.yesterday, Some((0, 0)));
}

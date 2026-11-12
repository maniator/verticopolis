//! Helpers for the port report tests: a spot the move-in gate holds, for the
//! coverage of the won't-lease section, and the slot comparison.

use super::Engine;
use crate::facilities::Kind;

/// In a Modern tower, empties an office on a served floor and prices it at
/// the top of its band, a rent no fresh tenant stays for, so the tower
/// carries a spot the move-in gate holds. (A nightclub no longer holds one.)
pub(super) fn hold_an_overpriced_office(e: &mut Engine) {
    if !e.sim.mode.is_modern() {
        return;
    }
    let top = crate::econ::rent_config(Kind::Office).unwrap().max;
    let id = e
        .sim
        .tower
        .room_units()
        .find(|u| {
            u.kind == Kind::Office
                && u.state == crate::tower::UnitState::Occupied
                && !u.no_rate
                && e.sim.tower.is_floor_served(u.floor)
        })
        .map(|u| u.id)
        .expect("an office on a served floor");
    let (u, at) = e.sim.tower.marked_by_id(id).unwrap();
    u.set_state(at, crate::tower::UnitState::Empty);
    u.rent = Some(top);
}

/// A slot's value against the JSON getter's, NaN matching NaN.
pub(super) fn same(got: f64, want: f64, what: &str) {
    assert!(
        got == want || (got.is_nan() && want.is_nan()),
        "{what}: {got} vs {want}"
    );
}

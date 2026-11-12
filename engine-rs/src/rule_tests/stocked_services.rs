//! A test tower's recycling and parking, for fixtures that sit at three
//! stars or more for reasons of their own: from three stars both services
//! are demanded, and a tower short of either has its ratings held down
//! (`satisfaction::shortfall`).
use crate::facilities::{Kind, LOT_WIDTH};
use crate::sim::Simulation;

/// A recycling center's footprint width.
const CENTER_WIDTH: i64 = 25;
const RAMP_WIDTH: i64 = 16;
const SPACE_WIDTH: i64 = 4;
/// The basement story `stock_services` stands its centers on (they rise
/// one story above it).
const CENTER_FLOOR: i64 = -3;

/// Lays floor tiles across the lot on floors 0 down to `deepest`, top
/// first, since each story hangs from the one above.
pub(crate) fn lay_basement(sim: &mut Simulation, deepest: i64) {
    for floor in (deepest..=0).rev() {
        for x in 0..LOT_WIDTH {
            sim.tower.place(Kind::Floor, floor, x);
        }
    }
}

/// A ramp column at `ramp_x` (under the lobby) on floors 0 down to
/// `deepest`, with a row of spaces either side of each ramp. The basement
/// must be laid. Answers the spaces placed.
pub(crate) fn stock_parking(sim: &mut Simulation, ramp_x: i64, deepest: i64) -> i64 {
    stock_parking_within(sim, ramp_x, deepest, 0, LOT_WIDTH)
}

/// [`stock_parking`] with the spaces kept inside tiles `lo..hi`, for a tower
/// whose basement spans only part of the lot.
pub(crate) fn stock_parking_within(
    sim: &mut Simulation,
    ramp_x: i64,
    deepest: i64,
    lo: i64,
    hi: i64,
) -> i64 {
    let mut spaces = 0;
    for floor in (deepest..=0).rev() {
        let ramp = sim.tower.place(Kind::ParkingRamp, floor, ramp_x);
        assert!(ramp.ok, "ramp on {floor}: {:?}", ramp.reason);
        let right = (ramp_x + RAMP_WIDTH..=hi - SPACE_WIDTH).step_by(SPACE_WIDTH as usize);
        let left = (lo..=ramp_x - SPACE_WIDTH)
            .rev()
            .step_by(SPACE_WIDTH as usize);
        for x in right.chain(left) {
            assert!(
                sim.tower.place(Kind::Parking, floor, x).ok,
                "space {floor}/{x}"
            );
            spaces += 1;
        }
    }
    spaces
}

/// `centers` recycling centers side by side on `floor` (rising one story
/// above it) from tile `x0`. The basement must be laid.
pub(crate) fn stock_recycling(sim: &mut Simulation, floor: i64, x0: i64, centers: i64) {
    for i in 0..centers {
        let placed = sim
            .tower
            .place(Kind::Recycling, floor, x0 + i * CENTER_WIDTH);
        assert!(placed.ok, "center {i}: {:?}", placed.reason);
    }
}

/// Basement floors 0 to -3, a parking ramp under the lobby's middle with a
/// row of spaces either side on floor 0, and `centers` recycling centers on
/// -3. Every piece is placed operational, so the services count at once.
pub(crate) fn stock_services(sim: &mut Simulation, centers: i64) {
    lay_basement(sim, CENTER_FLOOR);
    stock_parking(sim, LOT_WIDTH / 2, 0);
    stock_recycling(sim, CENTER_FLOOR, 0, centers);
}

fn lobby_lot() -> Simulation {
    let mut sim = Simulation::new_game(3, crate::clock::GameMode::Classic);
    sim.money = 1e12;
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    sim
}

#[test]
fn a_stocked_tower_parks_every_space_and_processes_its_trash() {
    let mut sim = lobby_lot();
    stock_services(&mut sim, 2);
    assert_eq!(sim.recycling_centers(), 2);
    assert_eq!(sim.recycling_capacity(), 5_000.0);
    let placed = sim.tower.units_of_kind(Kind::Parking).count() as i64;
    assert!(placed >= 80, "{placed}");
    assert_eq!(sim.tower.functional_parking_spots(), placed);
}

#[test]
fn a_ramp_column_reaches_the_spaces_on_every_parking_story() {
    let mut sim = lobby_lot();
    lay_basement(&mut sim, -2);
    let placed = stock_parking(&mut sim, LOT_WIDTH / 2, -2);
    assert_eq!(
        placed,
        sim.tower.units_of_kind(Kind::Parking).count() as i64
    );
    assert_eq!(sim.tower.functional_parking_spots(), placed);
}

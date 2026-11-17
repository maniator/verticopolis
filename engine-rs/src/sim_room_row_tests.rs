//! A row of rooms (Modern, #646): the dry run names the rooms a drag places
//! and their full price, and the build places exactly those at that price.

use super::*;
use crate::clock::GameMode;

/// A tower in `mode` with a ground lobby and a floor on story 2 over
/// `100..300`, money to spare and every room open.
fn tower(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    sim.star = 5;
    for x in 100..300 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    sim
}

fn office_width() -> i64 {
    Kind::Office.facility().width
}

fn offices_on(sim: &Simulation, floor: i64) -> Vec<i64> {
    let mut xs: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| u.kind == Kind::Office && u.floor == floor)
        .map(|u| u.x)
        .collect();
    xs.sort_unstable();
    xs
}

/// Builds the row and checks it charged what its quote named and placed the
/// quoted rooms.
fn build_as_quoted(
    sim: &mut Simulation,
    kind: Kind,
    floor: i64,
    from: i64,
    to: i64,
) -> RoomRowQuote {
    let quote = sim.quote_room_row(kind, floor, from, to);
    assert!(quote.ok, "{:?}", quote.reason);
    let before = sim.money;
    let r = sim.build_room_row(kind, floor, from, to);
    assert!(r.ok, "{:?}", r.reason);
    assert_eq!(r.placed, quote.rooms.len() as i64);
    assert_eq!(before - sim.money, quote.cost, "the row charges its quote");
    quote
}

#[test]
fn a_drag_places_a_room_at_every_width_up_to_the_pointer() {
    let mut sim = tower(GameMode::Modern);
    let w = office_width();
    // The pointer sits inside the fourth room's span: that room counts.
    let q = build_as_quoted(&mut sim, Kind::Office, 2, 120, 120 + 3 * w + 1);
    assert_eq!(q.rooms, vec![120, 120 + w, 120 + 2 * w, 120 + 3 * w]);
    assert_eq!(
        q.cost,
        4.0 * Kind::Office.facility().cost,
        "the floor is there"
    );
    assert_eq!(offices_on(&sim, 2), q.rooms);
}

#[test]
fn a_drag_to_the_left_places_from_the_press_outward() {
    let mut sim = tower(GameMode::Modern);
    let w = office_width();
    let q = build_as_quoted(&mut sim, Kind::Office, 2, 200, 200 - 2 * w);
    assert_eq!(q.rooms, vec![200, 200 - w, 200 - 2 * w]);
}

#[test]
fn a_press_without_a_drag_places_one_room() {
    let mut sim = tower(GameMode::Modern);
    let q = build_as_quoted(&mut sim, Kind::Office, 2, 150, 150);
    assert_eq!(q.rooms, vec![150]);
}

#[test]
fn the_row_goes_on_past_a_room_already_there() {
    let mut sim = tower(GameMode::Modern);
    let w = office_width();
    assert!(sim.build(Kind::Office, 2, 120 + w + 2).ok);
    let q = build_as_quoted(&mut sim, Kind::Office, 2, 120, 120 + 4 * w);
    // The room that stood in the way pushed the row on by one room's width
    // and the tiles it overlapped.
    assert_eq!(q.rooms, vec![120, 120 + 2 * w + 2, 120 + 3 * w + 2]);
    assert_eq!(offices_on(&sim, 2).len(), 4);
}

#[test]
fn rooms_laying_their_own_floor_and_bridge_price_each_tile_once() {
    // Story 3 holds one floor tile at 100, so a room further out pays for the
    // floor under it and the bridge back to that tile. A room nearer the
    // tower lays floor a further room's bridge also reaches.
    let w = office_width();
    for (from, to) in [(110, 110 + 2 * w), (110 + 2 * w, 110)] {
        let mut sim = tower(GameMode::Modern);
        assert!(sim.tower.place(Kind::Floor, 3, 100).ok);
        let q = build_as_quoted(&mut sim, Kind::Office, 3, from, to);
        assert_eq!(q.rooms.len(), 3);
        let tiles = (110 + 3 * w - 101) as f64;
        let expected = 3.0 * Kind::Office.facility().cost + tiles * Kind::Floor.facility().cost;
        assert_eq!(q.cost, expected, "from {from} to {to}");
    }
}

#[test]
fn a_capped_room_stops_the_row_at_its_cap() {
    let mut sim = tower(GameMode::Modern);
    let cap = crate::facilities::build_cap_in(GameMode::Modern, Kind::Security).unwrap();
    let w = Kind::Security.facility().width;
    for i in 0..cap - 2 {
        assert!(sim.build(Kind::Security, 2, 100 + i * w).ok);
    }
    let from = 100 + cap * w;
    let q = build_as_quoted(&mut sim, Kind::Security, 2, from, from + 5 * w);
    assert_eq!(q.rooms.len(), 2, "two more fit under the cap");
    assert_eq!(sim.tower.cap_headroom(Kind::Security), 0);
    assert!(sim.tower.cap_reason(Kind::Security).is_some());
}

#[test]
fn a_row_the_money_does_not_cover_is_refused_whole() {
    let mut sim = tower(GameMode::Modern);
    let w = office_width();
    sim.money = 2.5 * Kind::Office.facility().cost;
    let q = sim.quote_room_row(Kind::Office, 2, 120, 120 + 2 * w);
    assert!(!q.ok);
    assert_eq!(q.reason.as_deref(), Some("Not enough money."));
    assert_eq!(q.rooms.len(), 3, "the ghost still shows the row");
    assert_eq!(q.cost, 3.0 * Kind::Office.facility().cost);
    let r = sim.build_room_row(Kind::Office, 2, 120, 120 + 2 * w);
    assert!(!r.ok);
    assert_eq!(r.placed, 0);
    assert!(offices_on(&sim, 2).is_empty());
}

#[test]
fn a_row_where_nothing_fits_says_why_the_press_was_refused() {
    let sim = tower(GameMode::Modern);
    // Story 5 stands over open air.
    let q = sim.quote_room_row(Kind::Office, 5, 120, 160);
    assert!(!q.ok);
    assert!(q.rooms.is_empty());
    assert_eq!(q.cost, 0.0);
    assert_eq!(q.reason, sim.can_build(Kind::Office, 5, 120).reason);
}

#[test]
fn classic_places_one_room_per_click() {
    let mut sim = tower(GameMode::Classic);
    let q = sim.quote_room_row(Kind::Office, 2, 120, 160);
    assert_eq!(q.reason.as_deref(), Some(MODERN_ONLY));
    assert!(!sim.build_room_row(Kind::Office, 2, 120, 160).ok);
    assert!(offices_on(&sim, 2).is_empty());
}

#[test]
fn only_rooms_make_rows() {
    let sim = tower(GameMode::Modern);
    for kind in [Kind::Floor, Kind::Lobby, Kind::ElevatorStandard] {
        let q = sim.quote_room_row(kind, 2, 120, 160);
        assert_eq!(q.reason.as_deref(), Some(ROOMS_ONLY), "{kind:?}");
    }
}

#[test]
fn a_pointer_off_the_lot_stops_the_row_at_the_lot_edge() {
    let mut sim = tower(GameMode::Modern);
    for x in 300..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let w = office_width();
    let q = build_as_quoted(&mut sim, Kind::Office, 2, LOT_WIDTH - 2 * w, i64::MAX);
    assert_eq!(q.rooms, vec![LOT_WIDTH - 2 * w, LOT_WIDTH - w]);
}

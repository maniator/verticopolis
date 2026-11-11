//! The pedestrian penalties: W1, a tenant more than 79 tiles from a stair,
//! escalator or passenger elevator wears down (`transportFar`); W2, an
//! office hears commercial rooms within 11 tiles and a guest room or condo
//! hears offices and commercial rooms within 21, through anything but a
//! lobby or open air; W3, a shop or eatery more than 2 floors from a lobby
//! draws less. The noise bands, the lobby and open-air shields are also in
//! `rule_tests::noise_memo`. The graduated lobby distance (#394) is in
//! `rule_tests::lobby_distance`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::satisfaction::{NOISE_CAP, TRANSPORT_FAR_TILES};
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{lay_row, put, seat, unit};

/// A full-width lobby, floors 2..=top and a standard elevator at `shaft_x`
/// serving them, as the TypeScript suite's `servedTower` builds it.
pub(super) fn served(seed: u32, mode: GameMode, top: i64, shaft_x: i64) -> Simulation {
    let mut sim = Simulation::new_game(seed, mode);
    sim.money = 1e12;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    assert!(
        sim.build_transport(Kind::ElevatorStandard, shaft_x, 1, top)
            .ok
    );
    sim
}

/// An occupied, fully satisfied `kind` at `x` on `floor`.
pub(super) fn content(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let id = put(sim, kind, floor, x);
    seat(sim, id, UnitState::Occupied, 1.0);
    id
}

pub(super) fn hours(sim: &mut Simulation, n: usize) {
    for _ in 0..n {
        sim.tick(60.0);
    }
}

fn sat(sim: &Simulation, id: i64) -> f64 {
    unit(sim, id).satisfaction
}

fn transport_gap(sim: &Simulation, id: i64) -> Option<i64> {
    sim.tower.nearest_transport_distance(unit(sim, id))
}

#[test]
fn w1_wears_down_an_office_past_79_tiles_and_leaves_a_near_one_alone() {
    let mut sim = served(4, GameMode::Classic, 2, 3);
    let near = content(&mut sim, Kind::Office, 2, 8);
    let far = content(&mut sim, Kind::Office, 2, 260);
    hours(&mut sim, 8);
    assert!(sat(&sim, far) < sat(&sim, near));
    assert!(sat(&sim, near) > 0.9);
}

#[test]
fn w1_measures_the_horizontal_gap_to_a_passenger_shaft() {
    // The elevator at x 3 is 4 wide, so its right edge is at 7.
    let mut sim = served(1, GameMode::Classic, 2, 3);
    let abut = put(&mut sim, Kind::Office, 2, 7);
    let gap = put(&mut sim, Kind::Office, 2, 107);
    assert_eq!(transport_gap(&sim, abut), Some(0));
    assert_eq!(transport_gap(&sim, gap), Some(100));
    // A staff-only service elevator beside an office does not count.
    sim.star = 2;
    assert!(sim.build_transport(Kind::ElevatorService, 258, 1, 2).ok);
    let far = put(&mut sim, Kind::Office, 2, 260);
    assert_eq!(transport_gap(&sim, far), Some(253));
    let mut bare = Simulation::new_game(1, GameMode::Classic);
    lay_row(&mut bare, Kind::Lobby, 1);
    lay_row(&mut bare, Kind::Floor, 2);
    let lonely = put(&mut bare, Kind::Office, 2, 50);
    assert_eq!(
        transport_gap(&bare, lonely),
        None,
        "no shaft reads as infinitely far"
    );
}

#[test]
fn w1_tolerates_79_tiles_and_bites_at_80() {
    let after_8_hours = |x: i64| {
        let mut sim = served(6, GameMode::Classic, 2, 3);
        let o = content(&mut sim, Kind::Office, 2, x);
        let gap = transport_gap(&sim, o);
        hours(&mut sim, 8);
        (gap, sat(&sim, o))
    };
    let (ok_gap, ok) = after_8_hours(7 + TRANSPORT_FAR_TILES);
    let (over_gap, over) = after_8_hours(8 + TRANSPORT_FAR_TILES);
    assert_eq!((ok_gap, over_gap), (Some(79), Some(80)));
    assert!(ok > 0.9);
    assert!(over < ok);
}

#[test]
fn w1_stops_once_a_shaft_comes_within_reach() {
    let mut sim = served(7, GameMode::Classic, 2, 3);
    let far = content(&mut sim, Kind::Office, 2, 260);
    hours(&mut sim, 6);
    let worn = sat(&sim, far);
    assert!(worn < 1.0);
    assert!(sim.build_transport(Kind::ElevatorStandard, 258, 1, 2).ok);
    hours(&mut sim, 6);
    assert!(sat(&sim, far) > worn);
}

#[test]
fn w1_names_transport_far_when_a_far_office_gives_notice() {
    let mut sim = served(3, GameMode::Classic, 2, 3);
    let far = content(&mut sim, Kind::Office, 2, 260);
    sim.tower.get_unit_mut(far).unwrap().satisfaction = 0.2;
    hours(&mut sim, 24);
    assert_eq!(unit(&sim, far).extras().vacate_reason, Some("transportFar"));
}

#[test]
fn w2_an_office_hears_fast_food_within_11_tiles_and_not_past_them() {
    let mut sim = served(4, GameMode::Classic, 2, 3);
    assert!(sim.build_transport(Kind::ElevatorStandard, 120, 1, 2).ok);
    put(&mut sim, Kind::FastFood, 2, 100);
    let near = content(&mut sim, Kind::Office, 2, 90);
    let control = content(&mut sim, Kind::Office, 2, 130);
    for id in [near, control] {
        assert!(
            transport_gap(&sim, id).unwrap() <= TRANSPORT_FAR_TILES,
            "no W1"
        );
    }
    hours(&mut sim, 8);
    assert!(sat(&sim, near) < sat(&sim, control));
    assert!(sat(&sim, control) > 0.9);
}

#[test]
fn w1_and_w2_together_wear_an_office_down_once_per_hour() {
    let after_4_hours = |with_food: bool| {
        let mut sim = served(8, GameMode::Classic, 2, 3);
        if with_food {
            put(&mut sim, Kind::FastFood, 2, 100);
        }
        let o = content(&mut sim, Kind::Office, 2, 90);
        assert!(transport_gap(&sim, o).unwrap() > TRANSPORT_FAR_TILES);
        hours(&mut sim, 4);
        sat(&sim, o)
    };
    let both = after_4_hours(true);
    let only_far = after_4_hours(false);
    assert!(only_far < 1.0, "the far walk alone wears it down");
    assert!((both - only_far).abs() < 1e-5, "{both} vs {only_far}");
}

#[test]
fn w2_caps_a_guest_room_against_an_office_wall() {
    let mut sim = served(5, GameMode::Classic, 2, 3);
    put(&mut sim, Kind::Office, 2, 50);
    let room = put(&mut sim, Kind::HotelDouble, 2, 59);
    seat(&mut sim, room, UnitState::Asleep, 1.0);
    hours(&mut sim, 4);
    assert!(sat(&sim, room) <= NOISE_CAP);
}

#[test]
fn w2_noise_carries_through_a_quiet_room_in_the_gap() {
    let mut sim = served(41, GameMode::Classic, 2, 3);
    assert!(sim.build_transport(Kind::ElevatorStandard, 120, 1, 2).ok);
    put(&mut sim, Kind::FastFood, 2, 100);
    put(&mut sim, Kind::Office, 2, 91);
    let far = content(&mut sim, Kind::Office, 2, 82);
    let control = content(&mut sim, Kind::Office, 2, 130);
    for id in [far, control] {
        assert!(
            transport_gap(&sim, id).unwrap() <= TRANSPORT_FAR_TILES,
            "no W1"
        );
    }
    hours(&mut sim, 8);
    assert!(
        sat(&sim, far) < sat(&sim, control),
        "heard through the middle office"
    );
    assert!(sat(&sim, control) > 0.9);
}

#[test]
fn w3_lobby_distance_anchors_on_the_ground_and_shrinks_with_a_sky_lobby() {
    let mut sim = served(1, GameMode::Classic, 14, 3);
    for x in 0..crate::facilities::LOT_WIDTH {
        assert!(sim.tower.place(Kind::Floor, 15, x).ok);
    }
    assert_eq!(sim.tower.nearest_lobby_floor_distance(3), 2);
    assert_eq!(sim.tower.nearest_lobby_floor_distance(8), 7);
    let tile = sim.tower.unit_at(15, 3).unwrap().id;
    assert!(sim.tower.remove_unit(tile).is_some());
    put(&mut sim, Kind::Lobby, 15, 3);
    assert_eq!(sim.tower.nearest_lobby_floor_distance(15), 0);
    assert_eq!(sim.tower.nearest_lobby_floor_distance(16), 1);
    assert_eq!(
        sim.tower.nearest_lobby_floor_distance(8),
        7,
        "still nearer the ground"
    );
}

/// A day's takings for `kind` at `x` on `floor` of a tower up to `top`
/// with four occupied offices on floor 2 to draw from; `edit` shapes the
/// tower first.
fn takings(
    kind: Kind,
    (floor, x): (i64, i64),
    top: i64,
    edit: impl FnOnce(&mut Simulation),
) -> f64 {
    let mut sim = served(11, GameMode::Classic, top, 3);
    for i in 0..4 {
        content(&mut sim, Kind::Office, 2, 100 + i * 12);
    }
    edit(&mut sim);
    let v = put(&mut sim, kind, floor, x);
    sim.tower.get_unit_mut(v).unwrap().state = UnitState::Occupied;
    let before = sim.money;
    hours(&mut sim, 24);
    sim.money - before
}

#[test]
fn w3_a_venue_far_from_a_lobby_draws_less_and_a_party_hall_is_exempt() {
    let near = takings(Kind::FastFood, (2, 40), 9, |_| {});
    let far = takings(Kind::FastFood, (8, 40), 9, |_| {});
    assert!(
        far < near,
        "W3 bites a canon commercial venue: {far} vs {near}"
    );
    // A party hall's takings follow its audience, which the floor also
    // moves, so the exemption is read from the predicate the income and the
    // card share: the hall carries no lobby-distance flag at all.
    let mut sim = served(11, GameMode::Classic, 9, 3);
    let food = put(&mut sim, Kind::FastFood, 8, 40);
    let hall = put(&mut sim, Kind::PartyHall, 8, 100);
    let flag = |sim: &mut Simulation, id| {
        let facts = serde_json::to_value(sim.service_diagnostic_facts(id).unwrap()).unwrap();
        facts["commercial"]["lobbyFar"].clone()
    };
    assert_eq!(flag(&mut sim, food), serde_json::json!(true));
    assert!(flag(&mut sim, hall).is_null(), "no flag on a party hall");
}

#[test]
fn w3_a_sky_lobby_within_2_floors_restores_the_draw() {
    let with = |substrate: Kind| {
        takings(Kind::FastFood, (16, 5), 14, |sim| {
            for x in 0..40 {
                put(sim, substrate, 15, x);
            }
            for x in 0..40 {
                put(sim, Kind::Floor, 16, x);
            }
            assert!(sim.build_transport(Kind::ElevatorStandard, 25, 1, 16).ok);
        })
    };
    assert!(with(Kind::Lobby) > with(Kind::Floor));
}

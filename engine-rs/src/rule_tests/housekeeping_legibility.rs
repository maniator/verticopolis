//! Housekeeping legibility (housekeeping-overhaul GDD, epic 3), from the
//! retired `housekeepingLegibility.integration.test.ts`: infestation alerts
//! name their floors (folded into ranges), the cleanliness overlay tells an
//! infested room from an unreached one and shades condos and Modern rentals
//! as not applicable, yesterday's report counts the rooms left over, and a
//! maid steps out of her own station.
use super::{seeded_game, MID};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::housekeeping::INFEST_DAYS;
use crate::panels::heatmap::HeatmapMode;
use crate::sim::Simulation;
use crate::tower::UnitState;

const X0: i64 = MID - 20;
/// A minute of 13:00, inside the maids' working day.
const ONE_PM: f64 = 13.0 * 60.0;

/// Floor 2 over the seeded lobby, served by an elevator, at two stars.
fn base_tower(seed: u32) -> Simulation {
    let mut sim = seeded_game(seed, GameMode::Classic);
    sim.star = 2;
    for x in X0..X0 + 30 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(
        sim.build_transport(Kind::ElevatorStandard, X0 + 26, 1, 2)
            .ok
    );
    sim
}

/// Floor 3 laid but reached by no staff transport.
fn add_floor_3(sim: &mut Simulation) {
    for x in X0..X0 + 30 {
        assert!(sim.tower.place(Kind::Floor, 3, x).ok);
    }
}

fn hotel_room(sim: &mut Simulation, floor: i64, x: i64, state: UnitState) -> i64 {
    let r = sim.tower.place(Kind::HotelSingle, floor, x);
    assert!(r.ok, "{:?}", r.reason);
    let id = r.unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = state;
    if state == UnitState::Infested {
        u.occupants = 0;
    }
    id
}

fn logged(sim: &Simulation, needle: &str) -> bool {
    sim.log.iter().any(|e| e.text.contains(needle))
}

#[test]
fn the_escalation_alert_names_its_floors_as_a_range() {
    let mut sim = base_tower(51);
    add_floor_3(&mut sim);
    let a = hotel_room(&mut sim, 2, X0, UnitState::Dirty);
    let b = hotel_room(&mut sim, 3, X0, UnitState::Dirty);
    for id in [a, b] {
        sim.tower.get_unit_mut(id).unwrap().extras_mut().dirty_days = Some(INFEST_DAYS - 1);
    }
    sim.hotel_checkout();
    for id in [a, b] {
        assert_eq!(sim.tower.get_unit(id).unwrap().state, UnitState::Infested);
    }
    assert!(
        logged(&sim, "on floor(s) 2\u{2013}3"),
        "consecutive floors fold into a range"
    );
}

#[test]
fn the_spread_alert_names_the_floor_it_crept_into() {
    let mut sim = base_tower(52);
    hotel_room(&mut sim, 2, X0, UnitState::Infested);
    let neighbor = hotel_room(&mut sim, 2, X0 + 4, UnitState::Empty);
    sim.hotel_checkout();
    assert_eq!(
        sim.tower.get_unit(neighbor).unwrap().state,
        UnitState::Dirty
    );
    let spread = sim
        .log
        .iter()
        .any(|e| e.text.contains("Cockroaches spread") && e.text.contains("on floor(s) 2."));
    assert!(spread);
}

#[test]
fn the_cleanliness_overlay_tells_infested_from_unreached_and_shades_condos_na() {
    let mut sim = base_tower(53);
    add_floor_3(&mut sim);
    assert!(sim.tower.place(Kind::Housekeeping, 2, X0 + 8).ok);
    hotel_room(&mut sim, 2, X0, UnitState::Infested);
    hotel_room(&mut sim, 3, X0, UnitState::Empty);
    assert!(sim.tower.place(Kind::Condo, 3, X0 + 6).ok);
    let cells = sim.floor_heatmap(HeatmapMode::Cleanliness);
    let cell = |floor: i64, x: i64| {
        cells
            .iter()
            .find(|c| c.floor == floor && c.min_x == x)
            .unwrap_or_else(|| panic!("a cell at {floor},{x}"))
    };
    assert_eq!(cell(2, X0).tint, Some("infested"));
    let unreached = cell(3, X0);
    assert_eq!(unreached.tint, None, "on the red ramp");
    assert_eq!(unreached.severity, 1.0);
    assert_eq!(cell(3, X0 + 6).tint, Some("na"));
}

#[test]
fn the_cleanliness_overlay_shades_modern_rentals_na_like_condos() {
    let mut sim = seeded_game(55, GameMode::Modern);
    for x in X0..X0 + 30 {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let studio_x = X0;
    let apartment_x = X0 + 15;
    assert!(sim.tower.place(Kind::RentalStudio, 2, studio_x).ok);
    assert!(sim.tower.place(Kind::RentalApartment, 2, apartment_x).ok);
    let cells = sim.floor_heatmap(HeatmapMode::Cleanliness);
    for x in [studio_x, apartment_x] {
        let c = cells
            .iter()
            .find(|c| c.floor == 2 && c.min_x == x)
            .unwrap_or_else(|| panic!("a cell for the rental at {x}"));
        assert_eq!(
            c.tint,
            Some("na"),
            "a rental no crew cleans is not applicable"
        );
        assert_eq!(c.severity, 0.0, "never on the red ramp");
    }
}

#[test]
fn the_report_is_empty_before_the_first_checkout_and_counts_the_leftover_after() {
    let mut sim = base_tower(54);
    assert_eq!(sim.housekeeping.yesterday, None);
    // No crew: the dirty room survives the shift.
    hotel_room(&mut sim, 2, X0, UnitState::Dirty);
    for _ in 0..25 {
        sim.tick(60.0);
    }
    let (_, leftover) = sim
        .housekeeping
        .yesterday
        .expect("a report after the checkout");
    assert!(leftover >= 1);
    assert!(logged(&sim, "went unserved"));
}

#[test]
fn a_dispatched_maid_steps_out_of_her_station() {
    let mut sim = base_tower(55);
    hotel_room(&mut sim, 2, X0, UnitState::Dirty);
    let hk = sim.tower.place(Kind::Housekeeping, 2, X0 + 8);
    assert!(hk.ok);
    let crew = sim.tower.get_unit(hk.unit_id.unwrap()).unwrap().clone();
    sim.seat_crews();
    sim.clock.minutes = ONE_PM;
    sim.dispatch_housekeepers();
    let maid = sim.crowd.people.iter().find(|p| p.clean_unit_id.is_some());
    let maid = maid.expect("a maid on the room");
    assert_eq!(maid.x, (crew.x as f64) + (crew.width as f64) / 2.0);
}

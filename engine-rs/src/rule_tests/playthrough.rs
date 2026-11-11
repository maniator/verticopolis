//! The full playthrough to the TOWER win: a full lot holds the 15,000
//! occupants, every rung of the star ladder stops at its own missing gate,
//! the Wedding Hall's VIP crowns a five-star tower, and no hall or a sold
//! Metro keeps the win away. The unimpressed VIP below 15,000 (back in five
//! days) is `services::tests::the_vip_crowns_a_finished_tower_and_returns_to_a_short_one`;
//! each four-star gate on its own is `star::tests::four_star_gates_each_pinned`.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH, MAX_FLOOR};
use crate::sim::Simulation;
use crate::star::TOWER_POPULATION;
use crate::tower::UnitState;

/// Office floors that clear 15,000 occupants with a margin.
const WINNING_OFFICE_FLOORS: i64 = 70;
/// Office floors that clear the 10,000 five-star bar but not 15,000.
const SHORT_OFFICE_FLOORS: i64 = 50;
const METRO_FLOOR: i64 = -2;

#[derive(Clone, Copy, PartialEq)]
enum Gate {
    Security,
    Recycling,
    Metro,
}

fn must_place(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> i64 {
    let placed = sim.tower.place(kind, floor, x);
    assert!(placed.ok, "{kind:?} at {floor}/{x}: {:?}", placed.reason);
    placed.unit_id.unwrap()
}

/// Every gate a TOWER needs but the Wedding Hall (and `omit`), with every
/// office occupied and the VIP's suite review already earned.
fn winning_tower(office_floors: i64, omit: Option<Gate>) -> Simulation {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e10;
    for x in 0..LOT_WIDTH {
        must_place(&mut sim, Kind::Lobby, 1, x);
    }
    for floor in (METRO_FLOOR..=0).rev().chain(2..=MAX_FLOOR) {
        for x in 0..LOT_WIDTH {
            must_place(&mut sim, Kind::Floor, floor, x);
        }
    }
    if omit != Some(Gate::Metro) {
        must_place(&mut sim, Kind::Metro, METRO_FLOOR, 0);
    }
    // Floor 2 holds the amenities side by side.
    let mut amenities = vec![Kind::Medical, Kind::HotelSuite, Kind::HotelSuite];
    if omit != Some(Gate::Security) {
        amenities.extend([Kind::Security, Kind::Security]);
    }
    let mut x = 0;
    for kind in amenities {
        let id = must_place(&mut sim, kind, 2, x);
        if kind == Kind::HotelSuite {
            sim.tower.get_unit_mut(id).unwrap().state = UnitState::Asleep;
        }
        x += kind.facility().width;
    }
    let width = Kind::Office.facility().width;
    for floor in 3..3 + office_floors {
        for x in (0..=LOT_WIDTH - width).step_by(width as usize) {
            let id = must_place(&mut sim, Kind::Office, floor, x);
            let office = sim.tower.get_unit_mut(id).unwrap();
            office.state = UnitState::Occupied;
            office.satisfaction = 1.0;
        }
    }
    if omit != Some(Gate::Recycling) {
        let recycling = Kind::Recycling.facility().width;
        let mut x = 40;
        while !sim.recycling_demand_met() {
            must_place(&mut sim, Kind::Recycling, -1, x);
            x += recycling;
        }
    }
    sim.vip_favorable = true;
    sim
}

/// Builds the Wedding Hall on floor 100 and finishes its construction.
fn build_wedding_hall(sim: &mut Simulation) -> bool {
    if !sim.build(Kind::WeddingHall, MAX_FLOOR, LOT_WIDTH / 2).ok {
        return false;
    }
    let hall = sim
        .tower
        .units_of_kind(Kind::WeddingHall)
        .next()
        .unwrap()
        .id;
    sim.tower.get_unit_mut(hall).unwrap().state = UnitState::Empty;
    true
}

/// Jumps past the inspection day the hall booked and runs the inspection.
fn run_vip_inspection(sim: &mut Simulation) {
    sim.clock.advance(10.0 * 1440.0);
    sim.check_vip();
}

fn won(sim: &Simulation) -> bool {
    sim.log.iter().any(|e| e.text.contains("You win"))
}

#[test]
fn the_full_lot_holds_the_tower_population_and_the_vip_crowns_it() {
    let mut sim = winning_tower(WINNING_OFFICE_FLOORS, None);
    sim.evaluate_star();
    assert_eq!(sim.star, 5, "every rung is met at once");
    assert!(sim.rating_population() >= TOWER_POPULATION);
    assert!(build_wedding_hall(&mut sim));
    assert_eq!(sim.vip_visits, 0);
    run_vip_inspection(&mut sim);
    assert_eq!(sim.star, 6);
    assert!(won(&sim));
    assert_eq!(
        sim.vip_visits, 1,
        "the winning inspection is a counted visit"
    );
}

#[test]
fn each_rung_stops_at_its_own_missing_gate() {
    for (omit, cap) in [(Gate::Security, 2), (Gate::Recycling, 3), (Gate::Metro, 4)] {
        let mut sim = winning_tower(WINNING_OFFICE_FLOORS, Some(omit));
        sim.evaluate_star();
        assert_eq!(sim.star, cap);
    }
    let mut no_metro = winning_tower(WINNING_OFFICE_FLOORS, Some(Gate::Metro));
    no_metro.evaluate_star();
    assert!(
        !build_wedding_hall(&mut no_metro),
        "the hall is locked below 5★"
    );
}

#[test]
fn no_wedding_hall_means_no_inspection_and_no_win() {
    let mut sim = winning_tower(WINNING_OFFICE_FLOORS, None);
    sim.evaluate_star();
    assert_eq!(sim.star, 5);
    run_vip_inspection(&mut sim);
    assert_eq!(sim.star, 5);
    assert!(!won(&sim));
}

#[test]
fn an_unimpressed_vip_still_counts_a_visit() {
    let mut sim = winning_tower(SHORT_OFFICE_FLOORS, None);
    sim.evaluate_star();
    assert_eq!(sim.star, 5);
    let pop = sim.rating_population();
    assert!((10_000..TOWER_POPULATION).contains(&pop), "{pop}");
    assert!(build_wedding_hall(&mut sim));
    run_vip_inspection(&mut sim);
    assert_eq!(sim.star, 5);
    assert!(!won(&sim));
    assert_eq!(sim.vip_visits, 1);
}

#[test]
fn selling_the_metro_after_five_stars_blocks_the_win() {
    let mut sim = winning_tower(WINNING_OFFICE_FLOORS, None);
    sim.evaluate_star();
    assert_eq!(sim.star, 5);
    assert!(build_wedding_hall(&mut sim));
    let metro = sim.tower.units_of_kind(Kind::Metro).next().unwrap().id;
    assert!(sim.tower.remove_unit(metro).is_some());
    run_vip_inspection(&mut sim);
    assert!(sim.star < 6);
    assert!(!won(&sim));
}

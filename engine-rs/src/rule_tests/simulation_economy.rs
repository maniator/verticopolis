//! The core simulation suite, part one: price controls, building and
//! selling charges and refusals, star locks, rent and a condo's one sale,
//! the two- and three-star promotions, construction time, the clock, and
//! notices and evictions over access. The other parts are the
//! `simulation_*.rs` files beside this one.
use crate::clock::GameMode;
use crate::econ::{rent_config, rent_of};
use crate::facilities::Kind;
use crate::satisfaction::VACATE_RESCIND;
use crate::sim::{Simulation, STARTING_MONEY};
use crate::tower::UnitState;

use super::{seeded_game, MID};

/// The seeded starter lobby's left edge.
pub(super) const X0: i64 = MID - 20;

/// A seeded game with floor 2 laid over the starter lobby and a shaft to it.
pub(super) fn built_tower(seed: u32) -> Simulation {
    let mut sim = seeded_game(seed, GameMode::Classic);
    for i in 0..40 {
        sim.tower.place(Kind::Floor, 2, X0 + i);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, X0, 1, 2).ok);
    sim
}

pub(super) fn hours(sim: &mut Simulation, n: usize) {
    for _ in 0..n {
        sim.tick(60.0);
    }
}

fn rent_now(sim: &Simulation, id: i64) -> f64 {
    let u = sim.tower.get_unit(id).unwrap();
    rent_of(u.kind, u.rent, u.no_rate)
}

#[test]
fn a_price_steps_and_clamps_within_its_band_or_ladder() {
    let band = rent_config(Kind::Office).unwrap();
    let mut modern = seeded_game(1, GameMode::Modern);
    for i in 0..12 {
        modern.tower.place(Kind::Floor, 2, MID + i);
    }
    assert!(modern.build_transport(Kind::ElevatorStandard, MID, 1, 2).ok);
    let id = modern
        .tower
        .place(Kind::Office, 2, MID + 1)
        .unit_id
        .unwrap();
    assert_eq!(modern.adjust_rent(id, 1), Some(band.default + band.step));
    for _ in 0..50 {
        modern.adjust_rent(id, 1);
    }
    assert_eq!(rent_now(&modern, id), band.max);
    for _ in 0..50 {
        modern.adjust_rent(id, -1);
    }
    assert_eq!(rent_now(&modern, id), band.min);

    let mut classic = seeded_game(1, GameMode::Classic);
    for i in 0..12 {
        classic.tower.place(Kind::Floor, 2, MID + i);
    }
    assert!(
        classic
            .build_transport(Kind::ElevatorStandard, MID, 1, 2)
            .ok
    );
    let id = classic
        .tower
        .place(Kind::Office, 2, MID + 1)
        .unit_id
        .unwrap();
    for _ in 0..50 {
        classic.adjust_rent(id, 1);
    }
    assert_eq!(rent_now(&classic, id), 15_000.0, "High");
    for _ in 0..50 {
        classic.adjust_rent(id, -1);
    }
    assert_eq!(rent_now(&classic, id), 2_000.0, "Very Low");
}

#[test]
fn a_sold_condos_price_is_fixed() {
    let mut sim = seeded_game(1, GameMode::Classic);
    for i in 0..20 {
        sim.tower.place(Kind::Floor, 2, MID + i);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, MID, 1, 2).ok);
    let id = sim.tower.place(Kind::Condo, 2, MID + 1).unit_id.unwrap();
    assert!(sim.adjust_rent(id, 1).is_some());
    sim.tower.get_unit_mut(id).unwrap().ever_occupied = true;
    assert_eq!(sim.adjust_rent(id, 1), None);
}

#[test]
fn an_overpriced_office_loses_satisfaction_against_the_going_rate() {
    let mut sim = built_tower(3);
    assert!(sim.build(Kind::Office, 2, X0).ok);
    assert!(sim.build(Kind::Office, 2, X0 + 10).ok);
    let fair = sim.tower.unit_at(2, X0).unwrap().id;
    let gouged = sim.tower.unit_at(2, X0 + 10).unwrap().id;
    for id in [fair, gouged] {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Occupied;
        u.satisfaction = 1.0;
    }
    sim.tower.get_unit_mut(gouged).unwrap().rent = Some(rent_config(Kind::Office).unwrap().max);
    hours(&mut sim, 8);
    let sat = |id| sim.tower.get_unit(id).unwrap().satisfaction;
    assert!(sat(gouged) < sat(fair));
}

#[test]
fn a_new_game_starts_with_the_founding_money_at_one_star() {
    let sim = seeded_game(1, GameMode::Classic);
    assert_eq!((sim.money, sim.star), (STARTING_MONEY, 1));
}

#[test]
fn building_charges_and_selling_refunds_half() {
    let mut sim = seeded_game(1, GameMode::Classic);
    let before = sim.money;
    assert!(sim.build(Kind::Floor, 2, X0).ok);
    assert_eq!(sim.money, before - 500.0);
    assert!(sim.sell_at(2, X0));
    assert_eq!(sim.money, before - 500.0 + 250.0);
}

#[test]
fn a_room_lays_its_own_floor_and_pays_for_it() {
    let mut sim = seeded_game(7, GameMode::Classic);
    let before = sim.money;
    assert!(sim.build(Kind::Office, 2, X0).ok);
    assert_eq!(sim.tower.unit_at(2, X0).unwrap().kind, Kind::Office);
    assert!(sim.tower.has_structure(2, X0));
    let office = Kind::Office.facility();
    assert_eq!(
        before - sim.money,
        office.cost + office.width as f64 * Kind::Floor.facility().cost
    );
}

#[test]
fn a_floor_holding_up_the_story_above_cannot_be_sold() {
    let mut sim = seeded_game(1, GameMode::Classic);
    assert!(sim.build(Kind::Floor, 2, X0).ok);
    assert!(sim.build(Kind::Floor, 3, X0).ok);
    let before = sim.money;
    assert!(!sim.sell_at(2, X0));
    assert_eq!(sim.money, before);
    assert!(sim.sell_at(3, X0));
    assert!(sim.sell_at(2, X0));
}

#[test]
fn nothing_floats_unsupported_and_nothing_is_built_unpaid_or_locked() {
    let mut sim = seeded_game(7, GameMode::Classic);
    assert!(!sim.build(Kind::Office, 6, 5).ok, "midair");
    for i in 0..30 {
        sim.tower.place(Kind::Floor, 2, X0 + i);
    }
    assert!(sim.build(Kind::Office, 3, X0).ok, "fully on floor 2");
    assert!(
        !sim.can_build(Kind::Office, 3, X0 + 28).ok,
        "hanging off the end"
    );

    let mut poor = seeded_game(1, GameMode::Classic);
    poor.money = 100.0;
    assert!(!poor.build(Kind::Office, 2, X0).ok);
    assert_eq!(poor.money, 100.0);

    let mut locked = seeded_game(1, GameMode::Classic);
    assert!(locked.is_unlocked(Kind::Office));
    assert!(!locked.is_unlocked(Kind::Cinema));
    locked.star = 3;
    assert!(locked.is_unlocked(Kind::Cinema));
}

#[test]
fn offices_fill_over_time_and_pay_rent() {
    let mut sim = built_tower(3);
    for dx in [0, 10, 20] {
        assert!(sim.build(Kind::Office, 2, X0 + dx).ok);
    }
    let after_build = sim.money;
    hours(&mut sim, 24 * 14);
    assert!(sim
        .tower
        .units_of_kind(Kind::Office)
        .any(|u| u.state == UnitState::Occupied));
    assert!(sim.money > after_build);
}

#[test]
fn a_condo_sells_once_for_its_listed_price() {
    let mut sim = built_tower(5);
    assert!(sim.build(Kind::Condo, 2, X0).ok);
    let i = sim
        .tower
        .units
        .iter()
        .position(|u| u.kind == Kind::Condo)
        .unwrap();
    let before = sim.money;
    sim.move_in(i);
    assert_eq!(
        sim.money,
        before + 150_000.0,
        "Classic lists on the Average rung"
    );
    assert!(sim.tower.units[i].ever_occupied);
    let after = sim.money;
    sim.move_in(i);
    assert_eq!(sim.money, after);
}

fn occupied_offices(sim: &mut Simulation, top: i64, count: usize) {
    for floor in 2..=top {
        for i in 0..40 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
    let mut placed = 0;
    'floors: for floor in 2..=top {
        for i in (0..=31).step_by(9) {
            if placed == count {
                break 'floors;
            }
            let r = sim.tower.place(Kind::Office, floor, X0 + i);
            assert!(r.ok, "{:?}", r.reason);
            let id = r.unit_id.unwrap();
            sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
            placed += 1;
        }
    }
    assert_eq!(placed, count, "every office fit");
}

#[test]
fn three_hundred_people_make_two_stars_and_three_wants_two_security_offices() {
    let mut two = seeded_game(9, GameMode::Classic);
    occupied_offices(&mut two, 20, 60);
    assert!(two.population() >= 300);
    two.evaluate_star();
    assert!(two.star >= 2);

    let mut sim = seeded_game(11, GameMode::Classic);
    occupied_offices(&mut sim, 60, 200);
    assert!(sim.population() >= 1000);
    sim.evaluate_star();
    assert_eq!(sim.star, 2, "no Security");
    assert!(sim.tower.place(Kind::Security, 55, X0).ok);
    sim.evaluate_star();
    assert_eq!(sim.star, 2, "one office is not enough");
    assert!(sim.tower.place(Kind::Security, 55, X0 + 20).ok);
    sim.evaluate_star();
    assert!(sim.star >= 3);
}

#[test]
fn rooms_open_after_construction_and_structure_opens_at_once() {
    let mut sim = seeded_game(7, GameMode::Classic);
    for i in 0..12 {
        sim.tower.place(Kind::Floor, 2, X0 + i);
    }
    assert!(sim.build(Kind::Office, 2, X0).ok);
    let id = sim.tower.unit_at(2, X0).unwrap().id;
    let office = sim.tower.get_unit(id).unwrap();
    assert_eq!(office.state, UnitState::Construction);
    assert!(office.extras().complete_at.unwrap() > sim.clock.minutes);
    hours(&mut sim, 12);
    assert_ne!(
        sim.tower.get_unit(id).unwrap().state,
        UnitState::Construction
    );

    assert!(sim.build(Kind::Floor, 3, X0).ok);
    assert_ne!(
        sim.tower.unit_at(3, X0).unwrap().state,
        UnitState::Construction
    );
}

#[test]
fn a_day_of_ticks_moves_the_clock_a_day() {
    let mut sim = seeded_game(1, GameMode::Classic);
    let day = sim.clock.day();
    sim.tick(24.0 * 60.0);
    assert_eq!(sim.clock.day(), day + 1);
}

/// An unhappy occupied office on floor 5 over floors laid on the starter
/// lobby, with no shaft to it.
fn stranded_office() -> (Simulation, i64) {
    let mut sim = seeded_game(2, GameMode::Classic);
    for floor in 2..=5 {
        for i in 0..12 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
    let id = sim.tower.place(Kind::Office, 5, X0).unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = UnitState::Occupied;
    u.satisfaction = 0.2;
    (sim, id)
}

fn connect(sim: &mut Simulation) {
    assert!(
        sim.build_transport(Kind::ElevatorStandard, X0 + 11, 1, 5)
            .ok
    );
    let id = sim.tower.transports.last().unwrap().id;
    sim.tower.set_cars(id, 4);
}

fn notices(sim: &Simulation) -> usize {
    sim.log
        .iter()
        .filter(|e| e.text.contains("gave notice"))
        .count()
}

#[test]
fn an_unreachable_tenant_gives_notice_over_access_then_leaves() {
    let (mut sim, id) = stranded_office();
    hours(&mut sim, 24);
    let u = sim.tower.get_unit(id).unwrap();
    assert_eq!((u.state, u.satisfaction), (UnitState::Vacating, 0.0));
    assert_eq!(u.extras().vacate_reason, Some("access"));
    hours(&mut sim, 24 * 3);
    assert_eq!(sim.tower.get_unit(id).unwrap().state, UnitState::Empty);
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.contains("A tenant left") && e.text.contains("no route to the lobby")));
}

#[test]
fn restored_access_rescinds_the_notice_without_a_toast() {
    let (mut sim, id) = stranded_office();
    hours(&mut sim, 24);
    assert_eq!(sim.tower.get_unit(id).unwrap().state, UnitState::Vacating);
    connect(&mut sim);
    hours(&mut sim, 24);
    let u = sim.tower.get_unit(id).unwrap();
    assert_eq!(
        (u.state, u.extras().vacate_reason),
        (UnitState::Occupied, None)
    );
    assert!(!sim.log.iter().any(|e| {
        let t = e.text.to_lowercase();
        t.contains("staying") || t.contains("conditions improved")
    }));
    assert_eq!(notices(&sim), 1);
}

#[test]
fn a_mass_move_out_is_one_notice_toast() {
    let mut sim = seeded_game(2, GameMode::Classic);
    for floor in 2..=5 {
        for i in 0..40 {
            sim.tower.place(Kind::Floor, floor, X0 + i);
        }
    }
    let ids: Vec<i64> = [0, 9, 18, 27]
        .iter()
        .map(|dx| {
            let id = sim.tower.place(Kind::Office, 5, X0 + dx).unit_id.unwrap();
            let u = sim.tower.get_unit_mut(id).unwrap();
            u.state = UnitState::Occupied;
            u.satisfaction = 0.2;
            id
        })
        .collect();
    hours(&mut sim, 24);
    assert!(ids
        .iter()
        .all(|&id| sim.tower.get_unit(id).unwrap().state == UnitState::Vacating));
    assert_eq!(notices(&sim), 1);
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.contains("4 tenants gave notice")));
}

#[test]
fn a_tenant_nursed_only_below_the_rescind_bar_still_leaves() {
    let (mut sim, id) = stranded_office();
    connect(&mut sim);
    const { assert!(0.3 < VACATE_RESCIND) };
    {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Vacating;
        u.satisfaction = 0.3;
        let mut extras = u.extras_mut();
        extras.vacate_reason = Some("access");
        extras.vacate_at = Some(0.0);
    }
    sim.tick(60.0);
    assert_eq!(sim.tower.get_unit(id).unwrap().state, UnitState::Empty);
}

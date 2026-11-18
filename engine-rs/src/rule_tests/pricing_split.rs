//! The Classic and Modern pricing split (#299), outside the load: a new
//! Classic build lists at the Average rung (stored only where it differs from
//! the band default) while Modern keeps the band default; No Rate keeps a
//! vacant room empty, keeps a tenant who then pays nothing and still counts,
//! is refused on a sold condo and in Modern, and is cleared by a reprice; the
//! price choke point snaps onto a rung; a returning Classic condo re-lists on
//! the ladder; and an occupied No Rate condo still costs its full buy-back.
//! The load-time snap is in `pricing_split_snap`.
//!
//! Also covered: the rung each price tier reads by
//! `panels::tests_room_tiers::classic_rent_tiers_are_the_rungs_the_editor_shows`,
//! every offered price being the one collected by
//! `catalog::charge_tests::every_offered_price_is_the_one_collected`, and a
//! No Rate room earning nothing by
//! `rule_tests::condos::a_no_rate_unit_never_sells_or_leases_and_earns_nothing`.
use crate::clock::GameMode;
use crate::econ::rent_of;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::{Unit, UnitState};

use super::{seeded_game, MID};

pub(super) const X0: i64 = MID - 30;

/// A served floor-2 strip of 60 tiles from `X0`, in `mode`.
pub(super) fn strip(mode: GameMode, seed: u32) -> Simulation {
    let mut sim = seeded_game(seed, mode);
    for x in (X0..=MID - 21).rev() {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for x in MID + 20..X0 + 60 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for i in 0..60 {
        assert!(sim.tower.place(Kind::Floor, 2, X0 + i).ok);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, X0, 1, 2).ok);
    sim.money = 1e9;
    sim
}

pub(super) fn unit(sim: &Simulation, id: i64) -> &Unit {
    sim.tower.get_unit(id).unwrap()
}

pub(super) fn rent(sim: &Simulation, id: i64) -> f64 {
    let u = unit(sim, id);
    rent_of(u.kind, u.rent, u.no_rate)
}

pub(super) fn index_of(sim: &Simulation, id: i64) -> usize {
    sim.tower.units.iter().position(|u| u.id == id).unwrap()
}

fn built(sim: &mut Simulation, kind: Kind, x: i64) -> i64 {
    let r = sim.build(kind, 2, x);
    assert!(r.ok, "{kind:?}: {:?}", r.reason);
    sim.tower.unit_at(2, x).unwrap().id
}

/// A Classic condo placed bare (no rung stamped), sold at `price`.
pub(super) fn sold_condo(sim: &mut Simulation, price: f64) -> i64 {
    let id = sim.tower.place(Kind::Condo, 2, X0).unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    (u.rent, u.ever_occupied, u.state) = (Some(price), true, UnitState::Occupied);
    id
}

fn hours(sim: &mut Simulation, n: usize) {
    for _ in 0..n {
        sim.tick(60.0);
    }
}

#[test]
fn a_new_classic_build_lists_at_the_average_rung() {
    let mut sim = strip(GameMode::Classic, 7);
    sim.star = 3;
    let office = built(&mut sim, Kind::Office, X0);
    let condo = built(&mut sim, Kind::Condo, X0 + 10);
    let room = built(&mut sim, Kind::HotelSingle, X0 + 27);
    // The office's Average is its band default, so nothing is stored.
    assert_eq!(unit(&sim, office).rent, None);
    assert_eq!(rent(&sim, office), 10_000.0);
    assert_eq!(unit(&sim, condo).rent, Some(150_000.0));
    assert_eq!(unit(&sim, room).rent, Some(2_000.0));
}

#[test]
fn a_new_modern_build_keeps_the_band_default() {
    let mut sim = strip(GameMode::Modern, 7);
    let condo = built(&mut sim, Kind::Condo, X0);
    assert_eq!(unit(&sim, condo).rent, None);
    assert_eq!(rent(&sim, condo), 160_000.0);
}

/// A vacant served office, with No Rate set or not, after ten days.
fn vacant_office_after_ten_days(no_rate: bool) -> (Simulation, i64) {
    let mut sim = strip(GameMode::Classic, 11);
    let office = built(&mut sim, Kind::Office, X0);
    sim.tower.get_unit_mut(office).unwrap().state = UnitState::Empty;
    if no_rate {
        assert!(sim.set_no_rate(office));
    }
    for _ in 0..24 * 10 {
        if unit(&sim, office).state != UnitState::Empty {
            break;
        }
        sim.tick(60.0);
    }
    (sim, office)
}

#[test]
fn a_vacant_no_rate_office_never_fills_and_its_twin_does() {
    let (sim, office) = vacant_office_after_ten_days(true);
    assert_eq!(unit(&sim, office).state, UnitState::Empty);
    assert!(unit(&sim, office).no_rate);
    assert_eq!(rent(&sim, office), 0.0);
    let (control, office) = vacant_office_after_ten_days(false);
    assert_eq!(unit(&control, office).state, UnitState::Occupied);
}

#[test]
fn no_rate_on_a_tenant_never_evicts_and_the_tenant_still_counts() {
    let mut sim = strip(GameMode::Classic, 13);
    let office = built(&mut sim, Kind::Office, X0);
    let i = index_of(&sim, office);
    sim.move_in(i);
    assert_eq!(unit(&sim, office).state, UnitState::Occupied);
    let population = sim.rating_population();
    assert!(sim.set_no_rate(office));
    hours(&mut sim, 48);
    assert_eq!(unit(&sim, office).state, UnitState::Occupied);
    assert_eq!(rent(&sim, office), 0.0);
    assert_eq!(sim.rating_population(), population);
}

#[test]
fn no_rate_is_refused_on_a_sold_condo_and_in_modern() {
    let mut classic = strip(GameMode::Classic, 17);
    let condo = built(&mut classic, Kind::Condo, X0);
    let i = index_of(&classic, condo);
    classic.move_in(i);
    assert!(unit(&classic, condo).ever_occupied);
    assert!(!classic.set_no_rate(condo));
    assert!(!unit(&classic, condo).no_rate);
    let mut modern = strip(GameMode::Modern, 17);
    let office = built(&mut modern, Kind::Office, X0);
    assert!(!modern.set_no_rate(office));
    assert!(!unit(&modern, office).no_rate);
}

#[test]
fn a_reprice_puts_a_no_rate_unit_back_on_the_market() {
    let mut sim = strip(GameMode::Classic, 19);
    let office = built(&mut sim, Kind::Office, X0);
    assert!(sim.set_no_rate(office));
    assert_eq!(sim.price_unit(office, 5_000.0), Some(5_000.0));
    assert!(!unit(&sim, office).no_rate);
    assert_eq!(rent(&sim, office), 5_000.0);
}

#[test]
fn the_choke_point_snaps_a_classic_price_onto_a_rung() {
    let mut sim = strip(GameMode::Classic, 23);
    sim.star = 3;
    let room = built(&mut sim, Kind::HotelSingle, X0);
    assert_eq!(
        sim.price_unit(room, 1_750.0),
        Some(2_000.0),
        "a tie rounds up"
    );
    assert_eq!(
        sim.price_unit(room, 999_999.0),
        Some(3_000.0),
        "the top rung"
    );
}

#[test]
fn a_returning_classic_condo_re_lists_on_the_ladder() {
    let mut sim = strip(GameMode::Classic, 53);
    let condo = sold_condo(&mut sim, 240_000.0);
    let i = index_of(&sim, condo);
    sim.vacate(i, "access");
    assert!(!unit(&sim, condo).ever_occupied);
    assert_eq!(unit(&sim, condo).rent, Some(200_000.0), "the High rung");
}

#[test]
fn an_occupied_no_rate_condo_still_costs_its_full_buy_back() {
    let mut sim = strip(GameMode::Classic, 61);
    let condo = sold_condo(&mut sim, 150_000.0);
    sim.tower.get_unit_mut(condo).unwrap().no_rate = true;
    let before = sim.money;
    let i = index_of(&sim, condo);
    sim.vacate(i, "access");
    assert_eq!(sim.money, before - 150_000.0);
}

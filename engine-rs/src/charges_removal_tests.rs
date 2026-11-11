//! Tests for the rooms `remove_facility` keeps: Classic's permanent rooms and the lobby.
use super::*;
use crate::clock::GameMode;

/// A lobby on floor 1 and a floor of tiles on 2, in `mode`.
fn tower_in(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    for x in 10..120 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for floor in 2..=4 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
        sim.tower.place(Kind::Floor, 0, x);
        sim.tower.place(Kind::Floor, -1, x);
    }
    sim.money = 1_000_000.0;
    sim
}

#[test]
fn classic_housekeeping_cannot_be_removed_but_a_gutted_shell_clears() {
    let mut sim = tower_in(GameMode::Classic);
    let hk = sim.tower.place(Kind::Housekeeping, 2, 20).unit_id.unwrap();
    let money = sim.money;
    assert_eq!(
        sim.remove_facility(hk, RemovalMethod::Bulldoze),
        ChargeResult::refuse(HOUSEKEEPING_PERMANENT)
    );
    assert!(sim.tower.get_unit(hk).is_some());
    assert_eq!(sim.money, money);
    sim.tower.get_unit_mut(hk).unwrap().state = UnitState::Gutted;
    assert!(sim.remove_facility(hk, RemovalMethod::Bulldoze).ok);
    assert!(sim.tower.get_unit(hk).is_none());
}

#[test]
fn modern_housekeeping_can_be_sold() {
    let mut sim = tower_in(GameMode::Modern);
    let hk = sim.tower.place(Kind::Housekeeping, 2, 20).unit_id.unwrap();
    assert!(sim.remove_facility(hk, RemovalMethod::Sell).ok);
}

#[test]
fn lobby_tiles_cannot_be_removed_in_either_mode() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = tower_in(mode);
        let lobby = sim.tower.unit_at(1, 20).unwrap().id;
        assert!(!sim.remove_facility(lobby, RemovalMethod::Bulldoze).ok);
        assert!(sim.tower.get_unit(lobby).is_some());
    }
}

#[test]
fn classic_keeps_security_recycling_and_the_movie_theater() {
    for (kind, floor, x, reason) in [
        (Kind::Security, 2, 12, SECURITY_PERMANENT),
        (Kind::Recycling, -1, 22, RECYCLING_PERMANENT),
        (Kind::Cinema, 2, 60, CINEMA_PERMANENT),
    ] {
        let mut sim = tower_in(GameMode::Classic);
        let placed = sim.tower.place(kind, floor, x);
        let id = placed
            .unit_id
            .unwrap_or_else(|| panic!("{kind:?}: {:?}", placed.reason));
        assert_eq!(
            sim.remove_facility(id, RemovalMethod::Bulldoze),
            ChargeResult::refuse(reason),
            "{kind:?}"
        );
        assert!(sim.tower.get_unit(id).is_some());
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Gutted;
        assert!(
            sim.remove_facility(id, RemovalMethod::Bulldoze).ok,
            "{kind:?} shell"
        );
    }
}

#[test]
fn modern_sells_security_recycling_and_the_movie_theater() {
    for (kind, floor, x) in [
        (Kind::Security, 2, 12),
        (Kind::Recycling, -1, 22),
        (Kind::Cinema, 2, 60),
    ] {
        let mut sim = tower_in(GameMode::Modern);
        let placed = sim.tower.place(kind, floor, x);
        let id = placed
            .unit_id
            .unwrap_or_else(|| panic!("{kind:?}: {:?}", placed.reason));
        assert!(sim.remove_facility(id, RemovalMethod::Sell).ok, "{kind:?}");
    }
}

/// A condo on floor 2 that sold to a household of `residents` at `price`.
fn sold_condo(sim: &mut Simulation, price: f64, residents: Option<i64>) -> i64 {
    let id = sim.tower.place(Kind::Condo, 2, 20).unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = UnitState::Occupied;
    u.ever_occupied = true;
    u.rent = Some(price);
    u.residents = residents;
    id
}

#[test]
fn removing_a_sold_condo_buys_it_back_before_the_resale_refund() {
    // #713: the household already paid for the unit, so a sale or a
    // bulldoze cannot pocket the shell's refund on top of the sale price.
    for (mode, residents) in [(GameMode::Classic, None), (GameMode::Modern, Some(3))] {
        for method in [RemovalMethod::Sell, RemovalMethod::Bulldoze] {
            let mut sim = tower_in(mode);
            let id = sold_condo(&mut sim, 150_000.0, residents);
            let before = sim.money;
            let paid = sim.remove_facility(id, method);
            let net = Kind::Condo.resale_refund() - 150_000.0;
            assert_eq!(paid, ChargeResult::paid(net), "{mode:?} {method:?}");
            assert_eq!(sim.money - before, net);
            assert!(sim.tower.get_unit(id).is_none());
            assert_eq!(
                sim.log.last().unwrap().text,
                "You bought back Condominium on floor 2 for $150,000 to remove it."
            );
        }
    }
}

#[test]
fn a_modern_buy_back_follows_the_household_size() {
    // A household of 4 paid 4/3 of the asking, as `vacate` buys it back.
    let mut sim = tower_in(GameMode::Modern);
    let id = sold_condo(&mut sim, 150_000.0, Some(4));
    let before = sim.money;
    assert!(sim.remove_facility(id, RemovalMethod::Sell).ok);
    assert_eq!(sim.money - before, Kind::Condo.resale_refund() - 200_000.0);
}

#[test]
fn an_unsold_or_gutted_condo_pays_only_its_refund() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = tower_in(mode);
        let unsold = sim.tower.place(Kind::Condo, 2, 20).unit_id.unwrap();
        let before = sim.money;
        assert!(sim.remove_facility(unsold, RemovalMethod::Sell).ok);
        assert_eq!(sim.money - before, Kind::Condo.resale_refund());

        let gutted = sold_condo(&mut sim, 150_000.0, None);
        sim.tower.get_unit_mut(gutted).unwrap().state = UnitState::Gutted;
        let before = sim.money;
        assert!(sim.remove_facility(gutted, RemovalMethod::Bulldoze).ok);
        assert_eq!(sim.money, before);
    }
}

#[test]
fn a_sold_condo_stays_when_the_buy_back_is_out_of_reach() {
    let mut sim = tower_in(GameMode::Classic);
    let id = sold_condo(&mut sim, 150_000.0, None);
    sim.money = 100_000.0;
    let r = sim.remove_facility(id, RemovalMethod::Sell);
    assert!(!r.ok);
    assert_eq!(
        r.reason.as_deref(),
        Some("You can't sell this condo without buying it back for $150,000.")
    );
    assert!(sim.tower.get_unit(id).is_some());
    assert_eq!(sim.money, 100_000.0);
}

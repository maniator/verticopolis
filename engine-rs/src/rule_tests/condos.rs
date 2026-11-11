//! Condos in each mode: Classic sells to a family of three at the asking
//! price, Modern draws a household of two to five and scales the price, an
//! evicted owner is bought back, and a save is hardened at the load. The
//! catalog band is pinned by `catalog::tests::each_mode_matches_the_lock`;
//! the quoted sale and buy-back prices by
//! `catalog::charge_tests::a_condo_sells_once_at_the_quoted_household_price`
//! and `charges_removal_tests`; the re-listing and the stamped price by
//! `condoModesEngine.integration.test.ts`.
use serde_json::Value;

use crate::clock::GameMode;
use crate::econ::rent_of;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::{Unit, UnitState};

use super::MID as C;

const CLASSIC_ASKING: f64 = 150_000.0;

fn lay(sim: &mut Simulation, kind: Kind, floor: i64) {
    for x in 0..LOT_WIDTH {
        sim.tower.place(kind, floor, x);
    }
}

fn unit(sim: &Simulation, id: i64) -> &Unit {
    sim.tower.get_unit(id).unwrap()
}

/// A served condo built at `C + 4` and opened; `before` runs on it first.
fn served_condo(
    seed: u32,
    mode: GameMode,
    before: impl FnOnce(&mut Simulation, i64),
) -> (Simulation, i64) {
    let mut sim = Simulation::new_game(seed, mode);
    sim.money = 1e9;
    sim.star = 1;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    assert!(sim.build(Kind::Condo, 2, C + 4).ok);
    let id = sim.tower.unit_at(2, C + 4).unwrap().id;
    sim.tower.get_unit_mut(id).unwrap().satisfaction = 1.0;
    before(&mut sim, id);
    for _ in 0..240 {
        if unit(&sim, id).state != UnitState::Construction {
            break;
        }
        sim.tick(60.0);
    }
    assert_ne!(unit(&sim, id).state, UnitState::Construction);
    (sim, id)
}

fn tick_until(sim: &mut Simulation, done: impl Fn(&Simulation) -> bool) -> bool {
    for _ in 0..24 * 40 {
        if done(sim) {
            return true;
        }
        sim.tick(60.0);
    }
    done(sim)
}

/// A condo sold to its first buyer.
fn sold_condo(seed: u32, mode: GameMode) -> (Simulation, i64) {
    let (mut sim, id) = served_condo(seed, mode, |_, _| {});
    assert!(tick_until(&mut sim, |s| unit(s, id).ever_occupied));
    (sim, id)
}

fn logged(sim: &Simulation, needle: &str) -> bool {
    sim.log.iter().any(|e| e.text.contains(needle))
}

fn rent(u: &Unit) -> f64 {
    rent_of(u.kind, u.rent, u.no_rate)
}

/// Loads `sim`'s save after `edit` rewrites each condo record in it.
fn reload_with(sim: &Simulation, edit: impl Fn(&mut Value)) -> Simulation {
    let mut raw = sim.serialize();
    for u in raw["units"].as_array_mut().unwrap() {
        if u["kind"] == "condo" {
            edit(u);
        }
    }
    deserialize(&raw).unwrap()
}

fn the_condo(sim: &Simulation) -> &Unit {
    sim.tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Condo)
        .unwrap()
}

#[test]
fn classic_sells_to_a_family_of_three_at_the_asking_price() {
    let (sim, id) = sold_condo(3, GameMode::Classic);
    let condo = unit(&sim, id);
    assert_eq!((condo.residents, condo.resident_count()), (None, 3));
    assert_eq!(condo.rent, Some(CLASSIC_ASKING));
    assert!(logged(&sim, "sold for $150,000."));
    assert!(!logged(&sim, "household of"));
    assert_eq!(sim.tower.total_population(), 3);
}

#[test]
fn modern_draws_a_household_of_two_to_five_and_scales_the_price() {
    let (sim, id) = sold_condo(7, GameMode::Modern);
    let condo = unit(&sim, id);
    let size = condo.residents.unwrap();
    assert!((2..=5).contains(&size));
    assert_eq!(
        (condo.resident_count(), sim.tower.total_population()),
        (size, size)
    );
    let price = (rent(condo) * size as f64 / 3.0).round() as i64;
    let price = price.to_string();
    let grouped: String = price
        .chars()
        .rev()
        .enumerate()
        .flat_map(|(i, c)| (i > 0 && i % 3 == 0).then_some(',').into_iter().chain([c]))
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    assert!(
        logged(&sim, &format!("household of {size} for ${grouped}")),
        "{grouped}"
    );
}

#[test]
fn a_no_rate_unit_never_sells_or_leases_and_earns_nothing() {
    let (mut sim, id) = served_condo(3, GameMode::Classic, |sim, id| assert!(sim.set_no_rate(id)));
    let before = sim.money;
    for _ in 0..24 * 80 {
        sim.tick(60.0);
    }
    let condo = unit(&sim, id);
    assert!(!condo.ever_occupied && condo.no_rate);
    assert_eq!(
        (condo.state, condo.rent),
        (UnitState::Empty, Some(CLASSIC_ASKING))
    );
    assert_eq!(rent(condo), 0.0);
    assert!(!logged(&sim, "sold"));
    assert!(sim.money <= before);

    let mut sim = Simulation::new_game(3, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 1;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
    let office = sim.tower.place(Kind::Office, 2, C + 4).unit_id.unwrap();
    let u = sim.tower.get_unit_mut(office).unwrap();
    (u.state, u.satisfaction, u.no_rate) = (UnitState::Empty, 1.0, true);
    for _ in 0..24 * 40 {
        sim.tick(60.0);
    }
    let u = unit(&sim, office);
    assert!(!u.ever_occupied);
    assert_eq!((u.state, rent(u)), (UnitState::Empty, 0.0));
}

#[test]
fn a_household_counts_only_on_a_condo() {
    let (mut sim, id) = sold_condo(3, GameMode::Classic);
    let office = sim.tower.place(Kind::Office, 2, C + 30).unit_id.unwrap();
    sim.tower.get_unit_mut(office).unwrap().residents = Some(99);
    assert_eq!(
        unit(&sim, office).resident_count(),
        Kind::Office.facility().population
    );
    sim.tower.get_unit_mut(id).unwrap().residents = Some(5);
    assert_eq!(unit(&sim, id).resident_count(), 5);
}

#[test]
fn an_evicted_owner_is_bought_back_at_the_sale_price() {
    for (seed, mode) in [(5, GameMode::Classic), (7, GameMode::Modern)] {
        let (mut sim, id) = sold_condo(seed, mode);
        let condo = unit(&sim, id);
        let size = condo.residents.unwrap_or(3);
        let paid = (rent(condo) * size as f64 / 3.0).round();
        let before = sim.money;
        let shafts: Vec<i64> = sim.tower.transports.iter().map(|t| t.id).collect();
        for t in shafts {
            sim.tower.remove_transport(t);
        }
        assert!(
            tick_until(&mut sim, |s| !unit(s, id).ever_occupied),
            "{mode:?}"
        );
        assert_eq!(before - sim.money, paid, "{mode:?}");
        assert_eq!(unit(&sim, id).residents, None);
        assert!(logged(&sim, "bought it back for"));
    }
}

#[test]
fn a_bigger_unserved_household_drains_faster() {
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 1;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    let mut home = |x: i64, residents: i64| {
        let id = sim.tower.place(Kind::Condo, 2, x).unit_id.unwrap();
        let u = sim.tower.get_unit_mut(id).unwrap();
        (u.state, u.ever_occupied, u.residents, u.satisfaction) =
            (UnitState::Occupied, true, Some(residents), 1.0);
        id
    };
    let (big, small) = (home(C + 4, 5), home(C + 24, 2));
    sim.tick(60.0);
    assert!(unit(&sim, big).satisfaction < unit(&sim, small).satisfaction);
}

#[test]
fn the_mode_and_a_household_survive_a_save_and_a_forged_one_is_hardened() {
    let (sim, id) = sold_condo(7, GameMode::Modern);
    let size = unit(&sim, id).residents;
    let loaded = deserialize(&sim.serialize()).unwrap();
    assert_eq!(
        (loaded.mode, unit(&loaded, id).residents),
        (GameMode::Modern, size)
    );
    let mut raw = sim.serialize();
    raw.as_object_mut().unwrap().remove("mode");
    assert_eq!(deserialize(&raw).unwrap().mode, GameMode::Classic);
    let forged = reload_with(&sim, |u| u["residents"] = 9999.into());
    assert!((2..=5).contains(&the_condo(&forged).residents.unwrap()));

    let (classic, _) = sold_condo(3, GameMode::Classic);
    let forged = reload_with(&classic, |u| u["residents"] = 5.into());
    assert_eq!(the_condo(&forged).residents, None);
    assert_eq!(forged.tower.total_population(), 3);
}

#[test]
fn a_load_never_reads_a_phantom_sale() {
    let (sim, _) = served_condo(3, GameMode::Classic, |_, _| {});
    let forged = reload_with(&sim, |u| u["everOccupied"] = "yes".into());
    assert!(!the_condo(&forged).ever_occupied);
    for state in ["empty", "construction"] {
        let forged = reload_with(&sim, |u| {
            u["everOccupied"] = true.into();
            u["state"] = state.into();
        });
        assert!(!the_condo(&forged).ever_occupied, "{state}");
    }
    let (modern, _) = served_condo(3, GameMode::Modern, |_, _| {});
    let stale = reload_with(&modern, |u| {
        u["state"] = "empty".into();
        u["everOccupied"] = false.into();
        u["residents"] = 5.into();
    });
    assert_eq!(the_condo(&stale).residents, None);
}

#[test]
fn a_hotel_room_keeps_its_ever_booked_mark() {
    let mut sim = Simulation::new_game(3, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 1;
    lay(&mut sim, Kind::Lobby, 1);
    lay(&mut sim, Kind::Floor, 2);
    let room = sim.tower.place(Kind::HotelSingle, 2, C).unit_id.unwrap();
    let u = sim.tower.get_unit_mut(room).unwrap();
    (u.state, u.ever_occupied) = (UnitState::Empty, true);
    assert!(unit(&deserialize(&sim.serialize()).unwrap(), room).ever_occupied);
    let u = sim.tower.get_unit_mut(room).unwrap();
    (u.state, u.satisfaction) = (UnitState::Asleep, 0.05);
    assert!(tick_until(&mut sim, |s| unit(s, room).state == UnitState::Empty));
    assert!(unit(&sim, room).ever_occupied);
}

#[test]
fn a_legacy_or_forged_sold_price_loads_bounded() {
    let (sim, _) = sold_condo(3, GameMode::Classic);
    for mode in [Some("garbage"), None] {
        let mut raw = sim.serialize();
        match mode {
            Some(m) => raw["mode"] = m.into(),
            None => _ = raw.as_object_mut().unwrap().remove("mode"),
        }
        for u in raw["units"].as_array_mut().unwrap() {
            if u["kind"] == "condo" {
                u.as_object_mut().unwrap().remove("rent");
            }
        }
        let loaded = deserialize(&raw).unwrap();
        assert_eq!(loaded.mode, GameMode::Classic);
        assert_eq!(rent(the_condo(&loaded)), 100_000.0, "{mode:?}");
    }
    let forged = reload_with(&sim, |u| u["rent"] = 1e9.into());
    assert_eq!(rent(the_condo(&forged)), 200_000.0);
}

#[test]
fn an_out_of_band_price_snaps_in_classic_and_clamps_only_unsold_in_modern() {
    for (mode, sold_after) in [
        (GameMode::Classic, 200_000.0),
        (GameMode::Modern, 240_000.0),
    ] {
        let mut sim = Simulation::new_game(3, mode);
        sim.money = 1e9;
        lay(&mut sim, Kind::Lobby, 1);
        lay(&mut sim, Kind::Floor, 2);
        assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 2).ok);
        let a = sim.tower.place(Kind::Condo, 2, C + 4).unit_id.unwrap();
        let b = sim.tower.place(Kind::Condo, 2, C + 24).unit_id.unwrap();
        let u = sim.tower.get_unit_mut(a).unwrap();
        (u.state, u.rent, u.ever_occupied) = (UnitState::Empty, Some(240_000.0), false);
        let u = sim.tower.get_unit_mut(b).unwrap();
        (u.state, u.rent, u.ever_occupied) = (UnitState::Occupied, Some(240_000.0), true);
        let loaded = deserialize(&sim.serialize()).unwrap();
        assert_eq!(rent(unit(&loaded, a)), 200_000.0, "{mode:?} unsold");
        assert_eq!(rent(unit(&loaded, b)), sold_after, "{mode:?} sold");
    }
}

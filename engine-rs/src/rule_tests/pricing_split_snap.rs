//! The second half of the retired `pricingSplit` suite: the Classic snap on
//! load (NFR3). Each pre-split price lands on its pinned rung (the old office
//! maximum on High, the $80k condo floor on $100k, a tie rounding up, an
//! unset price on Average), the one-time bulletin posts once with the condo
//! line only when a condo is present, a save on the rungs loads silently,
//! forged prices clamp and snap (a non-finite hotel price to Average), a sold
//! condo snaps and its buy-back follows, a legal $50k sale is never lifted,
//! and Modern saves are left alone. The rest of the suite is in
//! `pricing_split`; the stored rent's bounds on a sold condo are also
//! pinned by `rule_tests::condos::a_legacy_or_forged_sold_price_loads_bounded`.
use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::{LogKind, Simulation};

use super::pricing_split::{index_of, rent, sold_condo, strip, unit, X0};

const BULLETIN: &str = "Classic pricing: rents snapped to the four 1994 rate levels.";
const CONDO_LINE: &str = "Condos can now sell";

/// A unit placed bare, so no rung is stamped: the price a pre-split save held.
fn bare(sim: &mut Simulation, kind: Kind, x: i64, price: Option<f64>) -> i64 {
    let r = sim.tower.place(kind, 2, x);
    assert!(r.ok, "{kind:?}: {:?}", r.reason);
    let id = r.unit_id.unwrap();
    sim.tower.get_unit_mut(id).unwrap().rent = price;
    id
}

fn reload(sim: &Simulation) -> Simulation {
    deserialize(&sim.serialize()).expect("the save loads")
}

fn bulletins(sim: &Simulation) -> usize {
    sim.log
        .iter()
        .filter(|e| e.text.starts_with(BULLETIN))
        .count()
}

fn set_rent(save: &mut Value, id: i64, value: Value) {
    let units = save["units"].as_array_mut().unwrap();
    units.iter_mut().find(|u| u["id"] == id).unwrap()["rent"] = value;
}

#[test]
fn each_pre_split_price_lands_on_its_rung_and_the_bulletin_posts_once() {
    let mut sim = strip(GameMode::Classic, 29);
    let old_max = bare(&mut sim, Kind::Office, X0, Some(20_000.0));
    let tie = bare(&mut sim, Kind::Office, X0 + 9, Some(7_500.0));
    let unset = bare(&mut sim, Kind::Office, X0 + 18, None);
    let old_floor = bare(&mut sim, Kind::Condo, X0 + 27, Some(80_000.0));
    let ids = [old_max, tie, unset, old_floor];
    let total = |s: &Simulation| ids.iter().map(|&id| rent(s, id)).sum::<f64>();
    assert_eq!(total(&sim), 117_500.0);
    let loaded = reload(&sim);
    assert_eq!(
        rent(&loaded, old_max),
        15_000.0,
        "the old maximum drops to High"
    );
    assert_eq!(rent(&loaded, tie), 10_000.0, "a tie rounds up to Average");
    assert_eq!(rent(&loaded, unset), 10_000.0);
    assert_eq!(rent(&loaded, old_floor), 100_000.0);
    assert_eq!(total(&loaded), 135_000.0);
    let lines: Vec<_> = loaded
        .log
        .iter()
        .filter(|e| e.text.starts_with(BULLETIN))
        .collect();
    assert_eq!(lines.len(), 1);
    assert!(lines[0].text.contains(CONDO_LINE));
    assert_eq!(lines[0].kind, LogKind::Info);
    // The snapped save loads again in silence.
    let again = reload(&loaded);
    assert_eq!(bulletins(&again), 1, "the restored line only");
    assert_eq!(again.log.len(), loaded.log.len());
}

#[test]
fn a_save_without_a_condo_gets_the_bulletin_without_the_condo_line() {
    let mut sim = strip(GameMode::Classic, 31);
    bare(&mut sim, Kind::Office, X0, Some(20_000.0));
    let loaded = reload(&sim);
    assert!(loaded.log.iter().any(|e| e.text == BULLETIN));
    assert!(!loaded.log.iter().any(|e| e.text.contains(CONDO_LINE)));
}

#[test]
fn a_save_already_on_the_rungs_loads_silently() {
    let mut sim = strip(GameMode::Classic, 37);
    assert!(sim.build(Kind::Office, 2, X0).ok);
    assert!(sim.build(Kind::Condo, 2, X0 + 10).ok);
    assert_eq!(bulletins(&reload(&sim)), 0);
}

#[test]
fn forged_prices_clamp_and_snap_onto_the_ladder() {
    let mut sim = strip(GameMode::Classic, 41);
    let a = bare(&mut sim, Kind::Office, X0, None);
    let b = bare(&mut sim, Kind::Office, X0 + 9, None);
    let c = bare(&mut sim, Kind::HotelSuite, X0 + 18, None);
    let mut save = sim.serialize();
    set_rent(&mut save, a, Value::Null); // NaN as JSON writes it
    set_rent(&mut save, b, json!(-12));
    set_rent(&mut save, c, json!(9e15));
    let loaded = deserialize(&save).unwrap();
    assert_eq!(rent(&loaded, a), 10_000.0, "Average");
    assert_eq!(rent(&loaded, b), 2_000.0, "Very Low");
    assert_eq!(rent(&loaded, c), 9_000.0, "the top rung");
    for u in &loaded.tower.units {
        let r = rent(&loaded, u.id);
        match u.kind {
            Kind::Office => assert!([2_000.0, 5_000.0, 10_000.0, 15_000.0].contains(&r)),
            Kind::HotelSuite => assert!([1_500.0, 4_000.0, 6_000.0, 9_000.0].contains(&r)),
            _ => {}
        }
    }
}

#[test]
fn a_hotel_price_that_is_not_finite_or_unset_lands_on_average() {
    let mut sim = strip(GameMode::Classic, 49);
    let room = bare(&mut sim, Kind::HotelSingle, X0, None);
    let mut save = sim.serialize();
    set_rent(&mut save, room, Value::Null);
    assert_eq!(rent(&deserialize(&save).unwrap(), room), 2_000.0);
    // An unset price is the default, which is Average, and the move from the
    // old band default is bulletined.
    let mut sim = strip(GameMode::Classic, 59);
    let room = bare(&mut sim, Kind::HotelSingle, X0, None);
    let loaded = reload(&sim);
    assert_eq!(rent(&loaded, room), 2_000.0);
    assert_eq!(bulletins(&loaded), 1);
}

#[test]
fn a_sold_condo_snaps_and_its_buy_back_follows_the_rung() {
    let mut sim = strip(GameMode::Classic, 43);
    let condo = sold_condo(&mut sim, 120_000.0);
    let mut loaded = reload(&sim);
    assert_eq!(unit(&loaded, condo).rent, Some(100_000.0));
    let before = loaded.money;
    let i = index_of(&loaded, condo);
    loaded.vacate(i, "access");
    assert_eq!(loaded.money, before - 100_000.0);
}

#[test]
fn a_legal_fifty_thousand_condo_sale_is_never_lifted() {
    let mut sim = strip(GameMode::Classic, 47);
    let condo = sold_condo(&mut sim, 50_000.0);
    let once = reload(&sim);
    assert_eq!(unit(&once, condo).rent, Some(50_000.0));
    let twice = reload(&once);
    assert_eq!(unit(&twice, condo).rent, Some(50_000.0));
    assert_eq!(bulletins(&twice), bulletins(&once));
}

#[test]
fn modern_saves_are_never_snapped() {
    let mut sim = strip(GameMode::Modern, 47);
    let office = bare(&mut sim, Kind::Office, X0, Some(17_000.0));
    let condo = bare(&mut sim, Kind::Condo, X0 + 10, Some(90_000.0));
    let loaded = reload(&sim);
    assert_eq!(unit(&loaded, office).rent, Some(17_000.0));
    assert_eq!(unit(&loaded, condo).rent, Some(90_000.0));
    assert!(!loaded
        .log
        .iter()
        .any(|e| e.text.starts_with("Classic pricing:")));
}

//! The core simulation suite, retail and identity: every new shop, fast
//! food and restaurant rolls a canon subtype from the game stream (and
//! nothing else draws), the rolls are pinned per seed, a reroll always
//! lands on another canon name and can reach every one, the subtype is
//! cosmetic and survives a save while a forged or missing one loads as
//! none, the founding seed outlives the live stream, and a venue's
//! patronage and profit build through the day, roll over at midnight, stay
//! unset on an idle venue and on every other kind, and load hardened.
use serde_json::{json, Value};

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::sim::Simulation;
use crate::tower::{Unit, UnitState};

use super::seeded_game;
use super::simulation_economy::{built_tower, hours, X0};

/// Builds `kind` on floor 2 at `x` with five stars and money to spare.
fn build_one(sim: &mut Simulation, kind: Kind, x: i64) -> i64 {
    sim.money = 1e12;
    sim.star = 5;
    assert!(sim.build(kind, 2, x).ok, "{kind:?}");
    sim.tower.unit_at(2, x).unwrap().id
}

fn unit(sim: &Simulation, id: i64) -> &Unit {
    sim.tower.get_unit(id).unwrap()
}

#[test]
fn each_new_retail_room_rolls_a_canon_subtype_and_nothing_else_does() {
    for kind in [Kind::Shop, Kind::FastFood, Kind::Restaurant] {
        let mut sim = built_tower(11);
        let id = build_one(&mut sim, kind, X0);
        let subtype = unit(&sim, id).subtype.unwrap();
        assert!(kind.subtype_list().unwrap().contains(&subtype), "{kind:?}");
    }
    let mut sim = built_tower(11);
    let office = build_one(&mut sim, Kind::Office, X0);
    assert_eq!(unit(&sim, office).subtype, None);
}

fn three_shops(seed: u32) -> Vec<&'static str> {
    let mut sim = built_tower(seed);
    [0, 12, 24]
        .iter()
        .map(|dx| {
            let id = build_one(&mut sim, Kind::Shop, X0 + dx);
            unit(&sim, id).subtype.unwrap()
        })
        .collect()
}

#[test]
fn the_rolls_are_pinned_per_seed() {
    assert_eq!(three_shops(11), three_shops(11));
    assert_eq!(three_shops(11), ["Boutique", "Boutique", "Electronics"]);
    assert_eq!(
        three_shops(42),
        ["Electronics", "Drug Store", "Post Office"]
    );
}

#[test]
fn building_no_retail_draws_nothing_from_the_game_stream() {
    let witness = || {
        let mut sim = built_tower(3);
        build_one(&mut sim, Kind::Office, X0);
        build_one(&mut sim, Kind::Office, X0 + 12);
        build_one(&mut sim, Kind::Condo, X0 + 24);
        sim.rng.int(0, 1_000_000_000)
    };
    assert_eq!(witness(), witness());
    assert_eq!(witness(), 720_226_784);
}

#[test]
fn a_reroll_lands_on_another_canon_name_and_can_reach_every_one() {
    let mut sim = built_tower(11);
    let shop = build_one(&mut sim, Kind::Shop, X0);
    let names = Kind::Shop.subtype_list().unwrap();
    let mut prev = unit(&sim, shop).subtype.unwrap();
    for _ in 0..20 {
        let next = sim.reroll_subtype(shop).unwrap();
        assert_ne!(next, prev);
        assert!(names.contains(&next));
        prev = next;
    }
    let mut reached = std::collections::HashSet::new();
    for _ in 0..400 {
        sim.tower.get_unit_mut(shop).unwrap().subtype = None;
        reached.insert(sim.reroll_subtype(shop).unwrap());
    }
    assert_eq!(reached.len(), names.len());
    assert!(reached.contains(names.last().unwrap()));

    let office = build_one(&mut sim, Kind::Office, X0 + 12);
    assert_eq!(sim.reroll_subtype(office), None);
    assert_eq!(unit(&sim, office).subtype, None);
}

#[test]
fn a_subtype_changes_nothing_in_the_economy() {
    let drive = |name: &'static str| {
        let mut sim = built_tower(11);
        build_one(&mut sim, Kind::Office, X0);
        let ff = build_one(&mut sim, Kind::FastFood, X0 + 12);
        sim.tower.get_unit_mut(ff).unwrap().subtype = Some(name);
        hours(&mut sim, 24 * 14);
        let pending: Vec<f64> = sim.tower.units.iter().map(|u| u.pending_income).collect();
        (sim.money, pending)
    };
    assert_eq!(drive("Chinese Cafe"), drive("Hamburger Stand"));
}

/// A save with a shop at `X0`, each shop record rewritten by `edit`.
fn shop_save(edit: impl Fn(&mut Value)) -> (Simulation, Simulation) {
    let mut sim = built_tower(11);
    build_one(&mut sim, Kind::Shop, X0);
    let mut raw = sim.serialize();
    for u in raw["units"].as_array_mut().unwrap() {
        if u["kind"] == "shop" {
            edit(u);
        }
    }
    let loaded = deserialize(&raw).unwrap();
    (sim, loaded)
}

#[test]
fn a_subtype_survives_a_save_and_a_forged_or_missing_one_loads_as_none() {
    let (sim, loaded) = shop_save(|_| {});
    let at = |s: &Simulation| s.tower.unit_at(2, X0).unwrap().subtype;
    assert!(at(&sim).is_some());
    assert_eq!(at(&loaded), at(&sim));
    let (_, forged) = shop_save(|u| u["subtype"] = json!("Not A Canon Variant"));
    assert_eq!(at(&forged), None);
    let (_, legacy) = shop_save(|u| {
        u.as_object_mut().unwrap().remove("subtype");
    });
    assert_eq!(at(&legacy), None, "no roll on load");
}

#[test]
fn the_founding_seed_outlives_the_live_stream_and_an_old_save_falls_back() {
    let mut sim = seeded_game(987_654_321, GameMode::Classic);
    assert_eq!(sim.rng.initial_seed, 987_654_321);
    for _ in 0..10 {
        sim.rng.next();
    }
    assert_ne!(sim.rng.seed(), 987_654_321);
    assert_eq!(sim.rng.initial_seed, 987_654_321);
    assert_eq!(
        deserialize(&sim.serialize()).unwrap().rng.initial_seed,
        987_654_321
    );

    let old = seeded_game(24_680, GameMode::Classic);
    let mut raw = old.serialize();
    raw.as_object_mut().unwrap().remove("initialSeed");
    let stored = raw["seed"].as_u64().unwrap() as u32;
    assert_eq!(deserialize(&raw).unwrap().rng.initial_seed, stored);
}

/// A shop (or `kind`) on the served floor 2 at three stars, dropped back to
/// one star so no fire or bomb touches it, with two occupied offices.
fn venue(kind: Kind, offices: bool) -> (Simulation, i64) {
    let mut sim = built_tower(11);
    sim.money = 1e12;
    sim.star = 3;
    assert!(sim.build(kind, 2, X0).ok, "{kind:?}");
    let id = sim.tower.unit_at(2, X0).unwrap().id;
    sim.star = 1;
    if offices {
        for dx in [20, 30] {
            let office = sim.tower.place(Kind::Office, 2, X0 + dx).unit_id.unwrap();
            sim.tower.get_unit_mut(office).unwrap().state = UnitState::Occupied;
        }
    }
    (sim, id)
}

fn tallies(sim: &Simulation, id: i64) -> [Option<f64>; 4] {
    let e = unit(sim, id).extras();
    [
        e.patronage_today,
        e.patronage_yest,
        e.profit_today,
        e.profit_yest,
    ]
}

#[test]
fn a_venue_tallies_its_day_and_rolls_it_over_at_midnight() {
    let (mut full, shop) = venue(Kind::Shop, true);
    hours(&mut full, 24);
    let [_, yest, _, profit] = tallies(&full, shop);
    assert!(yest.unwrap_or(0.0) > 0.0 && profit.unwrap_or(0.0) > 0.0);

    let (mut sim, shop) = venue(Kind::Shop, true);
    hours(&mut sim, 8);
    let [today, yest, _, _] = tallies(&sim, shop);
    assert!(today.unwrap_or(0.0) > 0.0);
    assert_eq!(yest, None);
    hours(&mut sim, 24);
    let [today, yest, _, _] = tallies(&sim, shop);
    assert!(yest.unwrap_or(0.0) > 0.0);
    assert!(today.unwrap_or(0.0) < yest.unwrap());
}

#[test]
fn an_idle_venue_and_every_other_kind_keep_no_tallies() {
    let (mut idle, shop) = venue(Kind::Shop, false);
    for id in idle
        .tower
        .transports
        .iter()
        .map(|t| t.id)
        .collect::<Vec<_>>()
    {
        assert!(idle.tower.remove_transport(id).is_some());
    }
    hours(&mut idle, 48);
    assert!(unit(&idle, shop).is_operational());
    assert_eq!(tallies(&idle, shop)[..2], [None, None]);
    assert_eq!(tallies(&idle, shop)[3], None);

    for kind in [Kind::Office, Kind::Cinema, Kind::PartyHall] {
        let (mut sim, id) = venue(kind, false);
        hours(&mut sim, 24);
        assert_eq!(tallies(&sim, id), [None; 4], "{kind:?}");
    }
}

#[test]
fn tallies_survive_a_save_and_load_hardened() {
    let (mut sim, shop) = venue(Kind::Shop, true);
    hours(&mut sim, 26);
    let loaded = deserialize(&sim.serialize()).unwrap();
    let [t, y, _, p] = tallies(&sim, shop);
    let [lt, ly, _, lp] = tallies(&loaded, shop);
    assert!(y.is_some() && p.is_some());
    assert_eq!((lt, ly, lp), (t, y, p));

    let mut office = built_tower(11);
    build_one(&mut office, Kind::Office, X0);
    let mut raw = office.serialize();
    for u in raw["units"].as_array_mut().unwrap() {
        if u["kind"] == "office" {
            u["patronageToday"] = json!(999);
            u["profitYest"] = json!(999);
        }
    }
    let loaded = deserialize(&raw).unwrap();
    let id = loaded.tower.unit_at(2, X0).unwrap().id;
    assert_eq!(
        tallies(&loaded, id),
        [None; 4],
        "a leak onto a non-venue drops"
    );

    // A forged non-finite value (null in JSON text) reads as zero.
    let (_, forged) = shop_save(|u| {
        u["patronageToday"] = Value::Null;
        u["profitYest"] = json!("Infinity");
    });
    let id = forged.tower.unit_at(2, X0).unwrap().id;
    let [today, _, _, profit] = tallies(&forged, id);
    assert_eq!((today, profit), (Some(0.0), Some(0.0)));
}

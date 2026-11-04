//! Native tests for the rooms' evaluation and rent tiers (`room_tiers.rs`):
//! the cut points, the price ladders and bands, which rooms are listed, and
//! that the Satisfaction heatmap and the tiers agree on the rated rooms.
//! Helpers are in `tests.rs`.

use super::heatmap::HeatmapMode;
use super::room_tiers::{
    band_tier, eval_tier, rent_tier, EvalTier, RentTier, RoomTier, LADDER_TIERS,
};
use super::tests::{founded, heat, id_at, put};
use super::unit_detail::unit_price;
use crate::churn::household_price;
use crate::clock::GameMode;
use crate::econ::{classic_ladder, rent_config};
use crate::facilities::{Kind, FACILITIES};
use crate::rent::{is_neutral_price, ladder_level, snap_to_ladder, AVERAGE_RUNG};
use crate::satisfaction::{names_gripe, GRIPE_WARN, VACATE_RESCIND};
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A room's tiers as `room_tiers` lists them, or `None` when it is left out.
fn listed(sim: &Simulation, id: i64) -> Option<RoomTier> {
    sim.room_tiers().find(|t| t.id == id)
}

/// Put a tenant in unit `id` with satisfaction `score`.
fn tenant(sim: &mut Simulation, id: i64, score: f64) {
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = UnitState::Occupied;
    u.satisfaction = score;
}

fn eval_of(sim: &Simulation, id: i64) -> EvalTier {
    eval_tier(sim.tower.get_unit(id).unwrap())
}

fn rent_of(sim: &Simulation, id: i64) -> RentTier {
    rent_tier(sim.mode, sim.tower.get_unit(id).unwrap())
}

#[test]
fn the_tier_tables_list_every_tier_in_code_order() {
    for (i, t) in EvalTier::ALL.iter().enumerate() {
        assert_eq!(t.code(), i as f64, "{t:?}");
    }
    for (i, t) in RentTier::ALL.iter().enumerate() {
        assert_eq!(t.code(), i as f64, "{t:?}");
    }
    assert_eq!(
        EvalTier::ALL.map(EvalTier::name),
        ["unrated", "terrible", "good", "excellent"]
    );
    assert_eq!(
        RentTier::ALL.map(RentTier::name),
        ["unpriced", "noRate", "veryLow", "low", "average", "high"]
    );
}

#[test]
fn the_evaluation_cuts_at_the_keep_line_and_the_gripe_line() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    let office = id_at(&sim, 2, 160);
    assert_eq!(
        eval_of(&sim, office),
        EvalTier::Unrated,
        "nobody to rate it yet"
    );
    let cases = [
        (0.0, EvalTier::Terrible),
        (VACATE_RESCIND - 0.01, EvalTier::Terrible),
        (VACATE_RESCIND, EvalTier::Good),
        (GRIPE_WARN, EvalTier::Good),
        (GRIPE_WARN + 0.01, EvalTier::Excellent),
        (1.0, EvalTier::Excellent),
        (f64::NAN, EvalTier::Terrible),
    ];
    for (score, want) in cases {
        tenant(&mut sim, office, score);
        assert_eq!(eval_of(&sim, office), want, "satisfaction {score}");
    }
    // A tenant on notice is rated by its score like any other.
    tenant(&mut sim, office, 0.5);
    sim.tower.get_unit_mut(office).unwrap().state = UnitState::Vacating;
    assert_eq!(eval_of(&sim, office), EvalTier::Good);
    for state in [UnitState::Empty, UnitState::Construction, UnitState::Dirty] {
        sim.tower.get_unit_mut(office).unwrap().state = state;
        assert_eq!(eval_of(&sim, office), EvalTier::Unrated, "{state:?}");
    }
}

#[test]
fn every_room_state_has_its_evaluation_and_rent_tier() {
    // The SPEC's contract: a room that is not present is unrated but keeps
    // its rent tier by its stored price, a room moving in is rated by its
    // score, and a sold condo is priced by its asking price. The office sits
    // on the Very Low rung, so a tier that fell back to Average would fail.
    let mut sim = founded(GameMode::Classic, 3);
    put(&mut sim, Kind::Office, 2, 160);
    put(&mut sim, Kind::Condo, 3, 180);
    let (office, condo) = (id_at(&sim, 2, 160), id_at(&sim, 3, 180));
    let very_low = classic_ladder(Kind::Office).unwrap()[0];
    let u = sim.tower.get_unit_mut(office).unwrap();
    u.satisfaction = 0.5;
    u.rent = Some(very_low);
    let absent = [
        UnitState::Construction,
        UnitState::Empty,
        UnitState::Dirty,
        UnitState::Infested,
        UnitState::Fire,
        UnitState::Gutted,
    ];
    for state in absent {
        sim.tower.get_unit_mut(office).unwrap().state = state;
        let tiers = (eval_of(&sim, office), rent_of(&sim, office));
        assert_eq!(tiers, (EvalTier::Unrated, RentTier::VeryLow), "{state:?}");
    }
    sim.tower.get_unit_mut(office).unwrap().state = UnitState::MovingIn;
    let tiers = (eval_of(&sim, office), rent_of(&sim, office));
    assert_eq!(tiers, (EvalTier::Good, RentTier::VeryLow));
    let ladder = classic_ladder(Kind::Condo).unwrap();
    tenant(&mut sim, condo, 0.9);
    let u = sim.tower.get_unit_mut(condo).unwrap();
    u.ever_occupied = true;
    u.rent = Some(ladder[3]);
    let tiers = (eval_of(&sim, condo), rent_of(&sim, condo));
    assert_eq!(
        tiers,
        (EvalTier::Excellent, RentTier::High),
        "sold at the top rung"
    );
}

#[test]
fn a_sold_modern_condo_reads_its_asking_price() {
    // A Modern household pays a price scaled to its size, while the condo
    // keeps the asking price the player set, so the tier follows the asking
    // price: a condo sold at the neutral asking price to a household of 5
    // (which paid well over neutral) reads Average.
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Condo, 3, 180);
    let condo = id_at(&sim, 3, 180);
    let neutral = rent_config(Kind::Condo).unwrap().default;
    let household = Some(5);
    assert!(
        household_price(neutral, household) != neutral,
        "the household paid another price than the asking price"
    );
    tenant(&mut sim, condo, 0.9);
    let u = sim.tower.get_unit_mut(condo).unwrap();
    u.ever_occupied = true;
    u.residents = household;
    u.rent = Some(neutral);
    assert_eq!(rent_of(&sim, condo), RentTier::Average);
    sim.tower.get_unit_mut(condo).unwrap().rent = Some(neutral + 1.0);
    assert_eq!(rent_of(&sim, condo), RentTier::High);
}

#[test]
fn a_score_on_the_gripe_line_reads_good_and_names_a_gripe() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    let office = id_at(&sim, 2, 160);
    sim.tower.get_unit_mut(office).unwrap().rent = Some(20_000.0);
    let gripe = |sim: &mut Simulation| sim.diagnostic_facts(office).unwrap().gripe.is_some();
    tenant(&mut sim, office, GRIPE_WARN);
    assert!(names_gripe(GRIPE_WARN));
    assert_eq!(eval_of(&sim, office), EvalTier::Good);
    assert!(gripe(&mut sim), "the inspector names a gripe on the line");
    tenant(&mut sim, office, GRIPE_WARN + 0.01);
    assert_eq!(eval_of(&sim, office), EvalTier::Excellent);
    assert!(!gripe(&mut sim), "and none above it");
}

#[test]
fn hotel_rooms_and_venues_are_rated_and_service_rooms_are_not() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::HotelSingle, 2, 160);
    put(&mut sim, Kind::Shop, 3, 160);
    put(&mut sim, Kind::Security, 3, 200);
    let (hotel, shop, security) = (
        id_at(&sim, 2, 160),
        id_at(&sim, 3, 160),
        id_at(&sim, 3, 200),
    );
    tenant(&mut sim, hotel, 0.9);
    sim.tower.get_unit_mut(hotel).unwrap().state = UnitState::Asleep;
    tenant(&mut sim, shop, 0.2);
    tenant(&mut sim, security, 0.1);
    assert_eq!(
        eval_of(&sim, hotel),
        EvalTier::Excellent,
        "a sleeping guest rates"
    );
    assert_eq!(eval_of(&sim, shop), EvalTier::Terrible);
    assert_eq!(eval_of(&sim, security), EvalTier::Unrated);
    assert_eq!(
        rent_of(&sim, shop),
        RentTier::Unpriced,
        "a venue has no rent"
    );
    assert_eq!(listed(&sim, security), None, "neither tier, so not listed");
    let shop_row = listed(&sim, shop).expect("a rated venue is listed");
    assert_eq!((shop_row.floor, shop_row.x), (3, 160));
}

#[test]
fn classic_rent_tiers_are_the_rungs_the_editor_shows() {
    let mut sim = founded(GameMode::Classic, 3);
    put(&mut sim, Kind::Office, 2, 160);
    put(&mut sim, Kind::HotelSingle, 3, 160);
    put(&mut sim, Kind::Condo, 3, 180);
    let (office, hotel, condo) = (
        id_at(&sim, 2, 160),
        id_at(&sim, 3, 160),
        id_at(&sim, 3, 180),
    );
    // On the default each reads Average, even where the simulation's own
    // default (`ECON.rent`) is off the ladder, as the hotel room's is.
    for id in [office, hotel, condo] {
        assert_eq!(rent_of(&sim, id), RentTier::Average);
    }
    let rungs = classic_ladder(Kind::Office).unwrap();
    let want = [
        RentTier::VeryLow,
        RentTier::Low,
        RentTier::Average,
        RentTier::High,
    ];
    for (rung, tier) in rungs.iter().zip(want) {
        assert_eq!(sim.price_unit(office, *rung), Some(*rung));
        assert_eq!(rent_of(&sim, office), tier, "rung {rung}");
    }
    // A price a loaded save left between two rungs reads the nearer one,
    // ties going up, as the rung picker places it.
    sim.tower.get_unit_mut(office).unwrap().rent = Some(7_500.0);
    assert_eq!(rent_of(&sim, office), RentTier::Average);
    sim.tower.get_unit_mut(office).unwrap().rent = Some(3_000.0);
    assert_eq!(rent_of(&sim, office), RentTier::VeryLow);
    assert!(sim.set_no_rate(office));
    assert_eq!(rent_of(&sim, office), RentTier::NoRate);
    // A vacant priced room is listed for its rent alone.
    let row = listed(&sim, office).unwrap();
    assert_eq!((row.eval, row.rent), (EvalTier::Unrated, RentTier::NoRate));
}

#[test]
fn modern_rent_tiers_follow_the_band() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    put(&mut sim, Kind::FitnessClub, 3, 160);
    let (office, club) = (id_at(&sim, 2, 160), id_at(&sim, 3, 160));
    for id in [office, club] {
        assert_eq!(rent_of(&sim, id), RentTier::Average, "on the default");
    }
    let band = rent_config(Kind::Office).unwrap();
    let cases = [
        (band.default + band.step, RentTier::High),
        (band.max, RentTier::High),
        (band.default - band.step, RentTier::Low),
        (band.min + band.step, RentTier::Low),
        (band.min, RentTier::VeryLow),
        (band.default, RentTier::Average),
    ];
    for (price, want) in cases {
        assert_eq!(sim.price_unit(office, price), Some(price));
        assert_eq!(rent_of(&sim, office), want, "price {price}");
    }
    // A loaded save can carry a price under the band or No Rate on a band
    // kind, which no command sets.
    sim.tower.get_unit_mut(office).unwrap().rent = Some(band.min - 1.0);
    assert_eq!(rent_of(&sim, office), RentTier::VeryLow);
    sim.tower.get_unit_mut(office).unwrap().no_rate = true;
    assert_eq!(rent_of(&sim, office), RentTier::NoRate);
}

#[test]
fn a_modern_band_price_reads_average_only_on_the_neutral_price() {
    let band = rent_config(Kind::Office).unwrap();
    // Average is the batch reprice's exact "on the default" test, so a price
    // off the neutral price by any amount reads High above it and Low under
    // it, as the rent-too-high gripe and demand read it.
    assert!(is_neutral_price(band.default, band.default));
    let nudge = band.step / 1_000.0;
    let cases = [
        (band.default, RentTier::Average),
        (band.default + nudge, RentTier::High),
        (band.default - nudge, RentTier::Low),
        (band.min + nudge, RentTier::Low),
        (band.min, RentTier::VeryLow),
    ];
    for (price, want) in cases {
        assert_eq!(band_tier(band, price), want, "price {price}");
    }
}

#[test]
fn a_modern_price_that_is_not_finite_follows_the_band_rule() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    let office = id_at(&sim, 2, 160);
    let band = rent_config(Kind::Office).unwrap();
    assert!(
        band.over_neutral(f64::INFINITY),
        "the gripe fires on +infinity"
    );
    let cases = [
        (f64::NAN, RentTier::Average),
        (f64::INFINITY, RentTier::High),
        (f64::NEG_INFINITY, RentTier::VeryLow),
    ];
    for (price, want) in cases {
        sim.tower.get_unit_mut(office).unwrap().rent = Some(price);
        let u = sim.tower.get_unit(office).unwrap();
        assert_eq!(
            unit_price(GameMode::Modern, u).to_bits(),
            price.to_bits(),
            "the price reaches the tier unchanged"
        );
        assert_eq!(rent_of(&sim, office), want, "price {price}");
    }
}

#[test]
fn a_classic_price_that_is_not_finite_reads_the_average_rung() {
    let mut sim = founded(GameMode::Classic, 3);
    put(&mut sim, Kind::Office, 2, 160);
    let office = id_at(&sim, 2, 160);
    let rungs = classic_ladder(Kind::Office).unwrap();
    for price in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        sim.tower.get_unit_mut(office).unwrap().rent = Some(price);
        let u = sim.tower.get_unit(office).unwrap();
        let shown = unit_price(GameMode::Classic, u);
        assert!(!shown.is_finite(), "{price} reaches the tier unchanged");
        // The rung picker places it on the Average rung, so the tier does.
        assert_eq!(
            snap_to_ladder(&rungs, shown),
            rungs[AVERAGE_RUNG],
            "{price}"
        );
        assert_eq!(LADDER_TIERS[ladder_level(&rungs, shown)], RentTier::Average);
        assert_eq!(rent_of(&sim, office), RentTier::Average, "{price}");
    }
}

#[test]
fn every_classic_ladder_has_a_tier_for_each_rung() {
    let mut ladders = 0;
    for kind in FACILITIES.iter().map(|f| f.kind) {
        let Some(rungs) = classic_ladder(kind) else {
            continue;
        };
        ladders += 1;
        assert_eq!(rungs.len(), LADDER_TIERS.len(), "{kind:?}");
        for (place, rung) in rungs.iter().enumerate() {
            assert_eq!(ladder_level(&rungs, *rung), place, "{kind:?} {rung}");
            assert_eq!(RentTier::of_rung(place), LADDER_TIERS[place]);
        }
        // Prices off the ladder, below, between and above, land on a rung.
        let between = (rungs[0] + rungs[1]) / 2.0;
        for price in [rungs[0] - 1.0, between, rungs[3] + 1.0, f64::NAN] {
            assert!(ladder_level(&rungs, price) < LADDER_TIERS.len());
        }
    }
    assert_eq!(ladders, 5, "the five Classic priced kinds");
}

#[test]
fn the_average_rung_is_the_one_the_catalog_names_average() {
    // Checked against the catalog's own rung labels and the exported Classic
    // catalog's default price, which the catalog digest ties to TypeScript.
    assert_eq!(crate::catalog::RUNG_LABELS[AVERAGE_RUNG], "Average");
    assert_eq!(LADDER_TIERS[AVERAGE_RUNG], RentTier::Average);
    let catalog = crate::catalog::catalog_value(GameMode::Classic);
    let entries = catalog["facilities"].as_array().unwrap();
    let mut ladders = 0;
    for f in FACILITIES.iter() {
        let (kind, key) = (f.kind, f.key);
        let Some(rungs) = classic_ladder(kind) else {
            continue;
        };
        ladders += 1;
        let entry = entries.iter().find(|e| e["key"] == key).unwrap();
        assert_eq!(
            entry["rent"]["default"].as_f64(),
            Some(rungs[AVERAGE_RUNG]),
            "{kind:?}"
        );
        assert_eq!(
            entry["rent"]["rungs"][AVERAGE_RUNG]["label"], "Average",
            "{kind:?}"
        );
    }
    assert_eq!(ladders, 5);
}

#[test]
fn a_classic_tower_prices_only_its_ladder_kinds() {
    let sim = founded(GameMode::Classic, 1);
    let probe = sim.tower.units.first().unwrap().clone();
    for (kind, priced) in [
        (Kind::Office, true),
        (Kind::Condo, true),
        (Kind::HotelSuite, true),
        (Kind::FitnessClub, false),
        (Kind::RentalStudio, false),
        (Kind::Restaurant, false),
    ] {
        let mut u = probe.clone();
        u.kind = kind;
        let tier = rent_tier(GameMode::Classic, &u);
        assert_eq!(tier != RentTier::Unpriced, priced, "{kind:?}");
        assert_eq!(
            rent_tier(GameMode::Modern, &u) != RentTier::Unpriced,
            rent_config(kind).is_some(),
            "{kind:?} in Modern"
        );
    }
}

#[test]
fn the_list_keeps_the_room_order_and_matches_the_satisfaction_heatmap() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    put(&mut sim, Kind::Security, 2, 180);
    put(&mut sim, Kind::HotelDouble, 3, 160);
    put(&mut sim, Kind::FastFood, 3, 190);
    put(&mut sim, Kind::Office, 2, 200);
    for (floor, x, score) in [(2, 160, 0.3), (3, 190, 0.7), (2, 200, 0.5)] {
        let id = id_at(&sim, floor, x);
        tenant(&mut sim, id, score);
    }
    let rows: Vec<RoomTier> = sim.room_tiers().collect();
    let order: Vec<i64> = sim
        .tower
        .room_units()
        .map(|u| u.id)
        .filter(|id| rows.iter().any(|t| t.id == *id))
        .collect();
    assert_eq!(rows.iter().map(|t| t.id).collect::<Vec<_>>(), order);
    for t in &rows {
        let u = sim.tower.get_unit(t.id).unwrap();
        assert_eq!((t.floor, t.x), (u.floor, u.x));
    }
    assert!(listed(&sim, id_at(&sim, 2, 180)).is_none(), "security");
    let hotel = listed(&sim, id_at(&sim, 3, 160)).unwrap();
    assert_eq!(hotel.eval, EvalTier::Unrated, "an empty hotel room");
    let rated: Vec<(i64, i64)> = rows
        .iter()
        .filter(|t| t.eval != EvalTier::Unrated)
        .map(|t| (t.floor, t.x))
        .collect();
    let cells = heat(&sim, HeatmapMode::Satisfaction);
    let drawn: Vec<(i64, i64)> = cells
        .as_array()
        .unwrap()
        .iter()
        .map(|c| (c["floor"].as_i64().unwrap(), c["minX"].as_i64().unwrap()))
        .collect();
    assert_eq!(rated, drawn, "the heatmap draws exactly the rated rooms");
    assert_eq!(rated.len(), 3);
}

#[test]
fn reading_the_tiers_changes_nothing() {
    let mut sim = founded(GameMode::Classic, 3);
    put(&mut sim, Kind::Office, 2, 160);
    let office = id_at(&sim, 2, 160);
    tenant(&mut sim, office, 0.5);
    let before = sim.serialize();
    assert_eq!(sim.room_tiers().count(), 1);
    assert_eq!(sim.serialize(), before);
}

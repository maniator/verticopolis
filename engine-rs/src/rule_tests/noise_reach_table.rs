//! The same-floor noise table (`rules::NOISE_RULES`): the scan hears exactly
//! what the table says, as far as it says, and the catalog publishes the
//! table in Modern only, for the placement overlay (#1980).
use crate::catalog::{catalog, NoiseEntry};
use crate::clock::GameMode;
use crate::facilities::{Kind, FACILITIES};
use crate::rules::{noise_rule_for, NOISE_RULES};
use crate::sim::Simulation;

use super::{lay_row, put, unit};

fn floors(top: i64) -> Simulation {
    let mut sim = Simulation::new_game(11, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 5;
    lay_row(&mut sim, Kind::Lobby, 1);
    for floor in 2..=top {
        lay_row(&mut sim, Kind::Floor, floor);
    }
    sim
}

/// Whether a `listener` hears a `source` placed `gap` tiles past its right
/// edge, on a floor of their own.
fn hears(listener: Kind, source: Kind, gap: i64) -> bool {
    let mut sim = floors(2);
    let room = put(&mut sim, listener, 2, 40);
    put(&mut sim, source, 2, 40 + listener.facility().width + gap);
    let u = unit(&sim, room).clone();
    sim.noise_afflicted_fresh(&u)
}

#[test]
fn a_room_hears_one_rule_at_most() {
    for f in FACILITIES {
        let rules = NOISE_RULES.iter().filter(|r| r.heard_by(f.kind)).count();
        assert!(rules <= 1, "{} hears {rules} rules", f.key);
    }
}

#[test]
fn the_scan_hears_a_source_exactly_as_far_as_the_table_says() {
    let cases = [
        (Kind::Office, Kind::FastFood, Kind::Spa),
        (Kind::Condo, Kind::Office, Kind::Daycare),
        (Kind::HotelSingle, Kind::FastFood, Kind::Spa),
        (Kind::RentalApartment, Kind::Office, Kind::Daycare),
    ];
    for (listener, source, quiet) in cases {
        let rule = noise_rule_for(listener).expect("a listener has a rule");
        assert!(rule.made_by(source) && !rule.made_by(quiet));
        assert!(
            hears(listener, source, rule.tiles),
            "{listener:?} hears {source:?} at the band's edge"
        );
        assert!(
            !hears(listener, source, rule.tiles + 1),
            "{listener:?} does not hear {source:?} past it"
        );
        assert!(
            !hears(listener, quiet, 0),
            "{listener:?} does not hear {quiet:?} beside it"
        );
    }
    assert!(noise_rule_for(Kind::FastFood).is_none());
    assert!(
        !hears(Kind::FastFood, Kind::Office, 0),
        "a shop hears nothing"
    );
}

fn noise(mode: GameMode, kind: Kind) -> Vec<NoiseEntry> {
    let key = kind.facility().key;
    catalog(mode)
        .facilities
        .into_iter()
        .find(|f| f.key == key)
        .expect("listed")
        .noise
}

fn keys(of: impl Fn(Kind) -> bool) -> Vec<&'static str> {
    FACILITIES
        .iter()
        .filter(|f| of(f.kind))
        .map(|f| f.key)
        .collect()
}

#[test]
fn modern_publishes_each_rooms_reach_and_classic_none() {
    let office = noise(GameMode::Modern, Kind::Office);
    let homes = keys(|k| k.is_hotel() || k == Kind::Condo || k.is_rental());
    let venues = keys(Kind::is_noisy_venue);
    assert_eq!(
        office,
        vec![
            NoiseEntry {
                role: "hears",
                tiles: 11,
                kinds: venues.clone(),
            },
            NoiseEntry {
                role: "carries",
                tiles: 21,
                kinds: homes.clone(),
            },
        ]
    );
    assert_eq!(
        noise(GameMode::Modern, Kind::FastFood),
        vec![
            NoiseEntry {
                role: "carries",
                tiles: 11,
                kinds: vec![Kind::Office.facility().key],
            },
            NoiseEntry {
                role: "carries",
                tiles: 21,
                kinds: homes,
            },
        ]
    );
    let condo = noise(GameMode::Modern, Kind::Condo);
    assert_eq!(condo.len(), 1);
    assert_eq!((condo[0].role, condo[0].tiles), ("hears", 21));
    assert!(condo[0].kinds.contains(&"office") && condo[0].kinds.len() == venues.len() + 1);
    assert!(
        noise(GameMode::Modern, Kind::Spa).is_empty(),
        "the spa is quiet"
    );
    for f in FACILITIES {
        assert!(noise(GameMode::Classic, f.kind).is_empty(), "{}", f.key);
    }
}

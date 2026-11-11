//! Saves of the original played forward on purpose to watch its venue census
//! (#1500): TOWER5 and TOWER7 from `tdt-reddit`, and TOWER5 with five venues
//! built fresh. A loaded shop, fast food or restaurant counts the visitors its
//! retail row says it served yesterday, so each class adds up to the file's
//! finance block. Party halls and theatres count a set audience, 50 for a
//! hall and 40 per step of a theatre's film draw (byte 15 of its record),
//! and a theatre's draw falls as its film ages (#1932).
//! See `conformance/fixtures/tdt-observed/README.md`.

use std::path::PathBuf;

use verticopolis_engine::economy::visitors::{daily_visitor_cap, set_audience};
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::load::deserialize_tdt;
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::tdt::format::{
    population_class, POP_FAST_FOOD, POP_PARTY_HALL, POP_RESTAURANT, POP_SHOP, POP_THEATRE,
    TDT_POPULATION_CLASSES,
};
use verticopolis_engine::tdt::parse::parse_tdt;

const SAVES: [&str; 7] = [
    "T5O01.TDT",
    "T5O35.TDT",
    "T7O01.TDT",
    "T7O76.TDT",
    "FRESH0.TDT",
    "FRESH3A.TDT",
    "FRESH9A.TDT",
];

const RETAIL_CLASSES: [usize; 3] = [POP_SHOP, POP_FAST_FOOD, POP_RESTAURANT];

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../conformance/fixtures/tdt-observed")
        .join(name);
    std::fs::read(path).expect("fixture")
}

fn census_by_class(sim: &Simulation) -> [i64; TDT_POPULATION_CLASSES] {
    let mut by_class = [0; TDT_POPULATION_CLASSES];
    for u in sim.tower.room_units().filter(|u| u.is_present()) {
        if let Some(class) = population_class(u.kind) {
            by_class[class] += u.census_count();
        }
    }
    by_class
}

#[test]
fn a_loaded_venue_census_matches_the_file_class_by_class() {
    for name in SAVES {
        let parsed = parse_tdt(&fixture(name), name).expect("imports");
        let sim = deserialize_tdt(&parsed.save).expect("loads");
        let file = parsed.tower.tail.finance_population.expect("finance block");
        let ours = census_by_class(&sim);
        for class in RETAIL_CLASSES {
            assert!(
                file[class] > 0,
                "{name} class {class} has visitors in the file"
            );
            assert_eq!(ours[class], file[class], "{name} class {class}");
        }
    }
}

#[test]
fn a_played_venue_never_counts_more_than_its_cap() {
    for name in ["FRESH0.TDT", "T7O76.TDT"] {
        let parsed = parse_tdt(&fixture(name), name).expect("imports");
        let mut sim = deserialize_tdt(&parsed.save).expect("loads");
        for _ in 0..3 * 24 {
            sim.tick(60.0);
        }
        let mut counted = 0;
        for u in sim.tower.room_units().filter(|u| u.is_present()) {
            let Some(cap) = daily_visitor_cap(u.kind, true) else {
                continue;
            };
            counted += 1;
            assert!(
                (0..=cap).contains(&u.census_count()),
                "{name} {:?} at {},{}: {}",
                u.kind,
                u.floor,
                u.x,
                u.census_count()
            );
        }
        assert!(counted > 0, "{name} has venues");
    }
}

#[test]
fn a_loaded_hall_and_theatre_census_matches_the_file() {
    // T7O01: every theatre at draw 2 (4 x 120). T7O76: the draws fell to 0
    // but the census was saved before it caught up (4 x 80), so each theatre
    // takes an even share.
    for (name, halls, theatres) in [("T7O01.TDT", 200, 480), ("T7O76.TDT", 200, 320)] {
        let parsed = parse_tdt(&fixture(name), name).expect("imports");
        let sim = deserialize_tdt(&parsed.save).expect("loads");
        let file = parsed.tower.tail.finance_population.expect("finance block");
        assert_eq!(
            (file[POP_PARTY_HALL], file[POP_THEATRE]),
            (halls, theatres),
            "{name} file"
        );
        let ours = census_by_class(&sim);
        assert_eq!(ours[POP_PARTY_HALL], halls, "{name} halls");
        assert_eq!(ours[POP_THEATRE], theatres, "{name} theatres");
    }
}

#[test]
fn a_loaded_theatre_keeps_the_age_of_its_film() {
    // The venue table's days-shown byte: T7O01's films are five days old,
    // T7O76's nine (the day their draw fell to 0).
    for (name, days) in [("T7O01.TDT", 5), ("T7O76.TDT", 9)] {
        let parsed = parse_tdt(&fixture(name), name).expect("imports");
        let sim = deserialize_tdt(&parsed.save).expect("loads");
        let ages: Vec<_> = sim
            .tower
            .room_units()
            .filter(|u| u.kind == Kind::Cinema)
            .map(|u| u.extras().film_days)
            .collect();
        assert_eq!(ages, [Some(days); 4], "{name}");
    }
}

#[test]
fn a_played_hall_keeps_its_audience_and_a_theatre_loses_it_as_its_film_ages() {
    // T7O01's five-day-old films show a sixth night at full draw, then fade:
    // the original's own T7O04 and T7O13, played on from it, count 40 per
    // half (80) for each theatre.
    let name = "T7O01.TDT";
    let parsed = parse_tdt(&fixture(name), name).expect("imports");
    let mut sim = deserialize_tdt(&parsed.save).expect("loads");
    for _ in 0..3 * 24 {
        sim.tick(60.0);
    }
    let mut seen = [0; 2];
    for u in sim.tower.room_units() {
        let (slot, want) = match u.kind {
            Kind::PartyHall => (0, set_audience(Kind::PartyHall, 0)),
            Kind::Cinema => (1, set_audience(Kind::Cinema, 1)),
            _ => continue,
        };
        seen[slot] += 1;
        assert_eq!(
            u.visitors_yest.map(i64::from),
            want,
            "{:?} at {},{}",
            u.kind,
            u.floor,
            u.x
        );
    }
    assert_eq!(seen, [4, 4], "T7O01 has four halls and four theatres");
}

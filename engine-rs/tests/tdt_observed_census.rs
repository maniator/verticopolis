//! Saves of the original played forward on purpose to watch its venue census
//! (#1500): TOWER5 and TOWER7 from `tdt-reddit`, and TOWER5 with five venues
//! built fresh. A loaded shop, fast food or restaurant counts the visitors its
//! retail row says it served yesterday, so each class adds up to the file's
//! finance block. See `conformance/fixtures/tdt-observed/README.md`.

use std::path::PathBuf;

use verticopolis_engine::economy::visitors::daily_visitor_cap;
use verticopolis_engine::load::deserialize_tdt;
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::tdt::format::{
    population_class, POP_FAST_FOOD, POP_RESTAURANT, POP_SHOP, TDT_POPULATION_CLASSES,
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

fn retail_census(sim: &Simulation) -> [i64; TDT_POPULATION_CLASSES] {
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
        let ours = retail_census(&sim);
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

//! The nine real 1997 saves (see `tdt_real_saves.rs`) as a loaded, played tower:
//! import, load, a few game days, save, reload and export (#1534). The import
//! tests pin what the codec reads; this file pins what the engine does with it.
//! A known difference from the file is asserted at today's value and names its issue.

use std::path::PathBuf;

use serde_json::Value;
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::load::{deserialize, deserialize_tdt};
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::tdt::format::{
    population_class, POP_FAST_FOOD, POP_PARTY_HALL, POP_RESTAURANT, POP_SHOP, POP_THEATRE,
    TDT_POPULATION_CLASSES,
};
use verticopolis_engine::tdt::parse::{parse_tdt, ParsedLegacyTower};
use verticopolis_engine::tdt::{export_tdt, import_tdt};

const SAVES: [&str; 9] = [
    "TOWER1.TDT",
    "TOWER2.TDT",
    "TOWER3.TDT",
    "TOWER4.TDT",
    "TOWER5.TDT",
    "TOWER6.TDT",
    "TOWER7.TDT",
    "TOWER8.TDT",
    "MYTOWER.TDT",
];

/// Game days played before the save is taken.
const DAYS_PLAYED: usize = 3;

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit")
        .join(name);
    std::fs::read(path).expect("fixture")
}

fn parsed(name: &str) -> ParsedLegacyTower {
    parse_tdt(&fixture(name), name).expect("imports")
}

fn loaded(name: &str) -> (ParsedLegacyTower, Simulation) {
    let parsed = parsed(name);
    let sim = deserialize_tdt(&parsed.save).expect("loads");
    (parsed, sim)
}

/// Each elevator shaft with everything a reload must keep: kind, column, span,
/// the floors it skips, and whether its basement stops came from the file.
type Shaft = (String, i64, i64, i64, Vec<i64>, bool);

/// A floor number the engine keeps as a float. A fractional one would be
/// truncated by a plain cast and hide a change, so it fails here instead.
fn whole(floor: f64) -> i64 {
    assert_eq!(
        floor.fract(),
        0.0,
        "skip floor {floor} is not a whole floor"
    );
    floor as i64
}

fn elevators(sim: &Simulation) -> Vec<Shaft> {
    let mut out: Vec<Shaft> = sim
        .tower
        .transports
        .iter()
        .filter(|t| {
            matches!(
                t.kind,
                Kind::ElevatorStandard | Kind::ElevatorService | Kind::ElevatorExpress
            )
        })
        .map(|t| {
            let skips = t.skip_floors.iter().flatten().map(|f| whole(*f)).collect();
            (
                t.kind.as_str().to_string(),
                t.x,
                t.bottom,
                t.top,
                skips,
                t.preserve_basement_stops,
            )
        })
        .collect();
    out.sort();
    out
}

fn walkway_flights(sim: &Simulation) -> usize {
    sim.tower
        .transports
        .iter()
        .filter(|t| matches!(t.kind, Kind::Stairs | Kind::Escalator))
        .count()
}

/// People per population class, the way the HUD adds them up.
fn census_by_class(sim: &Simulation) -> [i64; TDT_POPULATION_CLASSES] {
    let mut by_class = [0; TDT_POPULATION_CLASSES];
    for unit in sim.tower.room_units().filter(|u| u.is_present()) {
        if let Some(class) = population_class(unit.kind) {
            by_class[class] += unit.census_count();
        }
    }
    by_class
}

fn play_days(sim: &mut Simulation, days: usize) {
    for _ in 0..days * 24 {
        sim.tick(60.0);
    }
}

#[test]
fn loading_keeps_every_shaft_flight_and_room_the_import_produced() {
    for name in SAVES {
        let (parsed, sim) = loaded(name);
        let save = &parsed.save;
        let shafts = save["transports"]
            .as_array()
            .expect("transports")
            .iter()
            .filter(|t| {
                t["kind"]
                    .as_str()
                    .is_some_and(|k| k.starts_with("elevator"))
            })
            .count();
        assert_eq!(elevators(&sim).len(), shafts, "{name} shafts after load");
        let flights = save["transports"].as_array().expect("transports").len() - shafts;
        assert_eq!(walkway_flights(&sim), flights, "{name} flights after load");
        assert_eq!(
            sim.tower.units.len(),
            save["units"].as_array().expect("units").len(),
            "{name} units after load"
        );
        // A catalog width that differs from the file's would show here, and
        // the codec reports none on any of the nine.
        assert_eq!(parsed.counts.width_mismatch, 0, "{name} width mismatches");
    }
}

#[test]
fn every_express_shaft_keeps_the_skipped_floors_the_file_wrote_after_load() {
    for name in SAVES {
        let (parsed, sim) = loaded(name);
        let imported = parsed.save["transports"].as_array().expect("transports");
        for source in imported.iter().filter(|t| t["kind"] == "elevatorExpress") {
            let (x, bottom, top) = (
                source["x"].as_i64().expect("x"),
                source["bottom"].as_i64().expect("bottom"),
                source["top"].as_i64().expect("top"),
            );
            let shaft = sim
                .tower
                .transports
                .iter()
                .find(|t| {
                    t.kind == Kind::ElevatorExpress
                        && t.x == x
                        && t.bottom == bottom
                        && t.top == top
                })
                .unwrap_or_else(|| panic!("{name}: express at x={x} survives the load"));
            // The whole lists, not a membership check over the span, so a stray
            // or fractional entry on either side fails instead of being skipped.
            let mut wrote: Vec<i64> = source["skipFloors"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|v| whole(v.as_f64().expect("a skip floor is a number")))
                        .collect()
                })
                .unwrap_or_default();
            let mut kept: Vec<i64> = shaft
                .skip_floors
                .iter()
                .flatten()
                .map(|f| whole(*f))
                .collect();
            wrote.sort();
            kept.sort();
            assert_eq!(
                kept, wrote,
                "{name}: express x={x} skipped floors after load"
            );
        }
    }
}

#[test]
fn the_loaded_census_matches_the_file_except_where_a_known_gap_says_otherwise() {
    for name in SAVES {
        let (parsed, sim) = loaded(name);
        // An empty tower (TOWER8) has no finance block worth reading.
        let file = parsed
            .tower
            .tail
            .finance_population
            .unwrap_or([0; TDT_POPULATION_CLASSES]);
        let ours = census_by_class(&sim);
        for class in 0..TDT_POPULATION_CLASSES {
            if is_known_census_gap(class) {
                // #1500: the file counts people inside, a loaded tower has nobody inside.
                assert_eq!(
                    ours[class], 0,
                    "{name} class {class}: the known gap moved; update #1500's row"
                );
            } else {
                assert_eq!(ours[class], file[class], "{name} class {class}");
            }
        }
    }
}

#[test]
fn the_census_gap_is_real_on_the_saves_that_have_those_rooms() {
    // Guards the test above: these classes are nonzero in the file.
    let file = parsed("TOWER7.TDT")
        .tower
        .tail
        .finance_population
        .expect("TOWER7 finance block");
    for class in [
        POP_SHOP,
        POP_FAST_FOOD,
        POP_RESTAURANT,
        POP_PARTY_HALL,
        POP_THEATRE,
    ] {
        assert!(file[class] > 0, "TOWER7 class {class}");
    }
}

/// Classes whose loaded count is not the file's (#1500): they count people
/// inside or an event audience, neither of which is saved.
fn is_known_census_gap(class: usize) -> bool {
    matches!(
        class,
        POP_SHOP | POP_FAST_FOOD | POP_RESTAURANT | POP_PARTY_HALL | POP_THEATRE
    )
}

/// What an exported file keeps of a shaft: kind, column, span and skipped floors.
type ShaftSpan = (String, i64, i64, i64, Vec<i64>);

fn spans(shafts: Vec<Shaft>) -> Vec<ShaftSpan> {
    shafts
        .into_iter()
        .map(|(kind, x, bottom, top, mut skips, _)| {
            skips.sort_unstable();
            (kind, x, bottom, top, skips)
        })
        .collect()
}

fn spans_in(save: &Value) -> Vec<ShaftSpan> {
    let mut out: Vec<ShaftSpan> = save["transports"]
        .as_array()
        .expect("transports")
        .iter()
        .filter(|t| {
            t["kind"]
                .as_str()
                .is_some_and(|k| k.starts_with("elevator"))
        })
        .map(|t| {
            let mut skips: Vec<i64> = t["skipFloors"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .map(|v| whole(v.as_f64().expect("a skip floor is a number")))
                        .collect()
                })
                .unwrap_or_default();
            skips.sort_unstable();
            (
                t["kind"].as_str().expect("kind").to_string(),
                t["x"].as_i64().expect("x"),
                t["bottom"].as_i64().expect("bottom"),
                t["top"].as_i64().expect("top"),
                skips,
            )
        })
        .collect();
    out.sort();
    out
}

/// A room as the tower keeps it: kind, floor, column, width and state.
type Room = (String, i64, i64, i64, String);

fn rooms_of(sim: &Simulation) -> Vec<Room> {
    let mut out: Vec<Room> = sim
        .tower
        .units
        .iter()
        .filter(|u| !u.kind.is_structural())
        .map(|u| {
            (
                u.kind.as_str().to_string(),
                u.floor,
                u.x,
                u.width,
                u.state.as_str().to_string(),
            )
        })
        .collect();
    out.sort();
    out
}

fn rooms_in(save: &Value) -> Vec<Room> {
    let mut out: Vec<Room> = save["units"]
        .as_array()
        .expect("units")
        .iter()
        .filter(|u| !matches!(u["kind"].as_str(), Some("floor" | "lobby")))
        .map(|u| {
            (
                u["kind"].as_str().expect("kind").to_string(),
                u["floor"].as_i64().expect("floor"),
                u["x"].as_i64().expect("x"),
                u["width"].as_i64().expect("width"),
                u["state"].as_str().expect("state").to_string(),
            )
        })
        .collect();
    out.sort();
    out
}

/// A state a played tower holds that a 1994 file cannot carry, with what the
/// room re-imports as. Anything else that differs is a regression.
fn is_known_state_loss(kind: &str, ours: &str, back: &str) -> bool {
    match (kind, ours, back) {
        // An event room that is running has no state in the file (#1500).
        ("cinema" | "partyHall", "occupied", "empty") => true,
        // An infested room exports as a dirty one (#1629, tdt-format.md 5.1).
        (hotel, "infested", "dirty") => hotel.starts_with("hotel"),
        _ => false,
    }
}

#[test]
fn a_played_save_reopens_and_exports_with_every_shaft_and_room_where_it_stood() {
    for name in SAVES {
        let (_, mut sim) = loaded(name);
        play_days(&mut sim, DAYS_PLAYED);
        assert!(sim.money.is_finite(), "{name} funds after play");
        assert!(sim.star >= 1, "{name} star after play");
        let shafts = elevators(&sim);
        let flights = walkway_flights(&sim);
        let rooms = rooms_of(&sim);
        let parking = parking_served(&sim);

        let saved = sim.serialize();
        let reopened = deserialize(&saved).expect("a played save reopens");
        assert_eq!(elevators(&reopened), shafts, "{name} shafts after reopen");
        assert_eq!(walkway_flights(&reopened), flights, "{name} flights");
        assert_eq!(rooms_of(&reopened), rooms, "{name} rooms after reopen");
        assert_eq!(
            parking_served(&reopened),
            parking,
            "{name} parking after reopen"
        );

        let bytes =
            export_tdt(&saved.to_string()).unwrap_or_else(|e| panic!("{name} exports: {e}"));
        let (again, _) = import_tdt(&bytes, name).expect("the export imports");
        let again: Value = serde_json::from_str(&again).expect("save json");
        assert_eq!(
            spans_in(&again),
            spans(shafts),
            "{name} shaft kind, column, span and skipped floors after export"
        );
        let back = rooms_in(&again);
        assert_eq!(back.len(), rooms.len(), "{name} rooms after export");
        for (ours, theirs) in rooms.iter().zip(&back) {
            assert_eq!(
                (&ours.0, ours.1, ours.2, ours.3),
                (&theirs.0, theirs.1, theirs.2, theirs.3),
                "{name}: a room moved, resized or changed kind in the export"
            );
            assert!(
                ours.4 == theirs.4 || is_known_state_loss(&ours.0, &ours.4, &theirs.4),
                "{name}: {} at floor {}, x={} went from {} to {} through the export",
                ours.0,
                ours.1,
                ours.2,
                ours.4,
                theirs.4
            );
        }
        let exported = deserialize_tdt(&again).expect("the exported tower loads");
        assert_eq!(
            parking_served(&exported),
            parking,
            "{name} connected stalls and floors after export and re-import"
        );
    }
}

#[test]
fn loading_keeps_each_unit_in_the_state_the_file_put_it() {
    // One entry per unit (rooms and the floor and lobby tiles), keyed by where
    // it stands, so a swap of two units' states would show.
    type Room = (String, i64, i64, i64, String);
    for name in SAVES {
        let (parsed, sim) = loaded(name);
        let mut from_file: Vec<Room> = parsed.save["units"]
            .as_array()
            .expect("units")
            .iter()
            .map(|u| {
                (
                    u["kind"].as_str().expect("kind").to_string(),
                    u["floor"].as_i64().expect("floor"),
                    u["x"].as_i64().expect("x"),
                    u["width"].as_i64().expect("width"),
                    u["state"].as_str().expect("state").to_string(),
                )
            })
            .collect();
        let mut ours: Vec<Room> = sim
            .tower
            .units
            .iter()
            .map(|u| {
                (
                    u.kind.as_str().to_string(),
                    u.floor,
                    u.x,
                    u.width,
                    u.state.as_str().to_string(),
                )
            })
            .collect();
        from_file.sort();
        ours.sort();
        assert_eq!(ours, from_file, "{name} room states after load");
    }
}

/// Stalls chained to a ramp, and the floors they stand on, as the engine counts
/// them: the HUD's parking number and the floors a car can reach.
fn parking_served(sim: &Simulation) -> (i64, Vec<i64>) {
    let chained = sim.tower.functional_parking_set();
    let mut floors: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| chained.contains(&u.id))
        .map(|u| u.floor)
        .collect();
    floors.sort();
    floors.dedup();
    (chained.len() as i64, floors)
}

/// Per save: stalls the file counts as connected, and the lowest and highest
/// floor they stand on (every floor between holds some). TOWER1 has 63 stalls
/// and the file connects 55: the far row is cut off from the ramp in the file too.
type ParkingRow = (&'static str, i64, Option<(i64, i64)>);

const PARKING_BASELINE: [ParkingRow; 9] = [
    ("TOWER1.TDT", 55, Some((-9, 0))),
    ("TOWER2.TDT", 281, Some((-8, 0))),
    ("TOWER3.TDT", 333, Some((-8, 0))),
    ("TOWER4.TDT", 333, Some((-8, 0))),
    ("TOWER5.TDT", 81, Some((-8, 0))),
    ("TOWER6.TDT", 81, Some((-8, 0))),
    ("TOWER7.TDT", 125, Some((-8, 0))),
    ("TOWER8.TDT", 0, None),
    ("MYTOWER.TDT", 174, Some((-8, 0))),
];

#[test]
fn a_loaded_tower_connects_exactly_the_stalls_and_floors_the_file_does() {
    assert_eq!(PARKING_BASELINE.map(|row| row.0), SAVES, "one row per save");
    for (name, connected, floors) in PARKING_BASELINE {
        let (parsed, sim) = loaded(name);
        assert_eq!(
            parsed.tower.tail.parking_connected,
            Some(connected),
            "{name}: the baseline is what the file says"
        );
        let (ours, served) = parking_served(&sim);
        assert_eq!(ours, connected, "{name}: stalls connected after load");
        let expected: Vec<i64> = floors.map_or(vec![], |(low, high)| (low..=high).collect());
        assert_eq!(served, expected, "{name}: floors with a connected stall");
    }
}

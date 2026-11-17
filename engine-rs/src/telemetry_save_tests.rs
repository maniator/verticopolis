//! The elevators' load rings in a save: carried only with a shaft on Auto,
//! read back for the shafts the tower has, and a malformed entry skipped.

use serde_json::json;

use crate::clock::GameMode;
use crate::load::deserialize;
use crate::schedule_authoring::tests::{tower, warm_ring};

#[test]
fn the_rings_ride_a_save_with_a_shaft_on_auto_and_read_back() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    let sampled: Vec<bool> = (0..24).map(|h| (8..14).contains(&h)).collect();
    let doc = json!({ "hourly": [[id, { "weekday": warm_ring(0.37), "weekend": warm_ring(0.0),
                                         "weekdaySampled": sampled, "weekendSampled": sampled }]] });
    sim.seed_telemetry(&doc).unwrap();
    let save = sim.serialize();
    let entry = &save["elevatorLoad"][0];
    assert_eq!(entry[0], id);
    assert_eq!(entry[1]["weekdayHours"], json!([8, 9, 10, 11, 12, 13]));
    let back = deserialize(&save).unwrap();
    assert_eq!(back.telemetry.hourly, sim.telemetry.hourly);
    assert_eq!(back.serialize(), save);
}

#[test]
fn a_tower_off_auto_saves_no_rings() {
    let (mut sim, id) = tower(GameMode::Modern, 8);
    sim.tower.transports[0].schedule = None;
    let doc = json!({ "hourly": [[id, { "weekday": warm_ring(0.5), "weekend": warm_ring(0.5) }]] });
    sim.seed_telemetry(&doc).unwrap();
    assert!(sim.serialize().get("elevatorLoad").is_none());
    let (classic, _) = tower(GameMode::Classic, 8);
    assert!(classic.serialize().get("elevatorLoad").is_none());
}

#[test]
fn a_malformed_or_stray_entry_is_skipped() {
    let (sim, id) = tower(GameMode::Modern, 8);
    let mut save = sim.serialize();
    let good = json!({ "weekday": vec![0.5; 24], "weekend": vec![0.0; 24],
                       "weekdayHours": [9], "weekendHours": [] });
    save["elevatorLoad"] = json!([
        [id + 1000, good],
        [id, { "weekday": vec![0.5; 23], "weekend": vec![0.0; 24],
               "weekdayHours": [], "weekendHours": [] }],
        [id, { "weekday": vec![2.0; 24], "weekend": vec![0.0; 24],
               "weekdayHours": [], "weekendHours": [] }],
        [id, { "weekday": vec![0.5; 24], "weekend": vec![0.0; 24],
               "weekdayHours": [24], "weekendHours": [] }],
        "nonsense",
    ]);
    let back = deserialize(&save).expect("a bad entry never fails the load");
    assert!(back.telemetry.hourly.is_empty(), "every entry was skipped");
    save["elevatorLoad"] = json!([[id, good]]);
    let back = deserialize(&save).unwrap();
    let rings = &back.telemetry.hourly[&id];
    assert_eq!(rings.weekday[9], 0.5);
    assert!(rings.weekday_sampled[9] && !rings.weekday_sampled[8]);
}

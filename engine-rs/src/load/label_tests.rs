//! A room's label as a save carries it (#380): the Double Room's old default
//! name reads as the Twin Room, and a name the player chose stays.

use serde_json::json;

use super::unit_from_value;
use crate::facilities::Kind;

fn label_of(kind: &str, label: Option<&str>) -> String {
    let mut u = json!({"kind": kind, "floor": 5, "x": 10, "state": "empty"});
    if let Some(l) = label {
        u["label"] = json!(l);
    }
    unit_from_value(&u, false).expect("the room loads").0.label
}

#[test]
fn a_saved_double_room_label_reads_as_the_twin_room() {
    assert_eq!(Kind::HotelDouble.facility().name, "Twin Room");
    assert_eq!(label_of("hotelDouble", Some("Double Room")), "Twin Room");
    assert_eq!(label_of("hotelDouble", None), "Twin Room");
}

#[test]
fn a_chosen_name_stays_and_other_kinds_keep_theirs() {
    assert_eq!(label_of("hotelDouble", Some("Honeymoon")), "Honeymoon");
    assert_eq!(label_of("hotelDouble", Some("double room")), "double room");
    assert_eq!(label_of("hotelSingle", Some("Double Room")), "Double Room");
}

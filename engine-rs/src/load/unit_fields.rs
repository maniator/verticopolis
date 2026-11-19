//! A saved unit's fields, found in one pass over its object.
//!
//! `unit_from_value` reads about thirty keys of each unit. Asking the object
//! for each key hashes the key and probes the map every time, which was about
//! a third of loading a maxed tower (callgrind, 2026-11-19). One walk over the
//! entries, matching each key by its spelling, finds the same values: a map
//! holds each key once (a repeated key in the text keeps its last value, as
//! `get` would read), and a unit that is no object has no fields either way.

use serde_json::Value;

macro_rules! unit_fields {
    ($($field:ident = $key:literal),* $(,)?) => {
        /// The value each key the loader reads holds in one saved unit, or
        /// `None` where the unit has no such key: `u.get(key)` for each.
        #[derive(Default)]
        pub(super) struct UnitFields<'a> {
            $(pub(super) $field: Option<&'a Value>,)*
        }

        impl<'a> UnitFields<'a> {
            pub(super) fn of(unit: &'a Value) -> Self {
                let mut fields = Self::default();
                if let Some(entries) = unit.as_object() {
                    for (key, value) in entries {
                        match key.as_str() {
                            $($key => fields.$field = Some(value),)*
                            _ => {}
                        }
                    }
                }
                fields
            }

            /// Every key read here, with the value found for it.
            #[cfg(test)]
            pub(super) fn found(&self) -> Vec<(&'static str, Option<&'a Value>)> {
                vec![$(($key, self.$field)),*]
            }
        }
    };
}

unit_fields! {
    kind = "kind",
    id = "id",
    floor = "floor",
    x = "x",
    width = "width",
    state = "state",
    ever_occupied = "everOccupied",
    rent = "rent",
    residents = "residents",
    film_policy = "filmPolicy",
    subtype_name = "subtype",
    no_rate = "noRate",
    satisfaction = "satisfaction",
    occupants = "occupants",
    visitors_yest = "visitorsYest",
    pending_income = "pendingIncome",
    label_text = "label",
    vacate_reason = "vacateReason",
    vacate_at = "vacateAt",
    film_days = "filmDays",
    film_classic = "filmClassic",
    film_blockbuster = "filmBlockbuster",
    ticket_price = "ticketPrice",
    screen2 = "screen2",
    patronage_today = "patronageToday",
    patronage_yest = "patronageYest",
    profit_today = "profitToday",
    profit_yest = "profitYest",
    complete_at = "completeAt",
    dirty_days = "dirtyDays",
}

#[cfg(test)]
mod tests {
    use super::UnitFields;
    use serde_json::{json, Value};

    /// Each field is what asking the object for its key returns.
    fn agrees(unit: &Value) {
        for (key, found) in UnitFields::of(unit).found() {
            assert_eq!(found, unit.get(key), "{key} in {unit}");
        }
    }

    #[test]
    fn every_field_is_the_value_its_key_holds() {
        agrees(&json!({ "kind": "office", "floor": 3, "x": 10, "state": "occupied" }));
        agrees(&json!({}));
        agrees(&json!([1, 2, 3]));
        agrees(&json!(null));
        // A repeated key keeps its last value, in the parsed map and here.
        let repeated: Value =
            serde_json::from_str(r#"{"kind":"office","floor":2,"floor":9}"#).unwrap();
        assert_eq!(UnitFields::of(&repeated).floor, Some(&json!(9)));
        agrees(&repeated);
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
        let mut towers = 0;
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|x| x != "vctower") {
                continue;
            }
            towers += 1;
            let text = std::fs::read_to_string(&path).unwrap();
            let save = crate::load::decode_vctower(&text).unwrap();
            for unit in save["units"].as_array().into_iter().flatten() {
                agrees(unit);
            }
        }
        assert!(towers > 0, "the committed towers are read");
    }
}

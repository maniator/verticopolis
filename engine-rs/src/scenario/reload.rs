//! What the `reload` command holds a save round trip to.
//!
//! The state view must come back unchanged, with one allowed difference: a
//! load adopts every milestone already met, silently, and milestones are only
//! checked once a day, so a reload shortly after a condition becomes true
//! comes back with that milestone added (#1711). Everything else is compared
//! as before, and the milestones the game already held must come back first,
//! in order, so a milestone that is lost, changed or reordered still fails.

use crate::canonical::digest;
use serde_json::Value;

fn milestones(view: &Value) -> Option<&Vec<Value>> {
    view.get("milestones").and_then(Value::as_array)
}

fn without_milestones(view: &Value) -> Value {
    let mut rest = view.clone();
    if let Some(fields) = rest.as_object_mut() {
        fields.remove("milestones");
    }
    rest
}

/// Whether the loaded view differs from the saved one in anything but
/// milestones added by the load.
pub(super) fn reload_changed(before: &Value, after: &Value) -> bool {
    match (milestones(before), milestones(after)) {
        (Some(held), Some(loaded)) => {
            !loaded.starts_with(held)
                || digest(&without_milestones(before)) != digest(&without_milestones(after))
        }
        _ => digest(before) != digest(after),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn view(milestones: Value, money: i64) -> Value {
        json!({"milestones": milestones, "money": money})
    }

    #[test]
    fn an_unchanged_view_is_not_a_change() {
        let v = view(json!(["pop-500"]), 5);
        assert!(!reload_changed(&v, &v.clone()));
    }

    #[test]
    fn a_milestone_the_load_adds_is_not_a_change() {
        let before = view(json!(["pop-500"]), 5);
        let after = view(json!(["pop-500", "cinema"]), 5);
        assert!(!reload_changed(&before, &after));
        assert!(!reload_changed(&view(json!([]), 5), &after));
    }

    #[test]
    fn a_lost_changed_or_reordered_milestone_is_a_change() {
        let before = view(json!(["pop-500", "cinema"]), 5);
        assert!(reload_changed(&before, &view(json!(["pop-500"]), 5)));
        assert!(reload_changed(
            &before,
            &view(json!(["pop-500", "metro"]), 5)
        ));
        assert!(reload_changed(
            &before,
            &view(json!(["cinema", "pop-500"]), 5)
        ));
    }

    #[test]
    fn any_other_field_still_counts_even_beside_an_added_milestone() {
        let before = view(json!(["pop-500"]), 5);
        assert!(reload_changed(&before, &view(json!(["pop-500"]), 6)));
        assert!(reload_changed(
            &before,
            &view(json!(["pop-500", "cinema"]), 6)
        ));
    }

    #[test]
    fn a_view_without_the_milestone_list_is_compared_whole() {
        assert!(!reload_changed(&json!({"money": 1}), &json!({"money": 1})));
        assert!(reload_changed(&json!({"money": 1}), &json!({"money": 2})));
    }
}

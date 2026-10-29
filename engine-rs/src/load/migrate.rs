//! The migration driver: runs each version step in turn.

use super::*;

pub(super) fn is_game_mode(v: Option<&Value>) -> bool {
    matches!(v.and_then(Value::as_str), Some("classic") | Some("modern"))
}

/// `migrateSave(data)`.
pub fn migrate_save(data: &Value) -> Value {
    migrate_save_owned(data.clone())
}

/// `migrate_save` on a save this call owns. The steps that only set a key
/// set it in place, so an old save is held once, not once per step: a
/// version 4 tower of 12,000 units peaked at eleven times what it keeps.
pub fn migrate_save_owned(data: Value) -> Value {
    let raw_version = data.get("version").and_then(Value::as_f64);
    let valid = raw_version
        .is_some_and(|v| v.is_finite() && v.fract() == 0.0 && v >= OLDEST_SAVE_VERSION as f64);
    let version = if valid {
        raw_version.unwrap()
    } else {
        OLDEST_SAVE_VERSION as f64
    };
    let mut migrated = if raw_version == Some(version) {
        data
    } else {
        with_owned(data, vec![("version", json!(version))])
    };
    if !is_game_mode(migrated.get("mode")) {
        if let Some(Value::Array(units)) = migrated.get_mut("units") {
            for u in units.iter_mut() {
                let sold_shell = u.is_object()
                    && kind_of(u) == Some(Kind::Condo)
                    && u.get("everOccupied") == Some(&Value::Bool(true))
                    && u.get("rent").is_none()
                    && u.get("state").and_then(Value::as_str).unwrap_or("empty") != "empty"
                    && u.get("state").and_then(Value::as_str) != Some("gutted")
                    && u.get("state").and_then(Value::as_str) != Some("construction");
                if let (true, Some(unit)) = (sold_shell, u.as_object_mut()) {
                    unit.insert("rent".to_string(), json!(LEGACY_CONDO_DEFAULT_PRICE));
                }
            }
        }
    }
    let v = |m: &Value| version_of(m);
    if v(&migrated) == Some(1.0) {
        migrated = upgrade_v1_to_v2(&migrated);
    }
    if v(&migrated) == Some(2.0) {
        migrated = with_owned(migrated, vec![("version", json!(3))]);
    }
    if v(&migrated) == Some(3.0) {
        migrated = with_owned(migrated, vec![("version", json!(4))]);
    }
    if v(&migrated) == Some(4.0) {
        migrated = with_owned(migrated, vec![("version", json!(5))]);
        widen_shafts_in_place(&mut migrated);
    }
    if v(&migrated) == Some(5.0) {
        migrated = expand_legacy_party_halls(&migrated);
    }
    if v(&migrated) == Some(6.0) {
        migrated = with_owned(migrated, vec![("version", json!(7))]);
    }
    // `load_stream.rs` applies this step to a current save on its own, so a
    // step added here for version 7 goes there too.
    if v(&migrated) == Some(7.0) {
        widen_shafts_in_place(&mut migrated);
    }
    migrated
}

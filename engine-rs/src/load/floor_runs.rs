//! Reading the floor runs a version 11 save writes (`save_floor_runs`).
//!
//! A run's entry is its first floor tile with a `run` count. Unfolding it
//! hands the loader one entry per tile, the first tile's entry with its `id`
//! and `x` stepped one at a time, so every tile goes through the same
//! conversion and the same clamps as a tile a version 10 save lists on its
//! own. An entry that is not a floor tile, or whose `run` is not a whole
//! number from 2 to the lot's width, or whose `id` or `x` is not a whole
//! number, stands for itself alone, as it would in an older build. A save
//! from before version 11 never unfolds a run.

use std::borrow::Cow;

use super::*;
use crate::save_floor_runs::{FLOOR_RUN_KEY, FLOOR_RUN_SAVE_VERSION};

/// Whether a save of this version writes floor runs.
pub(crate) fn reads_floor_runs(version: Option<f64>) -> bool {
    version.is_some_and(|v| v >= FLOOR_RUN_SAVE_VERSION as f64)
}

/// A whole number held as a JSON number, or `None`.
fn whole(v: Option<&Value>) -> Option<i64> {
    let n = v?.as_f64()?;
    (n.is_finite() && n.fract() == 0.0 && n.abs() <= MAX_SAFE_INTEGER).then_some(n as i64)
}

/// The run an entry opens: its first tile's id and x and how many tiles it
/// holds, or `None` for an entry that stands for itself alone.
fn run_of(entry: &Value) -> Option<(i64, i64, usize)> {
    if kind_of(entry) != Some(Kind::Floor) {
        return None;
    }
    let tiles = whole(entry.get(FLOOR_RUN_KEY))?;
    if !(2..=LOT).contains(&tiles) {
        return None;
    }
    let id = whole(entry.get("id"))?;
    let x = whole(entry.get("x"))?;
    Some((id, x, tiles as usize))
}

/// How many units a listed entry stands for: 1, or its run's tiles when the
/// save writes runs (`runs`).
pub(crate) fn listed_units(entry: &Value, runs: bool) -> usize {
    match run_of(entry) {
        Some((_, _, tiles)) if runs => tiles,
        _ => 1,
    }
}

/// Calls `each` with every unit entry `entry` stands for, in list order:
/// the entry itself, or, for a run in a save that writes runs, one entry
/// per tile. Stops early when `each` returns false.
pub(crate) fn each_listed_unit(entry: &Value, runs: bool, mut each: impl FnMut(&Value) -> bool) {
    let run = if runs { run_of(entry) } else { None };
    let Some((id, x, tiles)) = run else {
        each(entry);
        return;
    };
    let mut tile = entry.clone();
    for k in 0..tiles as i64 {
        if let Some(m) = tile.as_object_mut() {
            m.remove(FLOOR_RUN_KEY);
            m.insert("id".into(), json!(id + k));
            m.insert("x".into(), json!(x + k));
        }
        if !each(&tile) {
            return;
        }
    }
}

/// The tile `k` steps into the run `entry` opens (first tile `id` and `x`):
/// the entry without its run, at the tile's own id and x.
fn tile_of(entry: &Value, id: i64, x: i64) -> Value {
    let mut tile = entry.clone();
    if let Some(m) = tile.as_object_mut() {
        m.remove(FLOOR_RUN_KEY);
        m.insert("id".into(), json!(id));
        m.insert("x".into(), json!(x));
    }
    tile
}

/// A save's `units` entries with every run unfolded, in list order, for a
/// reader that walks the list as written (the `.TDT` export). An entry that
/// stands for itself is lent as it is, and a run's tiles are made one at a
/// time, so the list is never copied whole. Like the loader, it stops past
/// [`UNIT_CAP`] units, more than a real tower holds.
pub(crate) fn unfolded_units(save: &Value) -> Option<impl Iterator<Item = Cow<'_, Value>>> {
    let listed = save.get("units").and_then(Value::as_array)?;
    let runs = reads_floor_runs(version_of(save));
    let tiles = listed.iter().flat_map(move |entry| {
        let run = if runs { run_of(entry) } else { None };
        let (id, x, count) = run.unwrap_or((0, 0, 0));
        let alone = run.is_none().then_some(Cow::Borrowed(entry));
        let unfolded = (0..count as i64).map(move |k| Cow::Owned(tile_of(entry, id + k, x + k)));
        alone.into_iter().chain(unfolded)
    });
    Some(tiles.take(UNIT_CAP + 1))
}

#[cfg(test)]
#[path = "floor_runs_tests.rs"]
mod tests;

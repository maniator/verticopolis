//! Guards that repair a save before it is read.

use super::*;

pub(super) fn sane_id(v: Option<&Value>) -> Option<i64> {
    let x = v.and_then(Value::as_f64)?;
    if x.is_finite() && x.fract() == 0.0 && x > 0.0 && x < 2147483648.0 {
        Some(x as i64)
    } else {
        None
    }
}

/// `repairEntityIds`: hand corrupt or duplicate ids a fresh one; returns nextId.
pub(super) fn repair_entity_ids(
    unit_ids: &mut [Option<i64>],
    transport_ids: &mut [Option<i64>],
    raw_next_id: Option<&Value>,
) -> i64 {
    let mut max_loaded = 0;
    for id in unit_ids.iter().chain(transport_ids.iter()).flatten() {
        if *id > max_loaded {
            max_loaded = *id;
        }
    }
    let mut seen: HashSet<i64> = HashSet::with_capacity(unit_ids.len() + transport_ids.len());
    for id in unit_ids.iter_mut().chain(transport_ids.iter_mut()) {
        match id {
            Some(v) if !seen.contains(v) => {}
            _ => {
                max_loaded += 1;
                *id = Some(max_loaded);
            }
        }
        seen.insert(id.unwrap());
    }
    let saved = sane_id(raw_next_id).unwrap_or(0);
    saved.max(max_loaded + 1)
}

/// `dropOverlappingUnits`: first kept wins, per layer. The units and their
/// saved ids are filtered in place, so the filter never holds a second copy
/// of the units.
pub(super) fn drop_overlapping_units(units: &mut Vec<Unit>, ids: &mut Vec<Option<i64>>) {
    debug_assert_eq!(units.len(), ids.len());
    // A tile grid of the whole lot per layer, indexed by floor and x, where
    // `dropOverlappingUnits` keeps one row per floor in a map. A unit's floor
    // and span are clamped to the lot when it is read.
    let lot = LOT as usize;
    let grid = || vec![0u8; (MAX_FLOOR - MIN_FLOOR + 1) as usize * lot];
    let (mut claimed_structure, mut claimed_rooms) = (grid(), grid());
    let tile = |f: i64, i: i64| (f - MIN_FLOOR) as usize * lot + i as usize;
    let mut keep = Vec::with_capacity(units.len());
    for u in units.iter() {
        let layer = if u.kind.is_structural() {
            &mut claimed_structure
        } else {
            &mut claimed_rooms
        };
        let floors = u.floor..u.floor + u.kind.floors();
        debug_assert!(
            u.floor >= MIN_FLOOR && floors.end - 1 <= MAX_FLOOR && u.x >= 0 && u.x + u.width <= LOT,
            "a unit off the lot: {u:?}"
        );
        let free = floors
            .clone()
            .all(|f| (u.x..u.x + u.width).all(|i| layer[tile(f, i)] == 0));
        keep.push(free);
        if !free {
            continue;
        }
        for f in floors {
            for i in u.x..u.x + u.width {
                layer[tile(f, i)] = 1;
            }
        }
    }
    let mut kept = keep.iter();
    units.retain(|_| *kept.next().unwrap());
    let mut kept = keep.iter();
    ids.retain(|_| *kept.next().unwrap());
}

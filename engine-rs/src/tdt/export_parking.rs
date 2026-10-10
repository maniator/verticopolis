//! The parking block's connected-stall count for a `.TDT` export
//! (`tdtExportParking.ts`): stalls chained to a ramp on their own floor.

use indexmap::IndexMap;

use super::export_gather::{FloorKey, GatheredRoom};
use crate::facilities::Kind;

pub fn connected_stall_count(rooms: &[GatheredRoom]) -> i64 {
    let mut by_floor: IndexMap<FloorKey, Vec<(f64, f64, bool)>> = IndexMap::new();
    for u in rooms {
        if u.kind != Kind::Parking && u.kind != Kind::ParkingRamp {
            continue;
        }
        if !u.emitted {
            continue;
        }
        by_floor.entry(FloorKey::of(u.floor)).or_default().push((
            u.x,
            u.width,
            u.kind == Kind::ParkingRamp,
        ));
    }
    let mut connected = 0;
    for arr in by_floor.values_mut() {
        arr.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let mut linked: Vec<bool> = arr.iter().map(|it| it.2).collect();
        for i in 1..arr.len() {
            if !linked[i] && linked[i - 1] && arr[i - 1].0 + arr[i - 1].1 >= arr[i].0 {
                linked[i] = true;
            }
        }
        for i in (0..arr.len().saturating_sub(1)).rev() {
            if !linked[i] && linked[i + 1] && arr[i].0 + arr[i].1 >= arr[i + 1].0 {
                linked[i] = true;
            }
        }
        for (i, it) in arr.iter().enumerate() {
            if linked[i] && !it.2 {
                connected += 1;
            }
        }
    }
    connected
}

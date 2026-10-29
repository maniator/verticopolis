//! The gather pass of the `.TDT` export (`tdtExportGather.ts`): walk the
//! serialized tower into per-floor tenant records, paving spans, header
//! aggregate counts and a people census, without writing any bytes.
//!
//! The input is the save as JSON, which is any JavaScript value the
//! TypeScript exporter would accept, so each field is read the way its
//! TypeScript site reads it. There are three readers, and they are
//! deliberately different:
//!
//! - `js_finite` is `Number.isFinite(v)`, which never coerces: a string, a
//!   boolean or `null` is simply not a finite number. It serves every site
//!   that guards with `Number.isFinite` (`money`, `lastQuarterMoney`, `star`,
//!   the view's `tile` and `floor`, a transport's `x`, `bottom`, `top`,
//!   `cars` and `carPositions`, a household's `residents`, and the extent of
//!   a room that writes no record) and the `skipFloors` `Set`, whose
//!   SameValueZero membership only a number can satisfy.
//! - `js_num` is `Number(v)`, for the sites that do arithmetic on the raw
//!   value and so coerce it: a unit's `occupants` (`Math.max(occupants, 1)`),
//!   its `rent` (`rent - anchor` in `classFromRent`), and the clock's
//!   `minutes` (`minutes % 1440`, read in `encoder.rs`).
//! - `js_num_raw_site` serves the three unit fields the TypeScript gather
//!   keeps raw: a unit's `floor`, `x` and `width`. It is the reading those
//!   sites had before round 3 of the #881 review, kept on purpose; see its
//!   own doc for where it parts from `Number()` (#884).
//!
//! A NaN in the live save crosses the WASM surface as JSON `null`, so `null`
//! is the shape these sites see most: `Number.isFinite(null)` is false, while
//! `Number(null)` is 0, which is why `js_finite` and the coercing readers
//! cannot be swapped. Floors are keyed as doubles (`FloorKey`), the way the
//! TypeScript `Map`s key a numeric floor. A floor that is not a number (a
//! forged save only; the loader keeps floors finite) keys the TypeScript
//! `Map` by its raw value and is coerced here by `js_num_raw_site`, so those
//! saves write different bytes (#884).

use std::borrow::Borrow;

use indexmap::IndexMap;
use serde_json::Value;

use super::export_tables::{class_from_rent, kind_tenant, part_stack, OutTenant};
use super::format::TDT_FLOOR_OFFSET;
use super::tables::{
    is_priced, rent_from_class, HOTEL_ASLEEP_FLAG, HOTEL_DIRTY_FLAG, HOTEL_OCCUPANT_MASK,
};
use super::LegacyExportError;
use crate::econ::rent_config;
use crate::facilities::{is_lobby_floor, Kind, LOT_WIDTH, MIN_FLOOR};

mod gathered;
mod normalize;
mod values;

pub use gathered::{ExportCounts, ExportHeaderCounts, GatheredRoom, GatheredTower, SkipReason};
use normalize::{fits_tdt_rows, is_present, norm, resident_count};
pub use values::{js_finite, js_max, js_min, js_num, js_num_raw_site, js_truthy, FloorKey};

pub fn gather_tower(save: &Value) -> Result<GatheredTower, LegacyExportError> {
    let Some(raw_units) = save.get("units").and_then(Value::as_array) else {
        return Err(LegacyExportError("save.units is not an array".into()));
    };
    gather_units(raw_units)
}

/// [`gather_tower`] over the save's unit entries as they come, each read on
/// its own and dropped before the next, so the caller need not hold the
/// `units` array whole (#1431).
pub fn gather_units<U: Borrow<Value>>(
    raw_units: impl IntoIterator<Item = U>,
) -> Result<GatheredTower, LegacyExportError> {
    let mut tenants_by_tdt: IndexMap<FloorKey, Vec<OutTenant>> = IndexMap::new();
    let mut extents: IndexMap<FloorKey, (f64, f64)> = IndexMap::new();
    let mut covered_tiles: IndexMap<FloorKey, Vec<bool>> = IndexMap::new();
    let mut retail_rows: Vec<(f64, i64)> = vec![];
    let widen =
        |extents: &mut IndexMap<FloorKey, (f64, f64)>, floor: f64, left: f64, right: f64| {
            match extents.get_mut(&FloorKey::of(floor)) {
                None => {
                    extents.insert(FloorKey::of(floor), (left, right));
                }
                Some(e) => {
                    e.0 = js_min(e.0, left);
                    e.1 = js_max(e.1, right);
                }
            }
        };
    let push_tenant =
        |tenants: &mut IndexMap<FloorKey, Vec<OutTenant>>, floor: f64, t: OutTenant| {
            tenants
                .entry(FloorKey::of(floor + TDT_FLOOR_OFFSET as f64))
                .or_default()
                .push(t);
        };

    let mut counts = ExportCounts::default();
    let mut header = ExportHeaderCounts::default();
    let mut has_ground_lobby = false;
    let mut people_pop = 0.0;
    let add_residents = |people_pop: &mut f64, u: &GatheredRoom| {
        let r = resident_count(u);
        if r.is_finite() {
            *people_pop += r;
        }
    };

    let mut rooms: Vec<GatheredRoom> = vec![];
    for raw in raw_units {
        let mut u = norm(raw.borrow())?;
        if u.kind == Kind::Floor || u.kind == Kind::Lobby {
            if u.kind == Kind::Lobby && u.floor == 1.0 && u.state != "fire" && u.state != "gutted" {
                has_ground_lobby = true;
            }
            widen(&mut extents, u.floor, u.x, u.x + u.width);
            continue;
        }
        let burned = u.state == "fire" || u.state == "gutted";
        let stories = u.kind.floors() as f64;
        let fits = fits_tdt_rows(u.floor, stories);
        let mappable = kind_tenant(u.kind).is_some() || part_stack(u.kind).is_some();
        u.skip_reason = if !fits {
            Some(SkipReason::OutOfRange)
        } else if burned {
            Some(SkipReason::Burned)
        } else if !mappable {
            Some(SkipReason::Unmappable)
        } else {
            None
        };
        u.emitted = !burned && fits && mappable;
        let clamp = |v: f64| js_max(0.0, js_min(LOT_WIDTH as f64, v));
        let mut left = 0.0;
        let mut right = 0.0;
        if u.emitted {
            left = u.x;
            right = u.x + u.width;
        } else if u.coords_finite {
            left = clamp(u.x);
            right = clamp(u.x + u.width);
        }
        let emitted = u.emitted;
        let (floor, kind) = (u.floor, u.kind);
        rooms.push(u);
        if !emitted && right <= left {
            continue;
        }
        let mut fl = floor;
        while fl < floor + kind.floors() as f64 {
            widen(&mut extents, fl, left, right);
            // A floor so large that `fl + 1` is `fl` would loop forever (as
            // the TypeScript does); stop after the one story it can name.
            if fl + 1.0 == fl {
                break;
            }
            fl += 1.0;
        }
    }

    for idx in 0..rooms.len() {
        let u = &rooms[idx];
        if !u.emitted {
            match u.skip_reason {
                Some(SkipReason::OutOfRange) => counts.out_of_range += 1,
                Some(SkipReason::Burned) => counts.burned_out += 1,
                _ => {}
            }
            continue;
        }
        let construction = u.state == "construction";
        let tenanted = u.state == "occupied" || u.state == "moving_in" || u.state == "vacating";
        let mut status: i64 = 0;
        if !construction {
            if (u.kind == Kind::Office || u.kind == Kind::Condo) && tenanted {
                status = 1;
                counts.occupied += 1;
                add_residents(&mut people_pop, u);
            } else if u.kind.is_commercial() && u.kind.facility().population > 0 {
                if is_present(&u.state) {
                    add_residents(&mut people_pop, u);
                }
            } else if u.kind.is_hotel() {
                if u.state == "dirty" {
                    status = HOTEL_DIRTY_FLAG;
                } else if u.state == "asleep" {
                    let guests = js_min(js_max(u.occupants, 1.0), HOTEL_OCCUPANT_MASK as f64);
                    status = HOTEL_ASLEEP_FLAG | super::byte_writer::to_int32(guests);
                } else if tenanted || u.ever_occupied {
                    status = 1;
                }
                if status != 0 {
                    counts.hotel_states += 1;
                    add_residents(&mut people_pop, u);
                }
            }
            if (u.kind == Kind::Office || u.kind == Kind::Condo) && !tenanted && u.ever_occupied {
                counts.vacancy_history_lost += 1;
            }
        } else {
            counts.construction += 1;
        }
        let rent_defined = u.rent.is_some();
        let rent_num = u.rent.as_ref().map(|v| js_num(Some(v)));
        let rent_class = if u.no_rate && is_priced(u.kind) {
            4
        } else {
            class_from_rent(u.kind, if rent_defined { rent_num } else { None })
        };
        if let Some(band) = rent_config(u.kind) {
            if !u.no_rate {
                let effective = match &u.rent {
                    None | Some(Value::Null) => band.default,
                    Some(v) => js_num(Some(v)),
                };
                let back = rent_from_class(u.kind, rent_class);
                if back.is_some_and(|b| b != effective) {
                    counts.rents_snapped += 1;
                }
            }
        }
        if u.label
            .as_deref()
            .is_some_and(|l| !l.is_empty() && l != u.kind.facility().name)
        {
            counts.names_dropped += 1;
        }
        if u.kind == Kind::Parking {
            counts.parking_stalls += 1;
        }
        match u.kind {
            Kind::Recycling => header.recycling += 1,
            Kind::Shop | Kind::Restaurant | Kind::FastFood => header.commercial += 1,
            Kind::Security => header.security += 1,
            Kind::PartyHall | Kind::Cinema => header.hall_cinema += 1,
            _ => {}
        }

        if let Some(stack) = part_stack(u.kind) {
            if u.kind == Kind::WeddingHall {
                let mut parts: Vec<i64> = vec![];
                for i in 0..stack.len() {
                    let fl = u.floor - i as f64;
                    let collides = fl < MIN_FLOOR as f64
                        || (i > 0
                            && rooms.iter().enumerate().any(|(j, o)| {
                                j != idx
                                    && o.emitted
                                    && fl >= o.floor
                                    && fl < o.floor + o.kind.floors() as f64
                                    && o.x < u.x + u.width
                                    && u.x < o.x + o.width
                            }));
                    if collides {
                        break;
                    }
                    parts.push(stack[stack.len() - 1 - i]);
                }
                for (i, &part) in parts.iter().enumerate() {
                    let fl = u.floor - i as f64;
                    widen(&mut extents, fl, u.x, u.x + u.width);
                    push_tenant(
                        &mut tenants_by_tdt,
                        fl,
                        OutTenant {
                            left: u.x,
                            right: u.x + u.width,
                            type_id: if construction { -part } else { part },
                            status: 0,
                            rent_class,
                            subtype_idx: None,
                        },
                    );
                }
            } else {
                for (i, &part) in stack.iter().enumerate() {
                    push_tenant(
                        &mut tenants_by_tdt,
                        u.floor + i as f64,
                        OutTenant {
                            left: u.x,
                            right: u.x + u.width,
                            type_id: if construction { -part } else { part },
                            status: 0,
                            rent_class,
                            subtype_idx: None,
                        },
                    );
                }
            }
            counts.rooms += 1;
            continue;
        }

        let Some(id) = kind_tenant(u.kind) else {
            continue;
        };
        let sub_idx: i64 = match (&u.subtype, u.kind.subtype_list()) {
            (Some(name), Some(list)) => list
                .iter()
                .position(|s| s == name)
                .map(|i| i as i64)
                .unwrap_or(-1),
            _ => -1,
        };
        push_tenant(
            &mut tenants_by_tdt,
            u.floor,
            OutTenant {
                left: u.x,
                right: u.x + u.width,
                type_id: if construction { -id } else { id },
                status,
                rent_class,
                subtype_idx: if sub_idx >= 0 { Some(sub_idx) } else { None },
            },
        );
        if matches!(u.kind, Kind::Shop | Kind::FastFood | Kind::Restaurant)
            && retail_rows.len() < 512
        {
            retail_rows.push((u.floor + TDT_FLOOR_OFFSET as f64, sub_idx.max(0)));
        }
        counts.rooms += 1;
    }

    // Coverage for the paving pass, from the records actually emitted.
    let clamp_tile = |v: f64| -> usize {
        let v = if v.is_finite() { v } else { 0.0 };
        v.floor().min(LOT_WIDTH as f64).max(0.0) as usize
    };
    for (tdt, records) in &tenants_by_tdt {
        let floor = tdt.value() - TDT_FLOOR_OFFSET as f64;
        for r in records {
            let lo = clamp_tile(r.left);
            let hi = clamp_tile(r.right).max(lo);
            if hi == lo {
                continue;
            }
            let set = covered_tiles
                .entry(FloorKey::of(floor))
                .or_insert_with(|| vec![false; LOT_WIDTH as usize + 1]);
            for cell in &mut set[lo..hi] {
                *cell = true;
            }
        }
    }

    // Paving spans: each floor's extent minus the tiles under a record, one
    // record per contiguous run; lobby floors type 24, others type 0.
    const TDT_LOBBY_TYPE: i64 = 24;
    const TDT_FLOOR_TYPE: i64 = 0;
    let extent_list: Vec<(FloorKey, (f64, f64))> = extents.iter().map(|(k, v)| (*k, *v)).collect();
    for (key, ext) in extent_list {
        let floor = key.value();
        if !fits_tdt_rows(floor, 1.0) {
            continue;
        }
        let lobby = floor.fract() == 0.0 && is_lobby_floor(floor as i64);
        let covered = covered_tiles.get(&key);
        let lo = clamp_tile(ext.0);
        let hi = clamp_tile(ext.1).max(lo);
        let mut run_start: Option<usize> = None;
        let flush = |run_start: &mut Option<usize>,
                     end: usize,
                     tenants: &mut IndexMap<FloorKey, Vec<OutTenant>>| {
            let Some(start) = *run_start else {
                return;
            };
            push_tenant(
                tenants,
                floor,
                OutTenant {
                    left: start as f64,
                    right: end as f64,
                    type_id: if lobby {
                        TDT_LOBBY_TYPE
                    } else {
                        TDT_FLOOR_TYPE
                    },
                    status: if lobby { 0 } else { 2 },
                    rent_class: 4,
                    subtype_idx: None,
                },
            );
            *run_start = None;
        };
        for x_tile in lo..hi {
            if covered.is_some_and(|set| set[x_tile]) {
                flush(&mut run_start, x_tile, &mut tenants_by_tdt);
            } else if run_start.is_none() {
                run_start = Some(x_tile);
            }
        }
        flush(&mut run_start, hi, &mut tenants_by_tdt);
    }

    Ok(GatheredTower {
        tenants_by_tdt,
        extents,
        retail_rows,
        counts,
        header,
        has_ground_lobby,
        people_pop,
        rooms,
    })
}

#[cfg(test)]
mod tests;

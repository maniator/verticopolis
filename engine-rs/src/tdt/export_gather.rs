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

/// `Number(v)` for the JSON values a save can hold; `undefined` is NaN. It is
/// the loader's reading (`crate::load::js_number`), which follows the
/// `StringNumericLiteral` grammar and `ToPrimitive` for arrays; its full
/// Node-pinned tables live beside it in `load.rs`.
pub fn js_num(v: Option<&Value>) -> f64 {
    crate::load::js_number(v)
}

/// The reading at the three sites the TypeScript gather keeps raw (a unit's
/// `floor`, `x` and `width`, passed through `norm()` with `??` and then
/// concatenated, compared with `===` or with `<`). It is the reading these
/// sites had before round 3 of the #881 review, kept on purpose: a number,
/// a boolean (`true` 1, `false` 0), `null` and an empty array read as
/// `Number()` would, and a string is trimmed and parsed with Rust's float
/// grammar, else NaN, so a radix string such as `"0x10"` lands on NaN where
/// TypeScript's concatenation also yields no number. An empty or
/// whitespace-only string reads 0 as `Number("")` does: the reader checks
/// for an empty trimmed string before it parses, so Rust's parse never sees
/// it. It differs from `Number()` in these places:
///
/// - a one-element array reads its element with this same reader, so
///   `[true]` and `[false]` read 1 and 0 (`Number([true])` is NaN);
/// - Rust's float grammar accepts `inf`, `infinity` and `NaN` in any case
///   (`Number("inf")` is NaN);
/// - Rust's `trim` strips U+0085 but not U+FEFF, so `"\u{85}2"` reads 2 and
///   `"\u{feff}2"` reads NaN (`Number()` reads the first as NaN and the
///   second as 2); the same split decides which strings count as
///   whitespace-only, so `"\u{feff}"` alone reads NaN where `Number()`
///   reads 0, and `"\u{85}"` alone reads 0 where `Number()` reads NaN;
/// - radix strings (`"0x10"`, `"0o7"`, `"0b11"`) read NaN.
///
/// TypeScript keeps these sites raw anyway (a string floor concatenates), so
/// neither this reader nor `js_num` is exact for a forged value here. The
/// unit tests pin this reading (`js_num_raw_site_outputs_are_pinned`) and
/// which reader each `norm()` and rent site uses (the `gather_*` tests), so
/// neither can drift by accident. Modeling the raw sites is #884's work.
pub fn js_num_raw_site(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                0.0
            } else {
                t.parse::<f64>().unwrap_or(f64::NAN)
            }
        }
        Some(Value::Array(a)) if a.is_empty() => 0.0,
        Some(Value::Array(a)) if a.len() == 1 => js_num_raw_site(Some(&a[0])),
        Some(_) => f64::NAN,
    }
}

/// `Number.isFinite(v)` as a reader: `Some` only for a JSON number that is
/// finite. There is no coercion, so `null`, a boolean, a string and an array
/// all read as `None`, exactly the values `Number.isFinite` rejects. (A JSON
/// number is finite by construction; the check guards an out-of-range
/// literal `serde_json` could not represent.)
pub fn js_finite(v: Option<&Value>) -> Option<f64> {
    match v {
        Some(Value::Number(n)) => n.as_f64().filter(|x| x.is_finite()),
        _ => None,
    }
}

/// JavaScript truthiness.
pub fn js_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

/// `Math.min` / `Math.max`: NaN wins.
pub fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

pub fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// A `Map` key for a floor number: SameValueZero, so `-0` is `0` and every
/// NaN is one key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct FloorKey(u64);

impl FloorKey {
    pub fn of(f: f64) -> Self {
        if f.is_nan() {
            FloorKey(f64::NAN.to_bits())
        } else if f == 0.0 {
            FloorKey(0)
        } else {
            FloorKey(f.to_bits())
        }
    }

    pub fn value(self) -> f64 {
        f64::from_bits(self.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkipReason {
    OutOfRange,
    Burned,
    Unmappable,
}

/// A normalized room plus whether the gather pass wrote a tenant record for
/// it (`GatheredRoom`).
#[derive(Clone, Debug)]
pub struct GatheredRoom {
    pub kind: Kind,
    pub floor: f64,
    pub x: f64,
    pub width: f64,
    /// Whether `x` and the defaulted `width` were both finite numbers in the
    /// save, as `Number.isFinite` reads them: a `null` or a string `x` fails
    /// this even though `js_num` turns it into a usable 0. Only a room that
    /// writes no record consults it (the extent it may still claim).
    pub coords_finite: bool,
    /// The state string, or "" for a value that is not a string (which
    /// matches no state, as a stray number matches none in TypeScript).
    pub state: String,
    pub occupants: f64,
    pub ever_occupied: bool,
    pub label: Option<String>,
    /// The raw `rent` value, `None` for undefined.
    pub rent: Option<Value>,
    pub no_rate: bool,
    pub subtype: Option<String>,
    /// `residents`: `None` for undefined, else the value as `Number.isFinite`
    /// reads it (a `null` or a string reads as NaN, which the census then
    /// skips; `residentCount` returns the raw household without coercing).
    pub residents: Option<f64>,
    pub emitted: bool,
    pub skip_reason: Option<SkipReason>,
}

/// Loss/quirk tally the exporter fills while gathering (`ExportCounts`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExportCounts {
    pub rooms: i64,
    pub rents_snapped: i64,
    pub names_dropped: i64,
    pub hotel_states: i64,
    pub occupied: i64,
    pub construction: i64,
    pub parking_stalls: i64,
    pub burned_out: i64,
    pub vacancy_history_lost: i64,
    pub out_of_range: i64,
}

/// The header aggregate counts the 1994 game trusts.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExportHeaderCounts {
    pub recycling: i64,
    pub commercial: i64,
    pub security: i64,
    pub hall_cinema: i64,
}

/// Everything the gather pass produces for the encoder and report.
pub struct GatheredTower {
    /// Tenant records keyed by TDT floor index.
    pub tenants_by_tdt: IndexMap<FloorKey, Vec<OutTenant>>,
    /// Built extent [left, right) per our floor.
    pub extents: IndexMap<FloorKey, (f64, f64)>,
    /// Retail-table rows (TDT-space floor, canon variant), bounded at 512.
    pub retail_rows: Vec<(f64, i64)>,
    pub counts: ExportCounts,
    pub header: ExportHeaderCounts,
    pub has_ground_lobby: bool,
    pub people_pop: f64,
    pub rooms: Vec<GatheredRoom>,
}

/// `fitsTdtRows`: every story of a footprint sits on a writable row (0..109).
fn fits_tdt_rows(floor: f64, stories: f64) -> bool {
    let bottom = floor + TDT_FLOOR_OFFSET as f64;
    bottom >= 0.0 && bottom + stories - 1.0 <= 109.0
}

/// `residentCount(u)`: the household when one is set, else the catalog
/// population.
fn resident_count(u: &GatheredRoom) -> f64 {
    if (u.kind == Kind::Condo || u.kind == Kind::RentalApartment) && u.residents.is_some() {
        return u.residents.unwrap_or(f64::NAN);
    }
    u.kind.facility().population as f64
}

fn is_present(state: &str) -> bool {
    matches!(state, "occupied" | "asleep" | "moving_in" | "vacating")
}

/// `norm(u)`: the serialized unit with the loader's defaults applied.
fn norm(raw: &Value) -> Result<GatheredRoom, LegacyExportError> {
    let kind_str = raw.get("kind").and_then(Value::as_str).unwrap_or("");
    let Some(kind) = Kind::parse(kind_str) else {
        return Err(LegacyExportError(format!(
            "unit kind {kind_str:?} is not in the catalog"
        )));
    };
    let nullish = |k: &str| matches!(raw.get(k), None | Some(Value::Null));
    let (width, width_finite) = if nullish("width") {
        (kind.facility().width as f64, true)
    } else {
        (
            js_num_raw_site(raw.get("width")),
            js_finite(raw.get("width")).is_some(),
        )
    };
    let state = if nullish("state") {
        "empty".to_string()
    } else {
        raw.get("state")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let occupants = if nullish("occupants") {
        0.0
    } else {
        js_num(raw.get("occupants"))
    };
    let ever_occupied = if nullish("everOccupied") {
        false
    } else {
        js_truthy(raw.get("everOccupied"))
    };
    Ok(GatheredRoom {
        kind,
        floor: js_num_raw_site(raw.get("floor")),
        x: js_num_raw_site(raw.get("x")),
        width,
        coords_finite: js_finite(raw.get("x")).is_some() && width_finite,
        state,
        occupants,
        ever_occupied,
        label: raw.get("label").and_then(Value::as_str).map(str::to_string),
        rent: raw.get("rent").cloned(),
        no_rate: js_truthy(raw.get("noRate")),
        subtype: raw
            .get("subtype")
            .and_then(Value::as_str)
            .map(str::to_string),
        residents: raw
            .get("residents")
            .map(|v| js_finite(Some(v)).unwrap_or(f64::NAN)),
        emitted: false,
        skip_reason: None,
    })
}

pub fn gather_tower(save: &Value) -> Result<GatheredTower, LegacyExportError> {
    let Some(raw_units) = save.get("units").and_then(Value::as_array) else {
        return Err(LegacyExportError("save.units is not an array".into()));
    };
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
        let mut u = norm(raw)?;
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
mod tests {
    use super::{
        gather_tower, js_finite, js_num, js_num_raw_site, kind_tenant, GatheredTower, Kind,
        OutTenant, HOTEL_ASLEEP_FLAG,
    };
    use serde_json::json;

    #[test]
    fn js_finite_accepts_only_finite_numbers() {
        assert_eq!(js_finite(Some(&json!(2.5))), Some(2.5));
        assert_eq!(js_finite(Some(&json!(-0.0))), Some(0.0));
        assert_eq!(js_finite(Some(&json!(0))), Some(0.0));
        for v in [
            json!(null),
            json!(true),
            json!(false),
            json!("3"),
            json!(""),
            json!([]),
            json!([7]),
            json!({}),
        ] {
            assert_eq!(js_finite(Some(&v)), None, "{v}");
        }
        assert_eq!(js_finite(None), None);
    }

    #[test]
    fn js_num_still_coerces_where_js_finite_refuses() {
        assert_eq!(js_num(Some(&json!(null))), 0.0);
        assert_eq!(js_num(Some(&json!("3"))), 3.0);
        assert_eq!(js_num(Some(&json!(true))), 1.0);
        assert_eq!(js_finite(Some(&json!(null))), None);
        assert_eq!(js_finite(Some(&json!("3"))), None);
        assert_eq!(js_finite(Some(&json!(true))), None);
    }

    /// `Number()` on the strings and arrays a forged save can carry, pinned
    /// with Node (the round-3 Edge Case Hunter's divergent inputs).
    #[test]
    fn js_num_reads_strings_and_arrays_the_way_number_does() {
        assert_eq!(js_num(Some(&json!("0x7D0"))), 2000.0);
        assert_eq!(js_num(Some(&json!("0x2"))), 2.0);
        assert_eq!(js_num(Some(&json!("0o7"))), 7.0);
        assert_eq!(js_num(Some(&json!("0b1"))), 1.0);
        assert!(js_num(Some(&json!("INF"))).is_nan());
        assert!(js_num(Some(&json!("inf"))).is_nan());
        assert_eq!(js_num(Some(&json!("Infinity"))), f64::INFINITY);
        assert_eq!(js_num(Some(&json!("\u{feff}2"))), 2.0);
        assert!(js_num(Some(&json!("\u{85}2"))).is_nan());
        assert!(js_num(Some(&json!([true]))).is_nan());
        assert_eq!(js_num(Some(&json!([5]))), 5.0);
        assert_eq!(js_num(Some(&json!([]))), 0.0);
        assert_eq!(js_num(Some(&json!(["0x10"]))), 16.0);
        assert!(js_num(Some(&json!([1, 2]))).is_nan());
        assert!(js_num(Some(&json!("-0x10"))).is_nan());
        assert_eq!(js_num(Some(&json!(null))), 0.0);
        assert!(js_num(None).is_nan());
    }

    /// The raw-site reader's outputs pinned as they are (the pre-round-3
    /// reading kept on purpose; #884), contrasted with `js_num` on the same
    /// inputs. This pins the reader; the `gather_*` tests below pin which
    /// reader each call site uses.
    #[test]
    fn js_num_raw_site_outputs_are_pinned() {
        let raw = |v: serde_json::Value| js_num_raw_site(Some(&v));
        assert!(raw(json!("0x10")).is_nan());
        assert_eq!(js_num(Some(&json!("0x10"))), 16.0);
        assert_eq!(raw(json!("inf")), f64::INFINITY);
        assert_eq!(raw(json!("infinity")), f64::INFINITY);
        assert_eq!(raw(json!("\u{85}2")), 2.0);
        assert!(raw(json!("\u{feff}2")).is_nan());
        assert_eq!(raw(json!([true])), 1.0);
        assert_eq!(raw(json!([5])), 5.0);
        assert_eq!(raw(json!([])), 0.0);
        assert_eq!(raw(json!(null)), 0.0);
        assert_eq!(raw(json!(true)), 1.0);
        assert!(js_num_raw_site(None).is_nan());
        assert_eq!(raw(json!("5")), 5.0);
        assert!(raw(json!("12abc")).is_nan());
        assert_eq!(raw(json!("")), 0.0);
        assert_eq!(raw(json!("  ")), 0.0);
        assert_eq!(js_num(Some(&json!(""))), 0.0);
        assert!(raw(json!("\u{feff}")).is_nan());
        assert_eq!(js_num(Some(&json!("\u{feff}"))), 0.0);
        assert_eq!(raw(json!("\u{85}")), 0.0);
        assert!(js_num(Some(&json!("\u{85}"))).is_nan());
    }

    // The call sites. Each test forges one field with a radix string, which
    // `js_num_raw_site` reads as NaN and `js_num` reads as a number, and
    // checks what `gather_tower` makes of it, so moving any of the six sites
    // to the other reader fails a test here.

    fn gather(units: serde_json::Value) -> GatheredTower {
        match gather_tower(&json!({ "units": units })) {
            Ok(g) => g,
            Err(e) => panic!("gather refused the save: {}", e.0),
        }
    }

    /// Every non-paving record the gather wrote, in floor order.
    fn records(g: &GatheredTower, kind: Kind) -> Vec<OutTenant> {
        let id = kind_tenant(kind).expect("kind writes a record");
        g.tenants_by_tdt
            .values()
            .flatten()
            .filter(|t| t.type_id == id)
            .cloned()
            .collect()
    }

    /// A unit's `floor` is a raw site: `"0x10"` reads NaN, so the office is
    /// out of range (with `js_num` it would read 16 and write a record).
    #[test]
    fn gather_reads_a_unit_floor_at_the_raw_site() {
        let g = gather(json!([{ "kind": "office", "floor": "0x10", "x": 10 }]));
        assert!(g.rooms[0].floor.is_nan());
        assert_eq!(g.counts.out_of_range, 1);
        assert_eq!(g.counts.rooms, 0);
        assert!(records(&g, Kind::Office).is_empty());
    }

    /// A unit's `x` is a raw site: `"0x10"` reads NaN, so the record's left
    /// edge is NaN (with `js_num` it would be 16).
    #[test]
    fn gather_reads_a_unit_x_at_the_raw_site() {
        let g = gather(json!([{ "kind": "office", "floor": 2, "x": "0x10" }]));
        assert!(g.rooms[0].x.is_nan());
        let recs = records(&g, Kind::Office);
        assert_eq!(recs.len(), 1);
        assert!(recs[0].left.is_nan());
    }

    /// A unit's `width` is a raw site: `"0x10"` reads NaN, so the record's
    /// right edge is NaN (with `js_num` it would be x + 16).
    #[test]
    fn gather_reads_a_unit_width_at_the_raw_site() {
        let g = gather(json!([{ "kind": "office", "floor": 2, "x": 10, "width": "0x10" }]));
        assert!(g.rooms[0].width.is_nan());
        let recs = records(&g, Kind::Office);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].left, 10.0);
        assert!(recs[0].right.is_nan());
    }

    /// A unit's `occupants` coerces like `Number()`: `"0x2"` reads 2, so an
    /// asleep hotel room writes two guests (the raw-site reader's NaN would
    /// write none).
    #[test]
    fn gather_coerces_occupants_like_number() {
        let g = gather(json!([{
            "kind": "hotelSingle", "floor": 2, "x": 10,
            "state": "asleep", "occupants": "0x2"
        }]));
        assert_eq!(g.rooms[0].occupants, 2.0);
        let recs = records(&g, Kind::HotelSingle);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].status, HOTEL_ASLEEP_FLAG | 2);
    }

    /// A unit's `rent` coerces like `Number()` at both of its sites:
    /// `"0x3A98"` is 15,000, the office's class-3 rung, so the record takes
    /// class 3 and nothing snaps. Reading it raw at the class site lands on
    /// class 2 and snaps; reading it raw at the snap check compares the rung
    /// with NaN and snaps.
    #[test]
    fn gather_coerces_rent_like_number_at_both_sites() {
        let g = gather(json!([{ "kind": "office", "floor": 2, "x": 10, "rent": "0x3A98" }]));
        let recs = records(&g, Kind::Office);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].rent_class, 3);
        assert_eq!(g.counts.rents_snapped, 0);
    }
}

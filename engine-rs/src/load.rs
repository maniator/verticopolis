//! Port of `src/storage/vctowerContainer.ts`, `src/engine/saveMigration.ts`
//! (with its `migrations/*`), `sim/serialization.ts` (`deserialize`),
//! `sim/coerce.ts`, `sim/deserializeGuards.ts` and `sim/founderStatus.ts`.

use std::collections::{HashMap, HashSet};

use base64::Engine;
use indexmap::{IndexMap, IndexSet};
use serde_json::{json, Map, Value};

use crate::clock::{CalendarKind, Clock, GameMode};
use crate::econ::{classic_ladder, rent_config};
use crate::events::PendingChoice;
use crate::facilities::*;
use crate::jsmath::{number_to_string, round};
use crate::ledger::Ledger;
use crate::rent::snap_to_ladder;
use crate::rng::Rng;
use crate::schedule::Schedule;
use crate::sim::{LogEntry, LogKind, Simulation, LOG_RING_CAP};
use crate::sim_loop::weather_for;
use crate::tower::{Transport, Unit, UnitState};

const SOLD_CONDO_MIN_PRICE: f64 = 60_000.0;
const SOLD_CONDO_MAX_PRICE: f64 = 240_000.0;
const VIP_VISITS_CAP: f64 = 1_000_000.0;
const LOG_TEXT_CAP: usize = 400;
const LEGACY_CONDO_DEFAULT_PRICE: f64 = 120_000.0;
const OLDEST_SAVE_VERSION: i64 = 1;
const UNIT_CAP: usize = 2 * (LOT_WIDTH as usize) * ((MAX_FLOOR - MIN_FLOOR + 1) as usize);
const LOT: i64 = LOT_WIDTH;

// ---- vctowerContainer.ts ----------------------------------------------------

/// `decodeVctower(text)`: the VCTOWER1 container (base64 of raw deflate).
pub fn decode_vctower(text: &str) -> Result<Value, String> {
    let trimmed = text.trim();
    if !trimmed.starts_with("VCTOWER1") {
        return Err("not a VCTOWER1 file".into());
    }
    let b64: String = trimmed["VCTOWER1".len()..]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let packed = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| format!("base64: {e}"))?;
    use std::io::Read;
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(&packed[..])
        .read_to_end(&mut out)
        .map_err(|e| format!("inflate: {e}"))?;
    serde_json::from_slice(&out).map_err(|e| format!("json: {e}"))
}

// ---- helpers -------------------------------------------------------------------

/// `typeof v === "number" && Number.isFinite(v) ? v : fallback`.
fn num(v: Option<&Value>, fallback: f64) -> f64 {
    match v.and_then(Value::as_f64) {
        Some(x) if x.is_finite() => x,
        _ => fallback,
    }
}

fn is_num(v: Option<&Value>) -> bool {
    v.and_then(Value::as_f64).is_some()
}

fn finite_num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite())
}

/// `Number(v)` for the shapes a save holds: a number is itself, a missing
/// value is NaN, null is 0, and anything else is NaN.
fn js_number(v: Option<&Value>) -> f64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => f64::NAN,
    }
}

fn kind_of(u: &Value) -> Option<Kind> {
    u.get("kind").and_then(Value::as_str).and_then(Kind::parse)
}

/// JS `ToUint32`.
fn to_uint32(x: f64) -> u32 {
    if !x.is_finite() {
        return 0;
    }
    let t = x.trunc();
    let m = t.rem_euclid(4294967296.0);
    m as u32
}

fn tile_key(f: f64, x: f64) -> String {
    format!("{}:{}", number_to_string(f), number_to_string(x))
}

fn stories_at_version(kind: Kind, version: Option<f64>) -> i64 {
    if kind == Kind::PartyHall && version.unwrap_or(0.0) < 6.0 {
        return 1;
    }
    kind.floors()
}

fn floor_unit(id: i64, floor: i64, x: i64) -> Value {
    json!({
        "id": id, "kind": "floor", "floor": floor, "x": x, "width": 1, "state": "empty",
        "satisfaction": 1, "occupants": 0, "everOccupied": false, "pendingIncome": 0, "label": "Floor"
    })
}

fn units_of(data: &Value) -> Vec<Value> {
    data.get("units")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn version_of(data: &Value) -> Option<f64> {
    data.get("version").and_then(Value::as_f64)
}

fn with(data: &Value, patches: Vec<(&str, Value)>) -> Value {
    let mut m = data.as_object().cloned().unwrap_or_default();
    for (k, v) in patches {
        m.insert(k.to_string(), v);
    }
    Value::Object(m)
}

// ---- migrations/v1tov2.ts ------------------------------------------------------

/// `migrationLooksValid`.
pub fn migration_looks_valid(data: &Value) -> bool {
    let version = version_of(data);
    let mut by_floor: IndexMap<String, Vec<(f64, f64)>> = IndexMap::new();
    for u in units_of(data) {
        let Some(kind) = kind_of(&u) else { continue };
        if kind.is_structural() {
            continue;
        }
        let width = match u.get("width") {
            Some(Value::Number(n)) => n.as_f64().unwrap(),
            _ => kind.facility().width as f64,
        };
        let x = js_number(u.get("x"));
        let floor = js_number(u.get("floor"));
        if x < 0.0 || x + width > LOT as f64 {
            return false;
        }
        let stories = stories_at_version(kind, version) as f64;
        let mut f = floor;
        while f < floor + stories {
            by_floor
                .entry(number_to_string(f))
                .or_default()
                .push((x, width));
            f += 1.0;
        }
    }
    for arr in by_floor.values_mut() {
        arr.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        for i in 1..arr.len() {
            if arr[i].0 < arr[i - 1].0 + arr[i - 1].1 {
                return false;
            }
        }
    }
    true
}

/// `floatingStructureCount`.
pub fn floating_structure_count(data: &Value) -> i64 {
    let units = units_of(data);
    let mut structure: HashSet<String> = HashSet::new();
    let struct_of = |u: &Value| matches!(kind_of(u), Some(Kind::Floor) | Some(Kind::Lobby));
    for u in &units {
        if !struct_of(u) {
            continue;
        }
        let w = u.get("width").and_then(Value::as_f64).unwrap_or(1.0);
        let f = js_number(u.get("floor"));
        let x = js_number(u.get("x"));
        let mut i = 0.0;
        while i < w {
            structure.insert(tile_key(f, x + i));
            i += 1.0;
        }
    }
    let mut floating = 0;
    for u in &units {
        if !struct_of(u) {
            continue;
        }
        let f = js_number(u.get("floor"));
        if f == 1.0 {
            continue;
        }
        let below = if f >= 2.0 { f - 1.0 } else { f + 1.0 };
        let w = u.get("width").and_then(Value::as_f64).unwrap_or(1.0);
        let x = js_number(u.get("x"));
        let mut i = 0.0;
        while i < w {
            if !structure.contains(&tile_key(below, x + i)) {
                floating += 1;
            }
            i += 1.0;
        }
    }
    floating
}

struct Room {
    u: Value,
    kind: Kind,
    floor: i64,
    x0: i64,
    w0: i64,
    w: i64,
    fl: i64,
}

/// `reflowV1toV2`: re-lay rooms at canon widths.
pub fn reflow_v1_to_v2(data: &Value) -> Value {
    let src = units_of(data);
    let is_park = |k: Kind| matches!(k, Kind::Parking | Kind::ParkingRamp);
    let mut rooms: Vec<Room> = Vec::new();
    let mut others: Vec<Value> = Vec::new();
    let mut orig_struct: HashSet<String> = HashSet::new();
    for u in &src {
        if !matches!(kind_of(u), Some(Kind::Floor) | Some(Kind::Lobby)) {
            continue;
        }
        let f = round(js_number(u.get("floor")));
        let x0 = round(js_number(u.get("x")));
        let w0 = round(if u.get("width").is_some() {
            js_number(u.get("width"))
        } else {
            1.0
        });
        if !f.is_finite() || !x0.is_finite() || !w0.is_finite() {
            continue;
        }
        let mut i = 0.0;
        while i < w0 {
            orig_struct.insert(tile_key(f, x0 + i));
            i += 1.0;
        }
    }
    let rests_on = |floor: i64, x: i64| -> bool {
        if floor == 1 {
            return true;
        }
        let below = if floor >= 2 { floor - 1 } else { floor + 1 };
        orig_struct.contains(&tile_key(below as f64, x as f64))
    };
    let safe_col = |floor: i64, x: i64| -> bool {
        orig_struct.contains(&tile_key(floor as f64, x as f64)) || rests_on(floor, x)
    };
    for u in &src {
        let kind = kind_of(u);
        let Some(kind) = kind else {
            if !u.is_null() {
                others.push(u.clone());
            }
            continue;
        };
        if kind.is_structural() {
            others.push(u.clone());
            continue;
        }
        let floor = round(js_number(u.get("floor")));
        let x0 = round(js_number(u.get("x")));
        let w0 = round(js_number(u.get("width")));
        if !floor.is_finite() || !x0.is_finite() || !w0.is_finite() || w0 < 1.0 {
            others.push(u.clone());
            continue;
        }
        rooms.push(Room {
            u: u.clone(),
            kind,
            floor: floor as i64,
            x0: x0 as i64,
            w0: w0 as i64,
            w: kind.facility().width,
            fl: stories_at_version(kind, Some(2.0)),
        });
    }
    let mut nx: HashMap<usize, i64> = HashMap::new();
    let mut nw: HashMap<usize, i64> = HashMap::new();
    let mut obstacles: HashMap<i64, Vec<(i64, i64)>> = HashMap::new();
    let add_obstacle =
        |obstacles: &mut HashMap<i64, Vec<(i64, i64)>>, floor: i64, fl: i64, x: i64, w: i64| {
            for f in floor..floor + fl {
                obstacles.entry(f).or_default().push((x, x + w));
            }
        };
    // Parking runs.
    let mut park_floors: IndexSet<i64> = IndexSet::new();
    for r in &rooms {
        if is_park(r.kind) {
            park_floors.insert(r.floor);
        }
    }
    for &f_ in &park_floors {
        let mut units: Vec<usize> = (0..rooms.len())
            .filter(|&i| rooms[i].floor == f_ && is_park(rooms[i].kind))
            .collect();
        units.sort_by_key(|&i| rooms[i].x0);
        struct Run {
            left: i64,
            width: i64,
            items: Vec<(usize, i64)>,
        }
        let mut runs: Vec<Run> = Vec::new();
        let mut i = 0;
        while i < units.len() {
            let mut j = i;
            let mut run = vec![units[i]];
            while j + 1 < units.len()
                && rooms[units[j + 1]].x0 == rooms[units[j]].x0 + rooms[units[j]].w0
            {
                j += 1;
                run.push(units[j]);
            }
            let mut items: Vec<(usize, i64)> = Vec::new();
            let mut off = 0;
            for &ri in &run {
                items.push((ri, off));
                off += rooms[ri].w;
            }
            let ramp = run
                .iter()
                .position(|&ri| rooms[ri].kind == Kind::ParkingRamp);
            let left = match ramp {
                Some(ri) => rooms[run[ri]].x0 - items[ri].1,
                None => rooms[run[0]].x0,
            };
            runs.push(Run {
                left,
                width: off,
                items,
            });
            i = j + 1;
        }
        runs.sort_by_key(|r| r.left);
        let mut cursor = 0;
        for run in &runs {
            let left = run.left.max(cursor);
            for &(ri, off) in &run.items {
                nx.insert(ri, left + off);
                nw.insert(ri, rooms[ri].w);
            }
            cursor = left + run.width;
        }
        for run in &runs {
            for &(ri, _) in &run.items {
                add_obstacle(
                    &mut obstacles,
                    rooms[ri].floor,
                    rooms[ri].fl,
                    nx[&ri],
                    rooms[ri].w,
                );
            }
        }
    }
    // Other rooms by base floor, ascending.
    let mut by_base: IndexMap<i64, Vec<usize>> = IndexMap::new();
    for (i, r) in rooms.iter().enumerate() {
        if is_park(r.kind) {
            continue;
        }
        by_base.entry(r.floor).or_default().push(i);
    }
    let mut floors: Vec<i64> = by_base.keys().copied().collect();
    floors.sort();
    let first_fit = |blocked: &[u8], start_x: i64, w: i64| -> Option<i64> {
        let mut x = start_x.max(0);
        while x + w <= LOT {
            let mut k = 0;
            while k < w && blocked[(x + k) as usize] == 0 {
                k += 1;
            }
            if k == w {
                return Some(x);
            }
            x += k + 1;
        }
        None
    };
    for f_ in floors {
        let mut here = by_base[&f_].clone();
        here.sort_by_key(|&i| rooms[i].x0);
        let mut floor_blocked = vec![0u8; LOT as usize];
        for x in 0..LOT {
            if !safe_col(f_, x) {
                floor_blocked[x as usize] = 1;
            }
        }
        if let Some(obs) = obstacles.get(&f_) {
            for &(o0, o1) in obs {
                for x in o0.max(0)..o1.min(LOT) {
                    floor_blocked[x as usize] = 1;
                }
            }
        }
        let try_canon = || -> Option<Vec<(usize, i64, i64)>> {
            let mut blocked = floor_blocked.clone();
            let mut placed = Vec::new();
            let mut cursor = 0;
            for &ri in &here {
                let r = &rooms[ri];
                let x = first_fit(&blocked, r.x0.max(cursor), r.w)?;
                for i in x..x + r.w {
                    blocked[i as usize] = 1;
                }
                placed.push((ri, x, r.w));
                cursor = x + r.w;
            }
            Some(placed)
        };
        let placed = try_canon().unwrap_or_else(|| {
            here.iter()
                .map(|&ri| (ri, rooms[ri].x0, rooms[ri].w0))
                .collect()
        });
        for (ri, x, w) in placed {
            nx.insert(ri, x);
            nw.insert(ri, w);
            add_obstacle(&mut obstacles, rooms[ri].floor, rooms[ri].fl, x, w);
        }
    }
    let mut paved: HashSet<String> = HashSet::new();
    for u in &others {
        if matches!(kind_of(u), Some(Kind::Floor) | Some(Kind::Lobby)) {
            let w = u.get("width").and_then(Value::as_f64).unwrap_or(1.0);
            let f = js_number(u.get("floor"));
            let x = js_number(u.get("x"));
            let mut i = 0.0;
            while i < w {
                paved.insert(tile_key(f, x + i));
                i += 1.0;
            }
        }
    }
    let mut next_id = finite_num(data.get("nextId")).unwrap_or(1.0);
    for u in &src {
        if let Some(id) = finite_num(u.get("id")) {
            next_id = next_id.max(id.floor() + 1.0);
        }
    }
    let mut out_units: Vec<Value> = others.clone();
    for (ri, r) in rooms.iter().enumerate() {
        let x = nx.get(&ri).copied().unwrap_or(r.x0);
        let w = nw.get(&ri).copied().unwrap_or(r.w0);
        out_units.push(with(&r.u, vec![("x", json!(x)), ("width", json!(w))]));
        for f in r.floor..r.floor + r.fl {
            for tx in x..x + w {
                let key = tile_key(f as f64, tx as f64);
                if !paved.contains(&key) {
                    paved.insert(key);
                    out_units.push(floor_unit(next_id as i64, f, tx));
                    next_id += 1.0;
                }
            }
        }
    }
    with(
        data,
        vec![
            ("version", json!(2)),
            ("units", Value::Array(out_units)),
            ("nextId", json!(next_id)),
        ],
    )
}

pub fn upgrade_v1_to_v2(data: &Value) -> Value {
    let safe = with(data, vec![("version", json!(2))]);
    let out = reflow_v1_to_v2(data);
    if !migration_looks_valid(&out) {
        return safe;
    }
    if floating_structure_count(&out) > floating_structure_count(data) {
        return safe;
    }
    out
}

// ---- migrations/v4tov5.ts ------------------------------------------------------

#[derive(Clone, Copy)]
struct Fp {
    x: i64,
    w: i64,
    bottom: i64,
    top: i64,
}

/// `widenLegacyElevatorShafts`.
pub fn widen_legacy_elevator_shafts(data: &Value) -> Value {
    let Some(transports) = data.get("transports").and_then(Value::as_array) else {
        return data.clone();
    };
    let pool_cap: i64 = POOLED_CAPS.iter().map(|p| p.cap).sum();
    if transports.len() as i64 > pool_cap {
        return data.clone();
    }
    let mut fps: Vec<Option<Fp>> = transports
        .iter()
        .map(|t| {
            let kind = kind_of(t)?;
            let catalog_w = kind.facility().width;
            let bottom = (round(num(t.get("bottom"), 1.0)) as i64).clamp(MIN_FLOOR, MAX_FLOOR - 1);
            let top = (round(num(t.get("top"), (bottom + 1) as f64)) as i64)
                .min(MAX_FLOOR)
                .max(bottom + 1);
            let w0 = round(num(t.get("width"), catalog_w as f64)) as i64;
            let w = if w0 > 0 { w0.min(catalog_w) } else { catalog_w };
            let x = (round(num(t.get("x"), 0.0)) as i64).clamp(0, LOT - w);
            Some(Fp { x, w, bottom, top })
        })
        .collect();
    let collides = |a: &Fp, b: &Fp| {
        a.x < b.x + b.w && b.x < a.x + a.w && a.bottom <= b.top && b.bottom <= a.top
    };
    let mut out: Vec<Value> = Vec::new();
    for i in 0..transports.len() {
        let t = &transports[i];
        let Some(fp) = fps[i] else {
            out.push(t.clone());
            continue;
        };
        let kind = kind_of(t).unwrap();
        if !kind.is_elevator() {
            out.push(t.clone());
            continue;
        }
        let canon_w = kind.facility().width;
        if fp.w >= canon_w {
            out.push(t.clone());
            continue;
        }
        let mut widened: Option<Value> = None;
        for shift in 0..=canon_w - fp.w {
            let cand = Fp {
                x: fp.x - shift,
                w: canon_w,
                bottom: fp.bottom,
                top: fp.top,
            };
            if cand.x < 0 || cand.x + cand.w > LOT {
                continue;
            }
            let fits =
                (0..fps.len()).all(|j| j == i || fps[j].is_none_or(|o| !collides(&cand, &o)));
            if fits {
                fps[i] = Some(cand);
                widened = Some(with(
                    t,
                    vec![("x", json!(cand.x)), ("width", json!(canon_w))],
                ));
                break;
            }
        }
        out.push(widened.unwrap_or_else(|| t.clone()));
    }
    with(data, vec![("transports", Value::Array(out))])
}

// ---- migrations/v5tov6.ts ------------------------------------------------------

/// `expandLegacyPartyHalls`.
pub fn expand_legacy_party_halls(data: &Value) -> Value {
    let src = units_of(data);
    let mut struct_cols: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut room_occ: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut lobby_cols: HashMap<i64, HashSet<i64>> = HashMap::new();
    for u in &src {
        let Some(kind) = kind_of(u) else { continue };
        let stories = kind.floors();
        let f =
            (round(num(u.get("floor"), 1.0)) as i64).clamp(MIN_FLOOR, MAX_FLOOR - (stories - 1));
        let x0 = (round(num(u.get("x"), 0.0)) as i64).clamp(0, LOT - 1);
        let w = (round(num(u.get("width"), kind.facility().width as f64)) as i64)
            .min(LOT - x0)
            .max(1);
        if kind.is_structural() {
            for i in 0..w {
                struct_cols.entry(f).or_default().insert(x0 + i);
                if kind == Kind::Lobby {
                    lobby_cols.entry(f).or_default().insert(x0 + i);
                }
            }
            continue;
        }
        if kind == Kind::PartyHall {
            continue;
        }
        for s in 0..stories {
            for i in 0..w {
                room_occ.entry(f + s).or_default().insert(x0 + i);
            }
        }
    }
    let mut hall_occ: HashMap<i64, HashSet<i64>> = HashMap::new();
    let paved = |sc: &HashMap<i64, HashSet<i64>>, f: i64, x: i64| {
        sc.get(&f).is_some_and(|s| s.contains(&x))
    };
    let halls: Vec<Value> = src
        .iter()
        .filter(|u| kind_of(u) == Some(Kind::PartyHall))
        .cloned()
        .collect();
    let mut kept: Vec<Value> = Vec::new();
    let mut dropped = 0;
    for u in &halls {
        let w = (round(num(u.get("width"), Kind::PartyHall.facility().width as f64)) as i64)
            .min(LOT)
            .max(1);
        let home_floor = (round(num(u.get("floor"), 1.0)) as i64).clamp(MIN_FLOOR, MAX_FLOOR - 1);
        let home_x = (round(num(u.get("x"), 0.0)) as i64).clamp(0, LOT - w);
        let span_clear = |hall_occ: &HashMap<i64, HashSet<i64>>, f_: i64, x: i64, w: i64| -> bool {
            for f in [f_, f_ + 1] {
                for i in 0..w {
                    let c = x + i;
                    if room_occ.get(&f).is_some_and(|s| s.contains(&c))
                        || hall_occ.get(&f).is_some_and(|s| s.contains(&c))
                        || lobby_cols.get(&f).is_some_and(|s| s.contains(&c))
                    {
                        return false;
                    }
                }
            }
            true
        };
        let col_supported = |f_: i64, x: i64| -> bool {
            if f_ >= 2 {
                return paved(&struct_cols, f_, x) || paved(&struct_cols, f_ - 1, x);
            }
            if f_ == 1 {
                return paved(&struct_cols, f_, x);
            }
            if f_ == 0 {
                return paved(&struct_cols, f_, x) || paved(&struct_cols, f_ + 1, x);
            }
            paved(&struct_cols, f_ + 1, x) || paved(&struct_cols, f_ + 2, x)
        };
        let fits = |hall_occ: &HashMap<i64, HashSet<i64>>, f_: i64, x: i64, w: i64| -> bool {
            if f_ < MIN_FLOOR || f_ + 1 > MAX_FLOOR || x < 0 || x + w > LOT {
                return false;
            }
            for i in 0..w {
                if !col_supported(f_, x + i) {
                    return false;
                }
            }
            span_clear(hall_occ, f_, x, w)
        };
        let mut placed: Option<(i64, i64)> = None;
        if fits(&hall_occ, home_floor, home_x, w) {
            placed = Some((home_floor, home_x));
        } else {
            let mut candidates: Vec<i64> = Vec::new();
            let mut push = |f: i64| {
                if (MIN_FLOOR..MAX_FLOOR).contains(&f) {
                    candidates.push(f);
                }
            };
            push(home_floor);
            for d in 1..=(MAX_FLOOR - MIN_FLOOR) {
                push(home_floor - d);
                push(home_floor + d);
            }
            'outer: for f_ in candidates {
                let mut best: Option<i64> = None;
                let mut x = 0;
                while x + w <= LOT {
                    if fits(&hall_occ, f_, x, w)
                        && best.is_none_or(|b| (x - home_x).abs() < (b - home_x).abs())
                    {
                        best = Some(x);
                    }
                    x += 1;
                }
                if let Some(b) = best {
                    placed = Some((f_, b));
                    break 'outer;
                }
            }
        }
        let Some((pf, px)) = placed else {
            dropped += 1;
            continue;
        };
        for f in [pf, pf + 1] {
            for i in 0..w {
                hall_occ.entry(f).or_default().insert(px + i);
            }
        }
        kept.push(with(
            u,
            vec![("floor", json!(pf)), ("x", json!(px)), ("width", json!(w))],
        ));
    }
    let mut next_id = match finite_num(data.get("nextId")) {
        Some(n) => n.floor(),
        None => 1.0,
    };
    for u in &src {
        if let Some(id) = finite_num(u.get("id")) {
            next_id = next_id.max(id.floor() + 1.0);
        }
    }
    let others: Vec<Value> = src
        .iter()
        .filter(|u| !u.is_null() && kind_of(u) != Some(Kind::PartyHall))
        .cloned()
        .collect();
    let mut out: Vec<Value> = others.clone();
    out.extend(kept.iter().cloned());
    let mut struct_cols2 = struct_cols.clone();
    for h in &kept {
        let hf = h["floor"].as_i64().unwrap();
        let hx = h["x"].as_i64().unwrap();
        let hw = h["width"].as_i64().unwrap();
        for f in [hf, hf + 1] {
            for i in 0..hw {
                let x = hx + i;
                if paved(&struct_cols2, f, x) {
                    continue;
                }
                struct_cols2.entry(f).or_default().insert(x);
                out.push(floor_unit(next_id as i64, f, x));
                next_id += 1.0;
            }
        }
    }
    let with_log = |units: Vec<Value>, drop_count: usize| -> Value {
        let mut log = data.get("log").cloned();
        if drop_count > 0 {
            let entry = json!({
                "minute": if is_num(data.get("minutes")) && data["minutes"].as_f64().unwrap().is_finite() { data["minutes"].clone() } else { json!(0) },
                "text": if drop_count == 1 {
                    "A party hall was removed: it is now two stories and had no room to grow. Rebuild it where two floors are free.".to_string()
                } else {
                    format!("{drop_count} party halls were removed: they are now two stories and had no room to grow. Rebuild them where two floors are free.")
                },
                "kind": "bad"
            });
            log = Some(match log {
                Some(Value::Array(mut a)) => {
                    a.push(entry);
                    Value::Array(a)
                }
                _ => Value::Array(vec![entry]),
            });
        }
        let mut patches = vec![
            ("version", json!(6)),
            ("units", Value::Array(units)),
            ("nextId", json!(next_id)),
        ];
        if let Some(l) = log {
            patches.push(("log", l));
        }
        with(data, patches)
    };
    let result = with_log(out, dropped);
    let input_valid = migration_looks_valid(data);
    if (input_valid && !migration_looks_valid(&result))
        || floating_structure_count(&result) > floating_structure_count(data)
    {
        return with_log(others, halls.len());
    }
    result
}

// ---- saveMigration.ts ----------------------------------------------------------

fn is_game_mode(v: Option<&Value>) -> bool {
    matches!(v.and_then(Value::as_str), Some("classic") | Some("modern"))
}

/// `migrateSave(data)`.
pub fn migrate_save(data: &Value) -> Value {
    let raw_version = data.get("version").and_then(Value::as_f64);
    let valid = raw_version
        .is_some_and(|v| v.is_finite() && v.fract() == 0.0 && v >= OLDEST_SAVE_VERSION as f64);
    let version = if valid {
        raw_version.unwrap()
    } else {
        OLDEST_SAVE_VERSION as f64
    };
    let mut migrated = if raw_version == Some(version) {
        data.clone()
    } else {
        with(data, vec![("version", json!(version))])
    };
    if !is_game_mode(migrated.get("mode")) {
        if let Some(units) = migrated.get("units").and_then(Value::as_array) {
            let units: Vec<Value> = units
                .iter()
                .map(|u| {
                    let sold_shell = u.is_object()
                        && kind_of(u) == Some(Kind::Condo)
                        && u.get("everOccupied") == Some(&Value::Bool(true))
                        && u.get("rent").is_none()
                        && u.get("state").and_then(Value::as_str).unwrap_or("empty") != "empty"
                        && u.get("state").and_then(Value::as_str) != Some("gutted")
                        && u.get("state").and_then(Value::as_str) != Some("construction");
                    if sold_shell {
                        with(u, vec![("rent", json!(LEGACY_CONDO_DEFAULT_PRICE))])
                    } else {
                        u.clone()
                    }
                })
                .collect();
            migrated = with(&migrated, vec![("units", Value::Array(units))]);
        }
    }
    let v = |m: &Value| version_of(m);
    if v(&migrated) == Some(1.0) {
        migrated = upgrade_v1_to_v2(&migrated);
    }
    if v(&migrated) == Some(2.0) {
        migrated = with(&migrated, vec![("version", json!(3))]);
    }
    if v(&migrated) == Some(3.0) {
        migrated = with(&migrated, vec![("version", json!(4))]);
    }
    if v(&migrated) == Some(4.0) {
        migrated = widen_legacy_elevator_shafts(&with(&migrated, vec![("version", json!(5))]));
    }
    if v(&migrated) == Some(5.0) {
        migrated = expand_legacy_party_halls(&migrated);
    }
    if v(&migrated) == Some(6.0) {
        migrated = with(&migrated, vec![("version", json!(7))]);
    }
    if v(&migrated) == Some(7.0) {
        migrated = widen_legacy_elevator_shafts(&migrated);
    }
    migrated
}

// ---- deserializeGuards.ts ------------------------------------------------------

fn sane_id(v: Option<&Value>) -> Option<i64> {
    let x = v.and_then(Value::as_f64)?;
    if x.is_finite() && x.fract() == 0.0 && x > 0.0 && x < 2147483648.0 {
        Some(x as i64)
    } else {
        None
    }
}

/// `repairEntityIds`: hand corrupt or duplicate ids a fresh one; returns nextId.
fn repair_entity_ids(ids: &mut [Option<i64>], raw_next_id: Option<&Value>) -> i64 {
    let mut max_loaded = 0;
    for id in ids.iter().flatten() {
        if *id > max_loaded {
            max_loaded = *id;
        }
    }
    let mut seen: HashSet<i64> = HashSet::new();
    for id in ids.iter_mut() {
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

/// `dropOverlappingUnits`: first kept wins, per layer.
fn drop_overlapping_units(units: Vec<(Unit, Option<i64>)>) -> Vec<(Unit, Option<i64>)> {
    let mut claimed_structure: HashMap<i64, Vec<u8>> = HashMap::new();
    let mut claimed_rooms: HashMap<i64, Vec<u8>> = HashMap::new();
    let mut out = Vec::new();
    for (u, id) in units {
        let layer = if u.kind.is_structural() {
            &mut claimed_structure
        } else {
            &mut claimed_rooms
        };
        let stories = u.kind.floors();
        let mut free = true;
        'scan: for f in u.floor..u.floor + stories {
            if let Some(row) = layer.get(&f) {
                for i in u.x..u.x + u.width {
                    if row[i as usize] != 0 {
                        free = false;
                        break 'scan;
                    }
                }
            }
        }
        if !free {
            continue;
        }
        for f in u.floor..u.floor + stories {
            let row = layer.entry(f).or_insert_with(|| vec![0u8; LOT as usize]);
            for i in u.x..u.x + u.width {
                row[i as usize] = 1;
            }
        }
        out.push((u, id));
    }
    out
}

// ---- coerce.ts -----------------------------------------------------------------

fn coerce_log(v: Option<&Value>) -> Vec<LogEntry> {
    let Some(arr) = v.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out: Vec<LogEntry> = Vec::new();
    for e in arr.iter().rev() {
        if out.len() >= LOG_RING_CAP {
            break;
        }
        let Some(o) = e.as_object() else { continue };
        let Some(text) = o.get("text").and_then(Value::as_str) else {
            continue;
        };
        let mut t: Vec<u16> = text.encode_utf16().collect();
        if t.len() > LOG_TEXT_CAP {
            t.truncate(LOG_TEXT_CAP);
        }
        if t.len() == LOG_TEXT_CAP && t.last().is_some_and(|&c| (0xD800..=0xDBFF).contains(&c)) {
            t.pop();
        }
        let text = String::from_utf16_lossy(&t);
        let minute = match finite_num(o.get("minute")) {
            Some(m) => m.max(0.0),
            None => 0.0,
        };
        let kind = match o.get("kind").and_then(Value::as_str) {
            Some("good") => LogKind::Good,
            Some("bad") => LogKind::Bad,
            Some("money") => LogKind::Money,
            _ => LogKind::Info,
        };
        out.push(LogEntry { minute, text, kind });
    }
    out.reverse();
    out
}

const VIEW_ZOOM_MIN: f64 = 0.06;
const VIEW_ZOOM_MAX: f64 = 3.0;

fn coerce_view(v: Option<&Value>) -> Option<Value> {
    let o = v?.as_object()?;
    let tile = finite_num(o.get("tile"))?;
    let floor = finite_num(o.get("floor"))?;
    let mut out = Map::new();
    out.insert("tile".into(), json!(tile.min(LOT as f64).max(0.0)));
    out.insert(
        "floor".into(),
        json!(floor.min(MAX_FLOOR as f64).max(MIN_FLOOR as f64)),
    );
    match o.get("zoom") {
        None | Some(Value::Null) => {}
        Some(z) => {
            let z = finite_num(Some(z))?;
            out.insert(
                "zoom".into(),
                json!(z.min(VIEW_ZOOM_MAX).max(VIEW_ZOOM_MIN)),
            );
        }
    }
    Some(Value::Object(out))
}

fn coerce_dirty_days(state: UnitState, kind: Kind, raw: Option<&Value>) -> Option<i64> {
    if state != UnitState::Dirty || !kind.is_hotel() {
        return None;
    }
    let raw = raw?;
    let n = match raw.as_f64() {
        Some(x) if x.is_finite() => x.floor().max(0.0) as i64,
        _ => 0,
    };
    Some(n.min(crate::housekeeping::INFEST_DAYS - 1))
}

fn parse_state(v: Option<&Value>) -> Option<UnitState> {
    Some(match v?.as_str()? {
        "construction" => UnitState::Construction,
        "empty" => UnitState::Empty,
        "occupied" => UnitState::Occupied,
        "moving_in" => UnitState::MovingIn,
        "vacating" => UnitState::Vacating,
        "asleep" => UnitState::Asleep,
        "dirty" => UnitState::Dirty,
        "infested" => UnitState::Infested,
        "fire" => UnitState::Fire,
        "gutted" => UnitState::Gutted,
        _ => return None,
    })
}

fn vacate_reason(v: Option<&Value>) -> Option<&'static str> {
    Some(match v?.as_str()? {
        "access" => "access",
        "noTransport" => "noTransport",
        "congestion" => "congestion",
        "rent" => "rent",
        "noise" => "noise",
        "transportFar" => "transportFar",
        "lobbyFar" => "lobbyFar",
        "unmetDemand" => "unmetDemand",
        "relocation" => "relocation",
        _ => return None,
    })
}

// ---- founderStatus.ts ----------------------------------------------------------

/// JS `Number.parseInt(s, 10)` as an option.
fn parse_int(s: &str) -> Option<f64> {
    let t = s.trim_start();
    let (neg, rest) = match t.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, t.strip_prefix('+').unwrap_or(t)),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let v: f64 = digits.parse().ok()?;
    Some(if neg { -v } else { v })
}

/// `detectFounder(raw)`.
pub fn detect_founder(raw: &Value) -> bool {
    if raw.get("founder") == Some(&Value::Bool(true)) {
        return true;
    }
    raw.get("appVersion")
        .and_then(Value::as_str)
        .and_then(parse_int)
        .is_some_and(|v| v < 2.0)
}

/// `markFounderFromLoadedFile(sim, raw)`.
pub fn mark_founder_from_loaded_file(sim: &mut Simulation, raw: &Value) {
    if !sim.founder && raw.get("appVersion").is_none() {
        sim.founder = true;
    }
}

// ---- serialization.ts: deserialize --------------------------------------------

/// `Simulation.deserialize(raw)`.
pub fn deserialize(raw: &Value) -> Simulation {
    let data = migrate_save(raw);
    let mode = match data.get("mode").and_then(Value::as_str) {
        Some("modern") => GameMode::Modern,
        _ => GameMode::Classic,
    };
    let calendar = match data.get("modernCalendar").and_then(Value::as_str) {
        Some("canon") => CalendarKind::Canon,
        _ => CalendarKind::RealWorld,
    };
    let seed = to_uint32(js_number(data.get("seed")));
    let mut sim = Simulation::new(seed, mode, calendar, false);
    let modern = mode == GameMode::Modern;
    sim.auto_bridge = if modern {
        data.get("autoBridge") != Some(&Value::Bool(false))
            && data.get("manualStructure") != Some(&Value::Bool(true))
    } else {
        true
    };
    if let Some(s) = finite_num(data.get("initialSeed")) {
        sim.rng.initial_seed = to_uint32(s);
    }
    sim.money = num(data.get("money"), sim.money);
    sim.star = (num(data.get("star"), 1.0).floor() as i64).clamp(1, 6);
    sim.clock = Clock::new(num(data.get("minutes"), 0.0).max(0.0), sim.clock.calendar);
    sim.evaluated_tower = data
        .get("evaluatedTower")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    sim.vip_visit_day = match data.get("vipVisitDay") {
        None | Some(Value::Null) => -1,
        Some(v) => v.as_f64().map(|x| x as i64).unwrap_or(-1),
    };
    sim.vip_favorable = match data.get("vipFavorable") {
        None | Some(Value::Null) => false,
        Some(v) => v.as_bool().unwrap_or(false),
    };
    sim.vip_visits = (num(data.get("vipVisits"), 0.0)
        .floor()
        .min(VIP_VISITS_CAP)
        .max(0.0)) as i64;
    if data.get("vipVisits").is_none() && (sim.vip_favorable || sim.evaluated_tower) {
        sim.vip_visits = if sim.evaluated_tower { 2 } else { 1 };
    }
    sim.last_vip_nag_day = (match finite_num(data.get("lastVipNagDay")) {
        Some(d) => d.floor() as i64,
        None => -100,
    })
    .min(sim.clock.day());
    sim.treasures_found = num(data.get("treasuresFound"), 0.0).max(0.0);
    sim.extermination_due_day = if modern {
        finite_num(data.get("exterminationDueDay")).map(|d| {
            let day = sim.clock.day() as f64;
            d.floor().max(day).min(day + 1.0)
        })
    } else {
        None
    };
    if let Some(a) = data.get("excavated").and_then(Value::as_array) {
        for k in a {
            if let Some(s) = k.as_str() {
                if !sim.excavated.iter().any(|e| e == s) {
                    sim.excavated.push(s.to_string());
                }
            }
        }
    }
    if let Some(a) = data.get("blockbusters").and_then(Value::as_array) {
        let mut set: IndexSet<i64> = IndexSet::new();
        for v in a {
            if let Some(n) = v.as_f64() {
                if n.is_finite() {
                    set.insert(n as i64);
                }
            }
        }
        sim.blockbusters = set.into_iter().collect();
    }
    if let Some(a) = data.get("milestones").and_then(Value::as_array) {
        for v in a {
            if let Some(s) = v.as_str() {
                if !sim.milestones.iter().any(|m| m == s) {
                    sim.milestones.push(s.to_string());
                }
            }
        }
    }
    sim.ledger = Ledger::restore(data.get("ledger"));
    sim.view = coerce_view(data.get("view"));
    sim.log = coerce_log(data.get("log"));

    // ---- units ----
    let mut raw_units: Vec<&Value> = Vec::new();
    if let Some(arr) = data.get("units").and_then(Value::as_array) {
        for u in arr {
            if u.is_null() || kind_of(u).is_none() {
                continue;
            }
            raw_units.push(u);
            assert!(
                raw_units.len() <= UNIT_CAP,
                "This save lists more than {UNIT_CAP} units"
            );
        }
    }
    let mut units: Vec<(Unit, Option<i64>)> = Vec::new();
    for u in raw_units {
        let kind = kind_of(u).unwrap();
        let stories = kind.floors();
        let cat = kind.facility().width;
        let floor =
            (round(num(u.get("floor"), 1.0)) as i64).clamp(MIN_FLOOR, MAX_FLOOR - (stories - 1));
        let x = (round(num(u.get("x"), 0.0)) as i64).clamp(0, LOT - 1);
        let cap = if kind.is_structural() { cat } else { LOT - x };
        let width = (round(num(u.get("width"), cat as f64)) as i64)
            .min(cap)
            .min(LOT - x)
            .max(1);
        let state = if kind.is_structural() {
            UnitState::Empty
        } else {
            parse_state(u.get("state")).unwrap_or(UnitState::Empty)
        };
        let not_owned = matches!(
            state,
            UnitState::Empty | UnitState::Construction | UnitState::Gutted
        );
        let ever_occupied =
            u.get("everOccupied") == Some(&Value::Bool(true)) && !(not_owned && !kind.is_hotel());
        let sold_condo = kind == Kind::Condo && ever_occupied;
        let keep_household = ever_occupied && kind.has_household();
        let ladder_priced = !modern && classic_ladder(kind).is_some();
        let mut rent: Option<f64> = match u.get("rent") {
            None => None,
            Some(r) if ladder_priced => Some(r.as_f64().unwrap_or(f64::NAN)),
            Some(r) => Some(num(
                Some(r),
                rent_config(kind).map(|c| c.default).unwrap_or(0.0),
            )),
        };
        if let Some(r) = rent {
            if kind == Kind::Condo {
                let ladder = if modern {
                    None
                } else {
                    classic_ladder(Kind::Condo)
                };
                if sold_condo {
                    rent = Some(match ladder {
                        Some(l) => r.min(l[3]).max(l[0]),
                        None => r.min(SOLD_CONDO_MAX_PRICE).max(SOLD_CONDO_MIN_PRICE),
                    });
                } else if ladder.is_none() {
                    let band = rent_config(Kind::Condo).unwrap();
                    rent = Some(r.min(band.max).max(band.min));
                }
            }
        }
        let residents = if keep_household && modern {
            match u.get("residents") {
                None => None,
                Some(r) => {
                    let v = if r.as_f64().is_some_and(|x| x.is_finite()) {
                        r.as_f64().unwrap()
                    } else {
                        3.0
                    };
                    Some((round(v) as i64).clamp(2, 5))
                }
            }
        } else {
            None
        };
        let film_policy: Option<&'static str> = match u.get("filmPolicy").and_then(Value::as_str) {
            Some("feature") => Some("feature"),
            Some("blockbuster") => Some("blockbuster"),
            Some("auto") => Some("auto"),
            _ => None,
        };
        let subtype: Option<&'static str> = match (
            u.get("subtype").and_then(Value::as_str),
            kind.subtype_list(),
        ) {
            (Some(s), Some(list)) => list.iter().copied().find(|c| *c == s),
            _ => None,
        };
        let retail = kind.subtype_list().is_some();
        let retail_field = |key: &str| -> Option<f64> {
            if !retail {
                return None;
            }
            let v = u.get(key)?;
            Some(num(Some(v), 0.0).max(0.0))
        };
        let no_rate =
            rent_config(kind).is_some() && !modern && u.get("noRate") == Some(&Value::Bool(true));
        let unit = Unit {
            id: 0,
            kind,
            floor,
            x,
            width,
            state,
            satisfaction: if kind.is_structural() {
                1.0
            } else {
                num(u.get("satisfaction"), 1.0).min(1.0).max(0.0)
            },
            occupants: if kind.attendance_cap().is_some() || kind.is_structural() {
                0
            } else {
                num(u.get("occupants"), 0.0).max(0.0) as i64
            },
            customers_in: None,
            hotel_customers_in: None,
            out_for_meal: None,
            residents,
            ever_occupied,
            pending_income: num(u.get("pendingIncome"), 0.0),
            rent,
            no_rate,
            label: u
                .get("label")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .unwrap_or_else(|| kind.facility().name.to_string()),
            vacate_reason: vacate_reason(u.get("vacateReason")),
            vacate_at: u.get("vacateAt").map(|v| num(Some(v), 0.0)),
            film_policy,
            subtype,
            patronage_today: retail_field("patronageToday"),
            patronage_yest: retail_field("patronageYest"),
            profit_today: retail_field("profitToday"),
            profit_yest: retail_field("profitYest"),
            complete_at: u.get("completeAt").and_then(Value::as_f64),
            dirty_days: coerce_dirty_days(state, kind, u.get("dirtyDays")),
        };
        units.push((unit, sane_id(u.get("id"))));
    }
    let units = drop_overlapping_units(units);
    let (mut units, mut unit_ids): (Vec<Unit>, Vec<Option<i64>>) = units.into_iter().unzip();
    // Snap-on-load for ladder-priced kinds (Classic).
    let mut rents_snapped = 0;
    let mut has_condo = false;
    if !modern {
        for u in units.iter_mut() {
            if u.kind == Kind::Condo {
                has_condo = true;
            }
            let Some(ladder) = classic_ladder(u.kind) else {
                continue;
            };
            let cfg = rent_config(u.kind).unwrap();
            let effective = u.rent.unwrap_or(cfg.default);
            let snapped = match u.rent {
                None => ladder[2],
                Some(r) => snap_to_ladder(&ladder, r),
            };
            if !u.no_rate && snapped != effective {
                rents_snapped += 1;
            }
            u.rent = if snapped == cfg.default {
                None
            } else {
                Some(snapped)
            };
        }
    }
    // ---- transports ----
    let pool_cap: usize = POOLED_CAPS.iter().map(|p| p.cap as usize).sum();
    let mut transports: Vec<(Transport, Option<i64>)> = Vec::new();
    let mut kept: Vec<Transport> = Vec::new();
    if let Some(arr) = data.get("transports").and_then(Value::as_array) {
        let mut mapped: Vec<(Transport, Option<i64>)> = Vec::new();
        for t in arr {
            if t.is_null() {
                continue;
            }
            let Some(kind) = kind_of(t) else { continue };
            let max_cars = if kind.is_elevator() {
                kind.max_cars()
            } else {
                0
            };
            let cars = (num(t.get("cars"), 0.0).floor() as i64).clamp(0, max_cars);
            let bottom = (round(num(t.get("bottom"), 1.0)) as i64).clamp(MIN_FLOOR, MAX_FLOOR - 1);
            let top = (round(num(t.get("top"), (bottom + 1) as f64)) as i64)
                .min(MAX_FLOOR)
                .max(bottom + 1);
            let cat = kind.facility().width;
            let w0 = round(num(t.get("width"), cat as f64)) as i64;
            let width = if w0 > 0 { w0.min(cat) } else { cat };
            let x = (round(num(t.get("x"), 0.0)) as i64).clamp(0, LOT - width);
            let fix_len = |raw: Option<&Value>, fill: f64| -> Vec<f64> {
                (0..cars as usize)
                    .map(|i| match raw.and_then(Value::as_array) {
                        Some(a) => num(a.get(i), fill),
                        None => fill,
                    })
                    .collect()
            };
            let car_load = match t.get("carLoad") {
                None | Some(Value::Null) | Some(Value::Bool(false)) => None,
                Some(Value::Number(n)) if n.as_f64() == Some(0.0) => None,
                Some(Value::String(s)) if s.is_empty() => None,
                Some(v) => Some(fix_len(Some(v), 0.0)),
            };
            let skip_floors = t.get("skipFloors").and_then(Value::as_array).map(|a| {
                a.iter()
                    .filter_map(Value::as_f64)
                    .filter(|n| n.is_finite())
                    .map(|n| n as i64)
                    .collect::<Vec<i64>>()
            });
            let tr = Transport {
                id: 0,
                kind,
                x,
                width,
                bottom,
                top,
                cars,
                car_positions: fix_len(t.get("carPositions"), bottom as f64),
                car_dir: fix_len(t.get("carDir"), 0.0)
                    .into_iter()
                    .map(|d| d as i64)
                    .collect(),
                car_load,
                load: t.get("load").and_then(Value::as_f64).unwrap_or(0.0) as i64,
                skip_floors,
                schedule: Schedule::coerce(t.get("schedule"), cars, bottom, top),
            };
            mapped.push((tr, sane_id(t.get("id"))));
        }
        mapped.truncate(pool_cap);
        for (t, id) in mapped {
            let mut overlaps = false;
            for p in &kept {
                if t.x >= p.x + p.width || p.x >= t.x + t.width {
                    continue;
                }
                if t.bottom > p.top || p.bottom > t.top {
                    continue;
                }
                if t.kind.is_fixed_span()
                    && p.kind.is_fixed_span()
                    && t.x == p.x
                    && t.width == p.width
                    && (t.bottom == p.top || t.top == p.bottom)
                {
                    continue;
                }
                overlaps = true;
                break;
            }
            if overlaps {
                continue;
            }
            kept.push(t.clone());
            transports.push((t, id));
        }
    }
    let (mut transports, mut transport_ids): (Vec<Transport>, Vec<Option<i64>>) =
        transports.into_iter().unzip();
    let mut all_ids: Vec<Option<i64>> = Vec::new();
    all_ids.append(&mut unit_ids);
    all_ids.append(&mut transport_ids);
    let next_id = repair_entity_ids(&mut all_ids, data.get("nextId"));
    for (i, u) in units.iter_mut().enumerate() {
        u.id = all_ids[i].unwrap();
    }
    for (i, t) in transports.iter_mut().enumerate() {
        t.id = all_ids[units.len() + i].unwrap();
    }
    sim.tower.units = units;
    sim.tower.transports = transports;
    sim.tower.next_id = next_id;
    sim.tower.tower_name = data
        .get("towerName")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    sim.tower.built_wedding_hall = data
        .get("builtWeddingHall")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    sim.tower.reindex();
    sim.tower.coerce_express_stops();
    if rents_snapped > 0 {
        let msg = format!(
            "Classic pricing: rents snapped to the four 1994 rate levels.{}",
            if has_condo {
                " Condos can now sell for as little as $50,000."
            } else {
                ""
            }
        );
        sim.emit(&msg, LogKind::Info);
    }
    for u in &sim.tower.units {
        if u.state == UnitState::Construction {
            sim.constructing.insert(u.id);
        }
    }
    sim.events.active.clear();
    for u in &sim.tower.units {
        if u.state == UnitState::Fire {
            sim.events.active.insert(u.id);
        }
    }
    if let Some(ev) = data.get("events").and_then(Value::as_object) {
        sim.events.last_santa_year = num(ev.get("lastSantaYear"), -1.0) as i64;
        let st = to_uint32(num(ev.get("rngState"), 1.0));
        sim.events.extra = Rng::new(if st == 0 { 1 } else { st });
        sim.events.pending = ev.get("pending").and_then(Value::as_object).and_then(|p| {
            let kind: &'static str = match p.get("kind").and_then(Value::as_str) {
                Some("fireRescue") => "fireRescue",
                Some("bombThreat") => "bombThreat",
                _ => return None,
            };
            let cost = p
                .get("cost")
                .and_then(Value::as_f64)
                .filter(|c| c.is_finite())?;
            let message = match p.get("message") {
                None | Some(Value::Null) => String::new(),
                Some(Value::String(s)) => s.clone(),
                Some(v) => v.to_string(),
            };
            Some(PendingChoice {
                kind,
                cost,
                message,
            })
        });
    }
    sim.weather = weather_for(sim.clock.day());
    sim.last_day = sim.clock.day();
    sim.last_quarter = sim.clock.quarter();
    sim.last_quarter_money = num(data.get("lastQuarterMoney"), 0.0);
    sim.last_month =
        (sim.clock.day() as f64 / sim.clock.calendar.maint_period_days as f64).floor() as i64;
    sim.last_hour = sim.clock.hour();
    sim.adopt_milestones();
    sim.founder = detect_founder(raw);
    sim
}

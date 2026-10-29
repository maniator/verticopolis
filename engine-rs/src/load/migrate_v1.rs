//! The version 1 to 2 migration and the validity checks around it.

use super::*;

/// `migrationLooksValid`.
pub fn migration_looks_valid(data: &Value) -> bool {
    let version = version_of(data);
    let mut by_floor: IndexMap<String, Vec<(f64, f64)>> = IndexMap::new();
    for u in units_of(data) {
        let Some(kind) = kind_of(u) else { continue };
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
        // A room at no column overlaps nothing, and a NaN in the sort below
        // could hide an overlap between two others (#858).
        if x.is_nan() || is_far(floor) {
            continue;
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
    for u in units {
        if !struct_of(u) {
            continue;
        }
        let w = tile_width(u);
        let f = js_number(u.get("floor"));
        let x = js_number(u.get("x"));
        let mut i = 0.0;
        while i < w {
            structure.insert(tile_key(f, x + i));
            i += 1.0;
        }
    }
    let mut floating = 0;
    for u in units {
        if !struct_of(u) {
            continue;
        }
        let f = js_number(u.get("floor"));
        if f == 1.0 {
            continue;
        }
        let below = if f >= 2.0 { f - 1.0 } else { f + 1.0 };
        let w = tile_width(u);
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

pub(super) struct Room {
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
    for u in src {
        if !matches!(kind_of(u), Some(Kind::Floor) | Some(Kind::Lobby)) {
            continue;
        }
        let f = round(js_number(u.get("floor")));
        let x0 = round(js_number(u.get("x")));
        let w0 = round(match u.get("width") {
            None | Some(Value::Null) => 1.0,
            w => js_number(w),
        });
        if !f.is_finite() || !x0.is_finite() || !w0.is_finite() {
            continue;
        }
        let mut i = 0.0;
        while i < w0.min(LOT as f64) {
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
    for u in src {
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
        if !floor.is_finite()
            || !x0.is_finite()
            || !w0.is_finite()
            || w0 < 1.0
            || is_far(floor)
            || is_far(x0)
            || is_far(w0)
        {
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
            for f in floor..floor.saturating_add(fl) {
                obstacles
                    .entry(f)
                    .or_default()
                    .push((x, x.saturating_add(w)));
            }
        };
    // Parking runs.
    // Grouped by floor in one pass, floors in first-seen order and rooms in
    // save order within a floor (#1282).
    let mut park_by_floor: IndexMap<i64, Vec<usize>> = IndexMap::new();
    for (i, r) in rooms.iter().enumerate() {
        if is_park(r.kind) {
            park_by_floor.entry(r.floor).or_default().push(i);
        }
    }
    for mut units in park_by_floor.into_values() {
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
                && rooms[units[j + 1]].x0 == rooms[units[j]].x0.saturating_add(rooms[units[j]].w0)
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
                Some(ri) => rooms[run[ri]].x0.saturating_sub(items[ri].1),
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
                nx.insert(ri, left.saturating_add(off));
                nw.insert(ri, rooms[ri].w);
            }
            cursor = left.saturating_add(run.width);
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
        while x.saturating_add(w) <= LOT {
            let mut k = 0;
            while k < w && blocked[x.saturating_add(k) as usize] == 0 {
                k += 1;
            }
            if k == w {
                return Some(x);
            }
            x = x.saturating_add(k + 1);
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
                for i in x..x.saturating_add(r.w) {
                    blocked[i as usize] = 1;
                }
                placed.push((ri, x, r.w));
                cursor = x.saturating_add(r.w);
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
            let w = tile_width(u);
            let f = js_number(u.get("floor"));
            let x = js_number(u.get("x"));
            let mut i = 0.0;
            while i < w {
                paved.insert(tile_key(f, x + i));
                i += 1.0;
            }
        }
    }
    let mut next_id = finite_num(data.get("nextId")).map_or(1.0, f64::floor);
    for u in src {
        if let Some(id) = finite_num(u.get("id")) {
            next_id = next_id.max(id.floor() + 1.0);
        }
    }
    let mut out_units: Vec<Value> = others.clone();
    for (ri, r) in rooms.iter().enumerate() {
        let x = nx.get(&ri).copied().unwrap_or(r.x0);
        let w = nw.get(&ri).copied().unwrap_or(r.w0);
        out_units.push(with(&r.u, vec![("x", json!(x)), ("width", json!(w))]));
        for f in r.floor..r.floor.saturating_add(r.fl) {
            // Only columns on the lot: a room that keeps a saved footprint
            // past it fails the check after the reflow anyway (#858).
            for tx in x.max(0)..x.saturating_add(w).min(LOT) {
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

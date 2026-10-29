//! The version 5 to 6 migration.

use super::*;

/// `expandLegacyPartyHalls`.
pub fn expand_legacy_party_halls(data: &Value) -> Value {
    let src = units_of(data);
    let mut struct_cols: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut room_occ: HashMap<i64, HashSet<i64>> = HashMap::new();
    let mut lobby_cols: HashMap<i64, HashSet<i64>> = HashMap::new();
    for u in src {
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
    let halls: Vec<&Value> = src
        .iter()
        .filter(|u| kind_of(u) == Some(Kind::PartyHall))
        .collect();
    let mut kept: Vec<Value> = Vec::new();
    let mut dropped = 0;
    // Widths whose search found no room since the last placement. Only a
    // placement changes what a search sees, so the same width fails again
    // without the floor-by-floor scan (a forged save with thousands of halls
    // and nowhere to put them, #1282).
    let mut no_room_for: HashSet<i64> = HashSet::new();
    for u in halls.iter().copied() {
        let w = (round(num(u.get("width"), Kind::PartyHall.facility().width as f64)) as i64)
            .min(LOT)
            .max(1);
        if no_room_for.contains(&w) {
            dropped += 1;
            continue;
        }
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
            no_room_for.insert(w);
            dropped += 1;
            continue;
        };
        no_room_for.clear();
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
    for u in src {
        if let Some(id) = finite_num(u.get("id")) {
            next_id = next_id.max(id.floor() + 1.0);
        }
    }
    let others: Vec<&Value> = src
        .iter()
        .filter(|u| !u.is_null() && kind_of(u) != Some(Kind::PartyHall))
        .collect();
    let mut out: Vec<Value> = others.iter().map(|u| (*u).clone()).collect();
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
        return with_log(others.into_iter().cloned().collect(), halls.len());
    }
    result
}

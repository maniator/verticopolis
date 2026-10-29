//! Assembling a `Simulation` once the units are read.

use super::*;

/// The rest of `deserialize` once the units are read: `data` is the migrated
/// save, `units` its kept units in save order and `unit_ids` their saved ids
/// (one per unit), and `raw` the save as written, which the founder test
/// reads. It never reads `data["units"]`, which the streamed reader leaves
/// out.
pub(crate) fn assemble(
    data: &Value,
    mut units: Vec<Unit>,
    mut unit_ids: Vec<Option<i64>>,
    raw: &Value,
) -> Simulation {
    let mode = match data.get("mode").and_then(Value::as_str) {
        Some("modern") => GameMode::Modern,
        _ => GameMode::Classic,
    };
    let calendar = match data.get("modernCalendar").and_then(Value::as_str) {
        Some("canon") => CalendarKind::Canon,
        _ => CalendarKind::RealWorld,
    };
    // `new Simulation(data.seed, ...)`: the constructor's default seed applies
    // when the key is absent; any other value goes through `>>> 0`.
    let seed = match data.get("seed") {
        None => 12345,
        Some(v) => to_uint32(js_number(Some(v))),
    };
    let mut sim = Simulation::new(seed, mode, calendar, false);
    // The saved live state exactly, 0 included (#856): `new` maps 0 to 1 for
    // a new game. A missing or non-number seed keeps the constructor's.
    if let Some(s) = finite_num(data.get("seed")) {
        sim.rng.restore(to_uint32(s));
    }
    let modern = mode == GameMode::Modern;
    sim.auto_bridge = if mode.bridging_toggleable() {
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
    // Capped at 2^53 - 1 minutes (#858): the day is an `i64`, which saturates
    // past about 1.3e22 minutes where the TypeScript day keeps counting.
    sim.clock = Clock::new(
        num(data.get("minutes"), 0.0).clamp(0.0, MAX_SAFE_INTEGER),
        sim.clock.calendar,
    );
    sim.evaluated_tower = data
        .get("evaluatedTower")
        .map(|v| v.as_bool().unwrap_or(false));
    // `data.vipVisitDay ?? -1`: a number is kept as it is, fraction included.
    sim.vip_visit_day = match data.get("vipVisitDay") {
        None | Some(Value::Null) => -1.0,
        Some(v) => v.as_f64().unwrap_or(-1.0),
    };
    sim.vip_favorable = match data.get("vipFavorable") {
        None | Some(Value::Null) => false,
        Some(v) => v.as_bool().unwrap_or(false),
    };
    sim.vip_visits = (num(data.get("vipVisits"), 0.0)
        .floor()
        .min(VIP_VISITS_CAP)
        .max(0.0)) as i64;
    let evaluated = sim.evaluated_tower == Some(true);
    if data.get("vipVisits").is_none() && (sim.vip_favorable || evaluated) {
        sim.vip_visits = if evaluated { 2 } else { 1 };
    }
    sim.last_vip_nag_day = (match finite_num(data.get("lastVipNagDay")) {
        Some(d) => d.floor().clamp(-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER) as i64,
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
    if sim.extermination_due_day.is_some() {
        if let Some(value) = data.get("exterminationRoomIds") {
            let mut seen = std::collections::HashSet::new();
            let mut ids = Vec::new();
            if let Some(values) = value.as_array() {
                for value in values {
                    if let Some(id) = value.as_f64() {
                        if id.is_finite()
                            && id.fract() == 0.0
                            && id > 0.0
                            && id < 2147483648.0
                            && seen.insert(id as i64)
                        {
                            ids.push(id as i64);
                        }
                    }
                    if ids.len() >= UNIT_CAP {
                        break;
                    }
                }
            }
            sim.extermination_room_ids = Some(ids);
        }
    }
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
        // `new Set(ids.filter(finite))`: a fractional id is kept as it is (it
        // never matches a unit, but it saves back out unchanged).
        let mut ids: Vec<f64> = Vec::new();
        for v in a {
            if let Some(n) = v.as_f64() {
                if n.is_finite() && !ids.contains(&n) {
                    ids.push(n);
                }
            }
        }
        sim.blockbusters = ids;
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

    drop_overlapping_units(&mut units, &mut unit_ids);
    // A vector grown past its units would keep the spare room for the whole
    // session, so it keeps only the room the first placements need (#1259).
    units.shrink_to(units.len() + unit_list_headroom(units.len()));
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
                    .collect::<Vec<f64>>()
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
                    .map(|d| (d as i64).clamp(-1, 1))
                    .collect(),
                car_load,
                load: t
                    .get("load")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0)
                    .clamp(-MAX_SAFE_INTEGER, MAX_SAFE_INTEGER) as i64,
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
    // Units first, then transports, as one id space.
    let next_id = repair_entity_ids(&mut unit_ids, &mut transport_ids, data.get("nextId"));
    for (u, id) in units.iter_mut().zip(unit_ids) {
        u.id = id.unwrap();
    }
    for (t, id) in transports.iter_mut().zip(transport_ids) {
        t.id = id.unwrap();
    }
    sim.tower.units = units;
    sim.tower.transports = transports;
    sim.tower.next_id = next_id;
    sim.tower.tower_name = data
        .get("towerName")
        .map(|v| v.as_str().unwrap_or("").to_string());
    sim.tower.built_wedding_hall = data
        .get("builtWeddingHall")
        .map(|v| v.as_bool().unwrap_or(false));
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
    // `loadState(state)` runs for any truthy `events`: a number, a string or an
    // array has no fields, so it resets the Santa year, the extra rng (seed 1)
    // and the pending choice, the same as an empty object.
    let truthy = |v: &Value| match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    };
    let empty = Map::new();
    let events = data.get("events").and_then(|v| {
        if let Some(o) = v.as_object() {
            Some(o)
        } else if truthy(v) {
            Some(&empty)
        } else {
            None
        }
    });
    if let Some(ev) = events {
        sim.events.last_santa_year = num(ev.get("lastSantaYear"), -1.0);
        let st = to_uint32(num(ev.get("rngState"), 1.0));
        // The saved live state exactly, 0 included (#856).
        sim.events.extra = Rng::new(st);
        sim.events.extra.restore(st);
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
            // A message the game writes is a string; anything else reads as
            // none, as in TypeScript (#858).
            let message = match p.get("message") {
                Some(Value::String(s)) => s.clone(),
                _ => String::new(),
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

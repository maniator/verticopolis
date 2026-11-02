//! Reading a save into a `Simulation`: the entry points and the per-unit reader.

use super::*;

/// `Simulation.deserialize(raw)`.
pub fn deserialize(raw: &Value) -> Result<Simulation, String> {
    deserialize_owned(raw.clone())
}

/// Restore underground express stops from an ORIGINAL PC SimTower TDT file.
/// Ordinary saved towers keep the existing normalization; changing new
/// shafts or generic Classic save rules is not part of this bug (#1532).
pub fn deserialize_tdt(raw: &Value) -> Result<Simulation, String> {
    let mut sim = deserialize(raw)?;
    if sim.mode != GameMode::Classic {
        return Ok(sim);
    }
    let Some(source) = raw.get("transports").and_then(Value::as_array) else {
        return Ok(sim);
    };
    let mut changed = false;
    for shaft in &mut sim.tower.transports {
        if shaft.kind != Kind::ElevatorExpress || shaft.bottom >= 0 {
            continue;
        }
        let original = source.iter().find(|t| {
            t.get("kind").and_then(Value::as_str) == Some("elevatorExpress")
                && t.get("x").and_then(Value::as_i64) == Some(shaft.x)
                && t.get("bottom").and_then(Value::as_i64) == Some(shaft.bottom)
                && t.get("top").and_then(Value::as_i64) == Some(shaft.top)
        });
        let Some(authored) = original
            .and_then(|t| t.get("skipFloors"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        let saved_skips: Vec<f64> = authored
            .iter()
            .filter_map(Value::as_f64)
            .filter(|v| v.is_finite())
            .collect();
        let Some(skips) = shaft.skip_floors.as_mut() else {
            continue;
        };
        // Mark only shafts actually read from the original TDT. The marker
        // remains on ordinary .vctower saves and is checked during reload.
        shaft.preserve_basement_stops = true;
        let before = skips.len();
        // Only remove basement skips added by general load normalization.
        // Authored underground skips and all above-ground rules survive.
        skips.retain(|floor| *floor > 0.0 || saved_skips.contains(floor));
        changed |= skips.len() != before;
    }
    if changed {
        sim.tower.revision += 1;
    }
    Ok(sim)
}

/// `deserialize` on a save this call owns: the save is migrated in place and
/// each unit entry is freed as it is converted, so the load holds the save
/// and the game it builds, not the save several times over (#1225).
pub fn deserialize_owned(raw: Value) -> Result<Simulation, String> {
    // `migrateSave(null)` throws reading `version`; any other top-level value
    // loads as the TypeScript loads it (#858).
    if raw.is_null() {
        return Err("not a tower save (the save is null)".into());
    }
    // The founder test reads the save as written, and `assemble` reads
    // nothing else from it, so two keys stand in for it.
    let written = founder_keys(&raw);
    let mut data = migrate_save_owned(raw);
    let modern = data.get("mode").and_then(Value::as_str) == Some("modern");
    let listed = match data.get_mut("units") {
        Some(Value::Array(units)) => std::mem::take(units),
        _ => Vec::new(),
    };
    // The entries `unit_from_value` keeps, counted before any unit is built,
    // so a save past the cap is refused first and the rest fill vectors of
    // their exact size.
    let kept = listed
        .iter()
        .filter(|u| kind_of(u).is_some())
        .take(UNIT_CAP + 1)
        .count();
    if kept > UNIT_CAP {
        return Err(format!(
            "This save lists more than {UNIT_CAP} units, more than the whole lot can hold, so it cannot be a real tower."
        ));
    }
    let mut units = Vec::with_capacity(kept + unit_list_headroom(kept));
    let mut ids = Vec::with_capacity(kept);
    for entry in listed {
        if let Some((unit, id)) = unit_from_value(&entry, modern) {
            units.push(unit);
            ids.push(id);
        }
    }
    debug_assert_eq!(units.len(), kept, "unit_from_value skipped a counted entry");
    Ok(assemble(&data, units, ids, &written))
}

/// The keys `detect_founder` reads off a save.
pub(crate) fn founder_keys(raw: &Value) -> Value {
    let mut keys = Map::new();
    for key in ["founder", "appVersion"] {
        if let Some(v) = raw.get(key) {
            keys.insert(key.to_string(), v.clone());
        }
    }
    Value::Object(keys)
}

/// One entry of a save's `units` array as `deserialize` reads it, with its
/// saved id; `None` for an entry it skips (null, or a kind the catalog does
/// not know), exactly when `kind_of` gives `None`, which the unit cap's
/// count in `deserialize` relies on. It reads nothing outside the entry but
/// the save's mode.
pub(crate) fn unit_from_value(u: &Value, modern: bool) -> Option<(Unit, Option<i64>)> {
    let kind = kind_of(u)?;
    let cat = kind.facility().width;
    // `drop_overlapping_units` indexes its tile grids by the floors and tiles
    // these clamps allow, so a loosened clamp would trap there.
    let floor =
        (round(num(u.get("floor"), 1.0)) as i64).clamp(MIN_FLOOR, kind.highest_base_floor());
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
                    Some(l) => js_max(l[0], js_min(l[3], r)),
                    None => js_max(SOLD_CONDO_MIN_PRICE, js_min(SOLD_CONDO_MAX_PRICE, r)),
                });
            } else if ladder.is_none() {
                let band = rent_config(Kind::Condo).unwrap();
                rent = Some(js_max(band.min, js_min(band.max, r)));
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
            num(u.get("occupants"), 0.0).clamp(0.0, MAX_SAFE_INTEGER) as i64
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
        complete_at_raw: match u.get("completeAt") {
            Some(v) if !v.is_number() => Some(v.clone()),
            _ => None,
        },
        dirty_days: coerce_dirty_days(state, kind, u.get("dirtyDays")),
    };
    Some((unit, sane_id(u.get("id"))))
}

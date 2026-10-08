//! Port of `src/engine/elevatorSchedule.ts`: the optional per-shaft schedule.

use serde_json::{json, Map, Value};

pub const SCHEDULE_HOURS: usize = 24;
const SECONDS_PER_GAME_MINUTE: f64 = 60.0;
pub const WAITING_CAR_RESPONSE_MAX: f64 = 30.0;
pub const STANDARD_FLOOR_DEPARTURE_MAX: f64 = 60.0;

#[derive(Clone, Debug, PartialEq)]
pub struct Schedule {
    pub weekday: Option<Vec<i64>>,
    pub weekend: Option<Vec<i64>>,
    pub waiting_car_response: Option<f64>,
    pub standard_floor_departure: Option<f64>,
    pub home_floors: Option<Vec<i64>>,
}

fn finite(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite())
}

fn coerce_row(raw: &Value, cars: i64) -> Vec<i64> {
    let arr = raw.as_array();
    (0..SCHEDULE_HOURS)
        .map(|h| {
            let v = finite(arr.and_then(|a| a.get(h))).unwrap_or(cars as f64);
            (v.floor() as i64).clamp(0, cars)
        })
        .collect()
}

impl Schedule {
    pub fn is_empty(&self) -> bool {
        let no_rows = self.weekday.as_ref().is_none_or(|w| w.is_empty())
            && self.weekend.as_ref().is_none_or(|w| w.is_empty());
        no_rows
            && self.waiting_car_response.is_none()
            && self.standard_floor_departure.is_none()
            && self.home_floors.as_ref().is_none_or(|h| h.is_empty())
    }

    /// `coerceSchedule(raw, cars, bottom, top)`.
    pub fn coerce(raw: Option<&Value>, cars: i64, bottom: i64, top: i64) -> Option<Schedule> {
        let r = raw?.as_object()?;
        if cars <= 0 {
            return None;
        }
        let mut out = Schedule {
            weekday: None,
            weekend: None,
            waiting_car_response: None,
            standard_floor_departure: None,
            home_floors: None,
        };
        if let Some(a) = r.get("activeCars").and_then(Value::as_object) {
            if let Some(w) = a.get("weekday").and_then(Value::as_array) {
                if !w.is_empty() {
                    out.weekday = Some(coerce_row(&a["weekday"], cars));
                }
            }
            if let Some(w) = a.get("weekend").and_then(Value::as_array) {
                if !w.is_empty() {
                    out.weekend = Some(coerce_row(&a["weekend"], cars));
                }
            }
        }
        if let Some(v) = finite(r.get("waitingCarResponse")) {
            out.waiting_car_response = Some(crate::jsmath::round(v).clamp(0.0, WAITING_CAR_RESPONSE_MAX));
        }
        if let Some(v) = finite(r.get("standardFloorDeparture")) {
            out.standard_floor_departure =
                Some(crate::jsmath::round(v).clamp(0.0, STANDARD_FLOOR_DEPARTURE_MAX));
        }
        if let Some(h) = r.get("homeFloors").and_then(Value::as_array) {
            let n = (h.len() as i64).min(cars).max(0) as usize;
            if n > 0 {
                out.home_floors = Some(
                    (0..n)
                        .map(|i| {
                            let v = finite(h.get(i)).unwrap_or(bottom as f64);
                            (crate::jsmath::round(v) as i64).clamp(bottom, top)
                        })
                        .collect(),
                );
            }
        }
        if out.is_empty() {
            None
        } else {
            Some(out)
        }
    }

    /// `cloneSchedule` as a save writes it (set keys only).
    pub fn to_json(&self) -> Value {
        let mut m = Map::new();
        if self.weekday.is_some() || self.weekend.is_some() {
            let mut a = Map::new();
            if let Some(w) = &self.weekday {
                a.insert("weekday".into(), json!(w));
            }
            if let Some(w) = &self.weekend {
                a.insert("weekend".into(), json!(w));
            }
            m.insert("activeCars".into(), Value::Object(a));
        }
        if let Some(v) = self.waiting_car_response {
            m.insert("waitingCarResponse".into(), json!(v));
        }
        if let Some(v) = self.standard_floor_departure {
            m.insert("standardFloorDeparture".into(), json!(v));
        }
        if let Some(h) = &self.home_floors {
            m.insert("homeFloors".into(), json!(h));
        }
        Value::Object(m)
    }

    /// `activeCarCount`.
    pub fn active_car_count(s: Option<&Schedule>, is_weekend: bool, hour: i64, cars: i64) -> i64 {
        let Some(s) = s else { return cars };
        let row = if is_weekend { &s.weekend } else { &s.weekday };
        let Some(row) = row else { return cars };
        if row.is_empty() {
            return cars;
        }
        let h = hour.rem_euclid(SCHEDULE_HOURS as i64) as usize;
        match row.get(h) {
            Some(&v) => v.clamp(0, cars),
            None => cars,
        }
    }

    /// `homeFloorFor`.
    pub fn home_floor_for(s: Option<&Schedule>, car_index: usize, fallback: i64) -> i64 {
        let Some(hf) = s.and_then(|s| s.home_floors.as_ref()) else { return fallback };
        hf.get(car_index).copied().unwrap_or(fallback)
    }

    /// `dwellMinutesFor`.
    pub fn dwell_minutes_for(s: Option<&Schedule>, default_minutes: f64) -> f64 {
        match s.and_then(|s| s.standard_floor_departure) {
            None => default_minutes,
            Some(sd) => sd.clamp(0.0, STANDARD_FLOOR_DEPARTURE_MAX) / SECONDS_PER_GAME_MINUTE,
        }
    }

    /// `waitingResponseFor`.
    pub fn waiting_response_for(s: Option<&Schedule>) -> Option<f64> {
        s.and_then(|s| s.waiting_car_response)
            .map(|r| crate::jsmath::round(r).clamp(0.0, WAITING_CAR_RESPONSE_MAX))
    }

    /// `snapHomesToStops`.
    pub fn snap_homes_to_stops(&self, stops: &[i64]) -> Schedule {
        let Some(hf) = &self.home_floors else { return self.clone() };
        if hf.is_empty() || stops.is_empty() {
            return self.clone();
        }
        let mut moved = false;
        let snapped: Vec<i64> = hf
            .iter()
            .map(|&home| {
                if stops.contains(&home) {
                    return home;
                }
                let mut best = stops[0];
                let mut best_dist = i64::MAX;
                for &f in stops {
                    let d = (f - home).abs();
                    if d < best_dist {
                        best_dist = d;
                        best = f;
                    }
                }
                moved = true;
                best
            })
            .collect();
        if !moved {
            return self.clone();
        }
        let mut out = self.clone();
        out.home_floors = Some(snapped);
        out
    }
}

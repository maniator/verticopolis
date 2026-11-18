//! Port of the retired TypeScript `src/engine/elevatorSchedule.ts`: the optional per-shaft schedule.

use serde_json::{json, Map, Value};

pub const SCHEDULE_HOURS: usize = 24;
const SECONDS_PER_GAME_MINUTE: f64 = 60.0;
pub const WAITING_CAR_RESPONSE_MAX: f64 = 30.0;
pub const STANDARD_FLOOR_DEPARTURE_MAX: f64 = 60.0;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Schedule {
    pub weekday: Option<Vec<i64>>,
    pub weekend: Option<Vec<i64>>,
    pub waiting_car_response: Option<f64>,
    pub standard_floor_departure: Option<f64>,
    pub home_floors: Option<Vec<i64>>,
    /// The hours the player cut back that a car sold since left at the whole
    /// fleet's size (#1546). Saved as `heldBack`; `None` when there are none.
    pub held_back: Option<HeldBack>,
    /// Whether the engine re-tunes the active-car rows every morning from
    /// the shaft's measured traffic (Modern, `schedule_auto.rs`). Saved as
    /// `autoTune`, written only when on, so a save from before it loads
    /// with Auto off.
    pub auto_tune: bool,
}

/// The hours of each day type, `0..24` in ascending order, that run fewer
/// cars than the shaft has by the player's choice though their count equals
/// the fleet, because a sale clamped them to it (#1546). A car bought back
/// does not join such an hour, as it joins one that runs every car
/// ([`Schedule::refit`]). Only an hour whose count is the fleet's size is
/// listed: one below it is cut back on its face.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HeldBack {
    pub weekday: Vec<usize>,
    pub weekend: Vec<usize>,
}

impl HeldBack {
    /// The hours `raw` lists for a row, kept where the row exists and runs
    /// the whole fleet of `cars`, in order and once each.
    fn coerce_hours(raw: Option<&Value>, row: Option<&Vec<i64>>, cars: i64) -> Vec<usize> {
        let (Some(list), Some(row)) = (raw.and_then(Value::as_array), row) else {
            return Vec::new();
        };
        let mut hours: Vec<usize> = list
            .iter()
            .filter_map(|v| finite(Some(v)))
            .filter(|h| h.fract() == 0.0 && (0.0..SCHEDULE_HOURS as f64).contains(h))
            .map(|h| h as usize)
            .filter(|&h| row.get(h) == Some(&cars))
            .collect();
        hours.sort_unstable();
        hours.dedup();
        hours
    }

    /// `heldBack` as a save writes it, `None` when it lists no hour.
    fn coerce(raw: Option<&Value>, s: &Schedule, cars: i64) -> Option<HeldBack> {
        let r = raw?.as_object()?;
        let held = HeldBack {
            weekday: Self::coerce_hours(r.get("weekday"), s.weekday.as_ref(), cars),
            weekend: Self::coerce_hours(r.get("weekend"), s.weekend.as_ref(), cars),
        };
        (!held.weekday.is_empty() || !held.weekend.is_empty()).then_some(held)
    }

    fn to_json(&self) -> Value {
        let mut m = Map::new();
        if !self.weekday.is_empty() {
            m.insert("weekday".into(), json!(self.weekday));
        }
        if !self.weekend.is_empty() {
            m.insert("weekend".into(), json!(self.weekend));
        }
        Value::Object(m)
    }
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
    /// A schedule that only turns Auto on: every car runs every hour until
    /// the first morning re-tune writes the rows. A Modern elevator is built
    /// with it (owner, 2026-11-17).
    pub fn auto_only() -> Schedule {
        Schedule {
            weekday: None,
            weekend: None,
            waiting_car_response: None,
            standard_floor_departure: None,
            home_floors: None,
            held_back: None,
            auto_tune: true,
        }
    }

    /// Whether `self` and `other` hold the same schedule, leaving out the
    /// rows the morning re-tune owns when both have Auto on, so the re-tune
    /// does not make an older undo step on the shaft refuse.
    pub fn same_but_auto_rows(&self, other: &Schedule) -> bool {
        if !(self.auto_tune && other.auto_tune) {
            return self == other;
        }
        self.waiting_car_response == other.waiting_car_response
            && self.standard_floor_departure == other.standard_floor_departure
            && self.home_floors == other.home_floors
    }

    /// The schedule a tower of a mode keeps: Auto is a Modern assist, so a
    /// mode without schedule assist clears it, and a schedule that leaves
    /// empty is none at all. The loader and the schedule setter both go
    /// through it.
    pub(crate) fn kept_by_mode(mut self, schedule_assist: bool) -> Option<Schedule> {
        if schedule_assist {
            return Some(self);
        }
        self.auto_tune = false;
        (!self.is_empty()).then_some(self)
    }

    pub fn is_empty(&self) -> bool {
        let no_rows = self.weekday.as_ref().is_none_or(|w| w.is_empty())
            && self.weekend.as_ref().is_none_or(|w| w.is_empty());
        no_rows
            && self.waiting_car_response.is_none()
            && self.standard_floor_departure.is_none()
            && self.home_floors.as_ref().is_none_or(|h| h.is_empty())
            && !self.auto_tune
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
            held_back: None,
            auto_tune: r.get("autoTune").and_then(Value::as_bool) == Some(true),
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
            out.waiting_car_response =
                Some(crate::jsmath::round(v).clamp(0.0, WAITING_CAR_RESPONSE_MAX) + 0.0);
        }
        if let Some(v) = finite(r.get("standardFloorDeparture")) {
            out.standard_floor_departure =
                Some(crate::jsmath::round(v).clamp(0.0, STANDARD_FLOOR_DEPARTURE_MAX) + 0.0);
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
        out.held_back = HeldBack::coerce(r.get("heldBack"), &out, cars);
        if out.is_empty() {
            None
        } else {
            Some(out)
        }
    }

    /// A player's edit (`raw`, which names no `heldBack`) with the held hours
    /// of the schedule it replaces, `before`, whose counts it leaves as they
    /// were, so pressing OK or changing something else keeps them held; an
    /// hour the edit sets to another count stops being held (#1546). An edit
    /// that names `heldBack`, as a save does, is taken as it is.
    pub(crate) fn keeping_untouched_held(raw: &Value, before: Option<&Schedule>) -> Value {
        let Some((before, held)) = before.and_then(|b| Some((b, b.held_back.as_ref()?))) else {
            return raw.clone();
        };
        if raw.get("heldBack").is_some() {
            return raw.clone();
        }
        let untouched = |day: &str, row: &Option<Vec<i64>>, hours: &[usize]| -> Vec<usize> {
            let edited = raw
                .get("activeCars")
                .and_then(|a| a.get(day))
                .and_then(Value::as_array);
            let same = |h: usize| match (edited, row) {
                (Some(e), Some(r)) => {
                    e.get(h).and_then(Value::as_f64) == r.get(h).map(|&n| n as f64)
                }
                // An edit without the row leaves it as it was.
                (None, _) => true,
                (Some(_), None) => false,
            };
            hours.iter().copied().filter(|&h| same(h)).collect()
        };
        let mut out = raw.clone();
        if let Some(map) = out.as_object_mut() {
            let kept = HeldBack {
                weekday: untouched("weekday", &before.weekday, &held.weekday),
                weekend: untouched("weekend", &before.weekend, &held.weekend),
            };
            map.insert("heldBack".into(), kept.to_json());
        }
        out
    }

    /// Whether an hour of either day type is held back (#1546).
    pub fn holds_an_hour(&self) -> bool {
        let held = self.held_back.as_ref();
        held.is_some_and(|h| !h.weekday.is_empty() || !h.weekend.is_empty())
    }

    /// Fits the duty pattern to a fleet that went from `was` cars to `cars`
    /// (#1546). A car bought joins every hour that ran the whole fleet; an
    /// hour the player cut back keeps its count, and so does one held back
    /// at the fleet's size. A car sold clamps each hour to the new fleet
    /// ([`Schedule::coerce`] does), and an hour cut back below the old fleet
    /// that the clamp leaves at the new one is held back, so a car bought
    /// back does not turn it into a whole-fleet hour.
    pub fn refit(&mut self, was: i64, cars: i64) {
        let mut held = self.held_back.take().unwrap_or_default();
        for (row, hours) in [
            (&mut self.weekday, &mut held.weekday),
            (&mut self.weekend, &mut held.weekend),
        ] {
            let Some(row) = row else {
                hours.clear();
                continue;
            };
            for (h, active) in row.iter_mut().enumerate() {
                let held_here = hours.contains(&h);
                if cars > was && *active >= was && !held_here {
                    *active = cars;
                } else if cars < was && !held_here && *active < was && *active >= cars {
                    hours.push(h);
                }
            }
            // Held only while the hour runs the whole fleet once the clamp
            // to `cars` applies.
            hours.retain(|&h| row.get(h).is_some_and(|&active| active >= cars));
            hours.sort_unstable();
        }
        let holds = !held.weekday.is_empty() || !held.weekend.is_empty();
        self.held_back = holds.then_some(held);
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
        if let Some(h) = &self.held_back {
            m.insert("heldBack".into(), h.to_json());
        }
        if self.auto_tune {
            m.insert("autoTune".into(), json!(true));
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

    /// The cars an Auto shaft runs: every car while anyone waits at its
    /// stops, and its row's `active` while nobody does. A car the row stands
    /// down only parks, so holding it back while people wait saves nothing
    /// and makes them wait longer. The 4.13 rule waited for more people than
    /// the cars on shift could take in one trip, and the owner's split tower
    /// (split-tower 31, Modern) still stood 600 to 1,400 people in its
    /// basement lines every weekday morning: a line of 120 at a 75-floor
    /// express on seven cars never reached a trip, while the cars came by
    /// full from the lower basements. With every car out once anyone waits,
    /// its next morning peaks at about 390 instead of about 770.
    /// The row still decides which cars park when the shaft is quiet. A
    /// schedule the player wrote, Auto off, keeps its row as written.
    pub(crate) fn cars_while_anyone_waits(
        s: Option<&Schedule>,
        active: usize,
        cars: usize,
        waiting: f64,
    ) -> usize {
        if s.is_some_and(|s| s.auto_tune) && waiting > 0.0 {
            active.max(cars)
        } else {
            active
        }
    }

    /// The cars an Auto shaft runs while `waiting` people stand at its
    /// stops, by the rule dispatch follows: every car of the fleet while
    /// anyone waits, else `active`. Kept with the signature it shipped with
    /// in crate 1.50; the car capacity, span and homes are no longer read.
    pub fn cars_for_backlog(
        s: Option<&Schedule>,
        active: usize,
        (waiting, _car_capacity): (f64, f64),
        (positions, ways, _span): (&[f64], &[i64], (i64, i64)),
        _unset_home: impl Fn(usize) -> i64,
    ) -> usize {
        let cars = positions.len().min(ways.len());
        Self::cars_while_anyone_waits(s, active, cars, waiting)
    }

    /// `homeFloorFor`.
    pub fn home_floor_for(s: Option<&Schedule>, car_index: usize, fallback: i64) -> i64 {
        let Some(hf) = s.and_then(|s| s.home_floors.as_ref()) else {
            return fallback;
        };
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
        let Some(hf) = &self.home_floors else {
            return self.clone();
        };
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

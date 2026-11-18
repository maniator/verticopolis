//! Port of `sampleElevatorUtil` (the retired TypeScript `src/engine/sim/congestion.ts`) and the
//! origin-ring fold (`src/engine/scheduleOrigins.ts`): the hourly elevator
//! telemetry the schedule dialog, the stats screen and the facility
//! diagnostics read. Sampling only: no rng. The one gameplay reader is the
//! daily Auto-tune (`schedule_auto.rs`), so a save with a shaft on Auto
//! carries the hourly rings (`telemetry_save.rs`); any other load starts
//! every ring empty.

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::sim::Simulation;

#[path = "telemetry_hourly.rs"]
mod hourly;
pub use hourly::HourlyByDay;

pub const ORIGIN_HOURS: usize = 24;
/// `PRUNE_BELOW`: a floor whose EMA'd boarding count decays below this leaves
/// the slot.
const PRUNE_BELOW: f64 = 0.05;
/// `Number.MAX_SAFE_INTEGER`: the largest id a seed may carry.
const MAX_SAFE_INTEGER: f64 = 9007199254740991.0;

/// `OriginRings`: per day type, per hour of day, origin floor to EMA'd
/// boarding count, in insertion order (the TypeScript `Map` order).
#[derive(Clone, Debug, PartialEq)]
pub struct OriginRings {
    pub weekday: Vec<IndexMap<i64, f64>>,
    pub weekend: Vec<IndexMap<i64, f64>>,
}

impl OriginRings {
    pub fn empty() -> OriginRings {
        OriginRings {
            weekday: vec![IndexMap::new(); ORIGIN_HOURS],
            weekend: vec![IndexMap::new(); ORIGIN_HOURS],
        }
    }
}

/// The per-shaft stores `Simulation` keeps beside the dispatcher.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ElevatorTelemetry {
    pub util: IndexMap<i64, f64>,
    pub hourly: IndexMap<i64, HourlyByDay>,
    pub origins: IndexMap<i64, OriginRings>,
    /// Each elevator's demand at the top of the hour now under way, which the
    /// next sample weighs against its own (#2466).
    pub hour_start: IndexMap<i64, f64>,
}

/// `foldOrigins(rings, isWeekend, hour, counts)`.
pub fn fold_origins(
    rings: &mut OriginRings,
    is_weekend: bool,
    hour: i64,
    counts: Option<&IndexMap<i64, f64>>,
) {
    let h = (((hour % ORIGIN_HOURS as i64) + ORIGIN_HOURS as i64) % ORIGIN_HOURS as i64) as usize;
    let slot = if is_weekend {
        &mut rings.weekend[h]
    } else {
        &mut rings.weekday[h]
    };
    let first_sample = slot.is_empty();
    slot.retain(|floor, prev| {
        let sampled = counts.and_then(|c| c.get(floor)).copied().unwrap_or(0.0);
        let next = 0.3 * sampled + 0.7 * *prev;
        if next < PRUNE_BELOW {
            false
        } else {
            *prev = next;
            true
        }
    });
    if let Some(counts) = counts {
        for (&floor, &n) in counts {
            if n <= 0.0 || slot.contains_key(&floor) {
                continue;
            }
            let seeded = if first_sample { n } else { 0.3 * n };
            if seeded >= PRUNE_BELOW {
                slot.insert(floor, seeded);
            }
        }
    }
}

#[doc(hidden)]
impl Simulation {
    /// `sampleElevatorUtil`: fold the car occupancy and lines at the top of
    /// the hour into each elevator's demand ring and (passenger shafts only)
    /// its utilization average, fold the ended hour's boardings into its
    /// origin rings, and forget shafts that have been removed.
    pub fn sample_elevator_util(&mut self) {
        let mut boardings = self.elevators.drain_boardings();
        // The crowd's riders are outside the dispatch's estimate, so their
        // boardings join the estimate's here (#477): a cinema's evening
        // crowd marks its own floor. Drained in place, so the map keeps its
        // room from hour to hour.
        for ((shaft, floor), n) in self.crowd.elevator_boardings.drain(..) {
            *boardings
                .entry(shaft)
                .or_default()
                .entry(floor)
                .or_insert(0.0) += n;
        }
        let prev_minutes = self.clock.minutes - 60.0;
        let origin_hour = ((prev_minutes / 60.0).floor() as i64).rem_euclid(24);
        let cal = &self.clock.calendar;
        let prev_dow = ((prev_minutes / 1440.0).floor().max(0.0) as i64) % cal.week_days;
        let origin_weekend = prev_dow >= cal.week_days - cal.weekend_days;
        // The riders and lines at H:00 built up in the hour that ended, so
        // they count there, as its boardings do: 7 AM reads the 8:00 crowd.
        let (hour, weekend) = (origin_hour as usize, origin_weekend);
        let tel = &mut self.telemetry;
        let mut alive_util: Vec<i64> = Vec::new();
        let mut alive_hourly: Vec<i64> = Vec::new();
        let floors = self.tower.dispatch_floors();
        for &ti in &floors.elevators {
            let t = &self.tower.transports[ti];
            let cap = t.cars as f64 * t.kind.car_capacity();
            let load = self.elevators.riders_aboard(t, &self.crowd);
            let share = |riders: f64| {
                if cap > 0.0 {
                    (riders / cap).min(1.0)
                } else {
                    0.0
                }
            };
            let frac = share(load);
            // The ring also counts the Modern lines at the shaft's stops: a
            // shaft cut to one car carries no more than one car holds, so
            // the riders it leaves waiting are the demand Auto-tune must see
            // to win its cars back (split-tower 29, 4.12.0). Classic counts
            // no lines, so its ring is the riders aboard as before.
            let line = |floor: i64| self.crowd.shaft_lines.get(&(t.id, floor));
            let stops = self.tower.stops_of(t);
            let waiting: f64 = stops
                .iter()
                .filter_map(|&f| line(f))
                .map(|l| l.riders as f64)
                .sum();
            // The hour that ended reads the larger crowd of its two ends: 7 AM
            // still reads the 8:00 crowd, and a rush that ends on the hour
            // keeps its last busy hour (#2466).
            let now = share(load + waiting);
            let demand = tel
                .hour_start
                .insert(t.id, now)
                .map_or(now, |start| start.max(now));
            alive_hourly.push(t.id);
            let rings = tel.hourly.entry(t.id).or_insert_with(HourlyByDay::empty);
            let sized = |n: usize| n == 24;
            if !(sized(rings.weekday.len())
                && sized(rings.weekend.len())
                && sized(rings.weekday_sampled.len())
                && sized(rings.weekend_sampled.len()))
            {
                *rings = HourlyByDay::empty();
            }
            let (ring, sampled) = if weekend {
                (&mut rings.weekend, &mut rings.weekend_sampled)
            } else {
                (&mut rings.weekday, &mut rings.weekday_sampled)
            };
            // The first sample of an hour seeds it, a measured zero included.
            ring[hour] = if !sampled[hour] {
                demand
            } else {
                0.3 * demand + 0.7 * ring[hour]
            };
            sampled[hour] = true;
            let origins = tel.origins.entry(t.id).or_insert_with(OriginRings::empty);
            fold_origins(origins, origin_weekend, origin_hour, boardings.get(&t.id));
            if t.kind.is_staff_only_transport() {
                continue;
            }
            alive_util.push(t.id);
            let next = match tel.util.get(&t.id) {
                None => frac,
                Some(prev) => 0.15 * frac + 0.85 * prev,
            };
            tel.util.insert(t.id, next);
        }
        tel.util.retain(|id, _| alive_util.contains(id));
        tel.hourly.retain(|id, _| alive_hourly.contains(id));
        tel.origins.retain(|id, _| alive_hourly.contains(id));
        tel.hour_start.retain(|id, _| alive_hourly.contains(id));
    }

    /// The telemetry as JSON for the WASM host's read model:
    /// `{ util: [[id, v]], hourly: [[id, { weekday, weekend, weekdaySampled,
    /// weekendSampled }]], origins: [[id, { weekday: [[[floor, n]]], weekend }]] }`,
    /// each list in the store's insertion order. `weekday` and `weekend` are
    /// 24 loads each; `weekdaySampled` and `weekendSampled` are 24 booleans
    /// each, true for an hour the sampler has measured (a zero load included).
    /// A document handed to `seed_telemetry` may leave the sampled lists out:
    /// its loaded hours then count as sampled.
    pub fn telemetry_json(&self) -> Value {
        let ring = |slots: &Vec<IndexMap<i64, f64>>| -> Value {
            Value::Array(
                slots
                    .iter()
                    .map(|s| Value::Array(s.iter().map(|(f, n)| json!([f, n])).collect()))
                    .collect(),
            )
        };
        let tel = &self.telemetry;
        json!({
            "util": tel.util.iter().map(|(id, v)| json!([id, v])).collect::<Vec<_>>(),
            "hourly": tel
                .hourly
                .iter()
                .map(|(id, r)| {
                    json!([id, {
                        "weekday": r.weekday,
                        "weekend": r.weekend,
                        "weekdaySampled": r.weekday_sampled,
                        "weekendSampled": r.weekend_sampled,
                    }])
                })
                .collect::<Vec<_>>(),
            "origins": tel
                .origins
                .iter()
                .map(|(id, r)| json!([id, { "weekday": ring(&r.weekday), "weekend": ring(&r.weekend) }]))
                .collect::<Vec<_>>(),
        })
    }
}

#[doc(hidden)]
impl Simulation {
    /// Replace the telemetry with the `telemetry_json` shape. Tooling only:
    /// the gallery's engine leg carries a scene's authored curve across the
    /// load that hands the tower to the engine (a save carries the rings only
    /// with a shaft on Auto, `telemetry_save.rs`).
    /// A malformed document leaves the telemetry as it was.
    pub fn seed_telemetry(&mut self, doc: &Value) -> Result<(), String> {
        fn id_of(v: &Value) -> Result<i64, String> {
            v.as_f64()
                .filter(|f| f.fract() == 0.0 && f.abs() <= MAX_SAFE_INTEGER)
                .map(|f| f as i64)
                .ok_or_else(|| format!("telemetry: {v} is not a shaft id"))
        }
        fn num(v: &Value) -> Result<f64, String> {
            v.as_f64()
                .ok_or_else(|| format!("telemetry: {v} is not a number"))
        }
        fn pairs(v: Option<&Value>) -> Result<&Vec<Value>, String> {
            match v {
                None => Ok(const { &Vec::new() }),
                Some(Value::Array(a)) => Ok(a),
                Some(other) => Err(format!("telemetry: {other} is not a list")),
            }
        }
        fn pair(v: &Value) -> Result<(&Value, &Value), String> {
            match v.as_array().map(|a| a.as_slice()) {
                Some([k, x]) => Ok((k, x)),
                _ => Err(format!("telemetry: {v} is not an [id, value] pair")),
            }
        }
        fn ring24(v: Option<&Value>) -> Result<Vec<f64>, String> {
            let a = v
                .and_then(Value::as_array)
                .ok_or("telemetry: a ring is not a list")?;
            if a.len() != 24 {
                return Err("telemetry: a ring does not have 24 slots".into());
            }
            a.iter().map(num).collect()
        }
        fn hours24(v: &Value) -> Result<Vec<bool>, String> {
            let a = v
                .as_array()
                .ok_or("telemetry: a sampled-hours list is not a list")?;
            if a.len() != 24 {
                return Err("telemetry: a sampled-hours list does not have 24 slots".into());
            }
            a.iter()
                .map(|b| {
                    b.as_bool()
                        .ok_or_else(|| format!("telemetry: {b} is not true or false"))
                })
                .collect()
        }
        fn slots(v: Option<&Value>) -> Result<Vec<IndexMap<i64, f64>>, String> {
            let a = v
                .and_then(Value::as_array)
                .ok_or("telemetry: an origin ring is not a list")?;
            if a.len() != ORIGIN_HOURS {
                return Err("telemetry: an origin ring does not have 24 slots".into());
            }
            a.iter()
                .map(|slot| {
                    pairs(Some(slot))?
                        .iter()
                        .map(|p| {
                            let (f, n) = pair(p)?;
                            Ok((id_of(f)?, num(n)?))
                        })
                        .collect()
                })
                .collect()
        }
        if !doc.is_object() {
            return Err("telemetry: the document is not an object".into());
        }
        let mut tel = ElevatorTelemetry::default();
        for p in pairs(doc.get("util"))? {
            let (id, v) = pair(p)?;
            tel.util.insert(id_of(id)?, num(v)?);
        }
        for p in pairs(doc.get("hourly"))? {
            let (id, r) = pair(p)?;
            let mut rings =
                HourlyByDay::measured(ring24(r.get("weekday"))?, ring24(r.get("weekend"))?);
            // A document that names its sampled hours keeps them; one without
            // (a seeded curve) samples the hours with a load.
            if let Some(v) = r.get("weekdaySampled") {
                rings.weekday_sampled = hours24(v)?;
            }
            if let Some(v) = r.get("weekendSampled") {
                rings.weekend_sampled = hours24(v)?;
            }
            tel.hourly.insert(id_of(id)?, rings);
        }
        for p in pairs(doc.get("origins"))? {
            let (id, r) = pair(p)?;
            let rings = OriginRings {
                weekday: slots(r.get("weekday"))?,
                weekend: slots(r.get("weekend"))?,
            };
            tel.origins.insert(id_of(id)?, rings);
        }
        self.telemetry = tel;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;
    use crate::facilities::Kind;
    use crate::tower::UnitState;

    fn counts(pairs: &[(i64, f64)]) -> IndexMap<i64, f64> {
        pairs.iter().copied().collect()
    }

    #[test]
    fn a_first_sample_lands_whole_and_later_ones_blend() {
        let mut r = OriginRings::empty();
        fold_origins(&mut r, false, 8, Some(&counts(&[(1, 10.0), (5, 2.0)])));
        assert_eq!(r.weekday[8], counts(&[(1, 10.0), (5, 2.0)]));
        assert!(r.weekend[8].is_empty());
        // Floor 5 decays, floor 1 blends, floor 9 joins at sample weight.
        fold_origins(&mut r, false, 8, Some(&counts(&[(1, 20.0), (9, 4.0)])));
        assert_eq!(r.weekday[8].get(&1), Some(&(0.3 * 20.0 + 0.7 * 10.0)));
        assert_eq!(r.weekday[8].get(&5), Some(&(0.7 * 2.0)));
        assert_eq!(r.weekday[8].get(&9), Some(&(0.3 * 4.0)));
        assert_eq!(
            r.weekday[8].keys().copied().collect::<Vec<_>>(),
            vec![1, 5, 9]
        );
    }

    #[test]
    fn a_negligible_floor_is_pruned_and_hours_wrap() {
        let mut r = OriginRings::empty();
        fold_origins(&mut r, true, -1, Some(&counts(&[(3, 0.06), (4, 0.0)])));
        assert_eq!(r.weekend[23], counts(&[(3, 0.06)]));
        fold_origins(&mut r, true, 23, None);
        assert!(r.weekend[23].is_empty());
        fold_origins(&mut r, true, 23, Some(&counts(&[(3, 0.01)])));
        assert!(r.weekend[23].is_empty());
    }

    /// A lobby, four office floors and one standard elevator, the offices
    /// let, so the cars carry load and riders board on live calls.
    fn office_tower() -> (Simulation, i64) {
        let mut sim = Simulation::new_game(17, GameMode::Classic);
        sim.money = 1e9;
        for x in 160..220 {
            assert!(sim.build(Kind::Lobby, 1, x).ok);
        }
        for f in 2..=5 {
            for x in 160..220 {
                assert!(sim.build(Kind::Floor, f, x).ok);
            }
        }
        for f in 2..=5 {
            let mut x = 170;
            while x + 9 <= 215 {
                if sim.build(Kind::Office, f, x).ok {
                    x += 9;
                } else {
                    x += 1;
                }
            }
        }
        for u in sim
            .tower
            .units
            .iter_mut()
            .filter(|u| u.kind == Kind::Office)
        {
            u.state = UnitState::Occupied;
            u.ever_occupied = true;
            u.occupants = 6;
        }
        assert!(sim.build_transport(Kind::ElevatorStandard, 164, 1, 5).ok);
        let id = sim.tower.transports[0].id;
        (sim, id)
    }

    #[test]
    fn the_hour_pass_records_each_shaft_and_forgets_a_removed_one() {
        let (mut sim, id) = office_tower();
        sim.tick(48.0 * 60.0);
        let tel = &sim.telemetry;
        let rings = tel.hourly.get(&id).expect("a demand curve");
        assert!(
            rings.weekday.iter().any(|v| *v > 0.0),
            "the weekday ring warmed"
        );
        assert!(tel.util.get(&id).is_some_and(|u| *u > 0.0 && *u <= 1.0));
        let origins = tel.origins.get(&id).expect("origin rings");
        assert!(
            origins.weekday.iter().any(|s| !s.is_empty()),
            "boardings were folded"
        );
        // The JSON round-trips through the seed.
        let doc = sim.telemetry_json();
        let mut other = Simulation::new_game(1, GameMode::Classic);
        other.seed_telemetry(&doc).expect("a well-formed document");
        // The hour's start is the save's (`elevatorLoad`), not the read model's.
        let mut read_model = sim.telemetry.clone();
        assert!(!read_model.hour_start.is_empty());
        read_model.hour_start.clear();
        assert_eq!(other.telemetry, read_model);
        // A removed shaft leaves every store at the next hour pass.
        assert!(sim.tower.remove_transport(id).is_some());
        sim.tick(60.0);
        assert!(sim.telemetry.hourly.is_empty());
        assert!(sim.telemetry.util.is_empty());
        assert!(sim.telemetry.origins.is_empty());
        assert!(sim.telemetry.hour_start.is_empty());
    }

    #[test]
    fn a_malformed_seed_changes_nothing() {
        let (mut sim, _) = office_tower();
        sim.tick(30.0 * 60.0);
        let before = sim.telemetry.clone();
        for bad in [
            json!([]),
            json!(null),
            json!({ "util": [[1e300, 0.2]] }),
            json!({ "util": [[1.5, 0.2]] }),
            json!({ "util": [[1]] }),
            json!({ "util": 3 }),
            json!({ "hourly": [[1, { "weekday": [0.0], "weekend": [] }]] }),
            json!({ "hourly": [[1, { "weekday": vec![0.0; 24], "weekend": vec!["x"; 24] }]] }),
            json!({ "origins": [[1, { "weekday": [], "weekend": [] }]] }),
            json!({ "origins": [[1, { "weekday": vec![json!([[1, "n"]]); 24], "weekend": vec![json!([]); 24] }]] }),
        ] {
            assert!(sim.seed_telemetry(&bad).is_err(), "{bad} was accepted");
            assert_eq!(sim.telemetry, before);
        }
        sim.seed_telemetry(&json!({})).expect("an empty document");
        assert_eq!(sim.telemetry, ElevatorTelemetry::default());
    }
}

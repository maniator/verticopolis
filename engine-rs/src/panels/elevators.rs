//! The elevator readouts: the stats screen's utilization list
//! (`elevatorStats`, `src/engine/sim/congestion.ts`) and the transport
//! inspector and editor's detail (`transportCapacity`, `elevatorUtilization`,
//! `elevatorHourlyLoad`, `elevatorOriginLoad`, `lobbyFloors`, `stopsAt`).
//! Hourly load, origins and utilization are the engine's transient telemetry
//! (`telemetry.rs`), so a freshly loaded tower reads them empty, as on the
//! TypeScript side.

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::sim::Simulation;

fn ring_json(slots: &[IndexMap<i64, f64>]) -> Value {
    Value::Array(
        slots
            .iter()
            .map(|s| Value::Array(s.iter().map(|(f, n)| json!([f, n])).collect()))
            .collect(),
    )
}

impl Simulation {
    /// `elevatorStats()`: each passenger elevator's served range, cars,
    /// capacity per trip and average fullness, busiest first (a stable sort,
    /// so equal readings keep build order).
    pub fn elevator_stats(&self) -> Value {
        let mut rows: Vec<(f64, Value)> = Vec::new();
        for t in &self.tower.transports {
            if !t.kind.is_elevator() || t.kind.is_staff_only_transport() {
                continue;
            }
            let utilization = self.telemetry.util.get(&t.id).copied().unwrap_or(0.0);
            rows.push((
                utilization,
                json!({
                    "id": t.id,
                    "kind": t.kind.as_str(),
                    "bottom": t.bottom,
                    "top": t.top,
                    "cars": t.cars,
                    "capacity": t.cars as f64 * t.kind.car_capacity(),
                    "utilization": utilization,
                }),
            ));
        }
        rows.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Value::Array(rows.into_iter().map(|(_, v)| v).collect())
    }

    /// What the transport inspector and editor read for shaft `id`, or `None`
    /// for an id that is not a shaft. `stops` lists an elevator's floors top
    /// to bottom with whether it stops there, whether the floor carries a
    /// lobby, and whether it is an end of the shaft.
    pub fn transport_detail(&self, id: i64) -> Option<Value> {
        let t = self.tower.get_transport(id)?;
        let tel = &self.telemetry;
        let utilization = if t.kind.is_elevator() {
            tel.util.get(&id).copied()
        } else {
            None
        };
        let hourly = tel
            .hourly
            .get(&id)
            .map(|r| json!({ "weekday": r.weekday, "weekend": r.weekend }));
        let origins = tel
            .origins
            .get(&id)
            .map(|r| json!({ "weekday": ring_json(&r.weekday), "weekend": ring_json(&r.weekend) }));
        let stops: Vec<Value> = if t.kind.is_elevator() {
            let lobbies = self.tower.lobby_floors();
            (t.bottom..=t.top)
                .rev()
                .map(|fl| {
                    json!({
                        "floor": fl,
                        "served": t.stops_at(fl),
                        "lobby": lobbies.contains(&fl),
                        "endpoint": fl == t.bottom || fl == t.top,
                    })
                })
                .collect()
        } else {
            Vec::new()
        };
        Some(json!({
            "id": t.id,
            "kind": t.kind.as_str(),
            "x": t.x,
            "width": t.width,
            "bottom": t.bottom,
            "top": t.top,
            "cars": t.cars,
            "capacity": Simulation::transport_capacity(t.kind, t.cars),
            "utilization": utilization,
            "hourly": hourly,
            "origins": origins,
            "stops": stops,
        }))
    }
}

//! The overlays' heat cells and the traffic HUD's hotspot
//! (`floorHeatmap` and `peakCongestionHotspot`, `src/engine/sim/congestion.ts`).
//! A cell is a column span on a floor with a severity from 0 (good) to 1 (bad)
//! and, for two housekeeping categories, a semantic `tint`. Cells come back in
//! the order the TypeScript emits them.

use indexmap::IndexMap;
use serde_json::{json, Value};
use std::collections::HashSet;

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// `CONGESTION_CHURN`: the ratio where tenants start leaving.
const CONGESTION_CHURN: f64 = 1.0;
/// `CONGESTION_GRIDLOCK`: the ratio that reads fully red.
const CONGESTION_GRIDLOCK: f64 = 1.6;
/// `CONGESTION_AMBER_SEVERITY`: the severity at the churn point.
const CONGESTION_AMBER_SEVERITY: f64 = 2.0 / 3.0;

/// The overlay modes (`HeatmapMode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeatmapMode {
    Congestion,
    Occupancy,
    Satisfaction,
    Cleanliness,
}

impl HeatmapMode {
    pub fn parse(s: &str) -> Option<HeatmapMode> {
        match s {
            "congestion" => Some(HeatmapMode::Congestion),
            "occupancy" => Some(HeatmapMode::Occupancy),
            "satisfaction" => Some(HeatmapMode::Satisfaction),
            "cleanliness" => Some(HeatmapMode::Cleanliness),
            _ => None,
        }
    }
}

/// `congestionSeverity`: the ratio mapped onto the overlay ramp. A ratio that
/// is not finite or not positive reads green.
pub fn congestion_severity(cong: f64) -> f64 {
    if !cong.is_finite() || cong <= 0.0 {
        return 0.0;
    }
    if cong >= CONGESTION_GRIDLOCK {
        return 1.0;
    }
    if cong <= CONGESTION_CHURN {
        return CONGESTION_AMBER_SEVERITY * (cong / CONGESTION_CHURN).powf(0.6);
    }
    CONGESTION_AMBER_SEVERITY
        + (1.0 - CONGESTION_AMBER_SEVERITY)
            * ((cong - CONGESTION_CHURN) / (CONGESTION_GRIDLOCK - CONGESTION_CHURN))
}

fn cell(floor: i64, min_x: i64, max_x: i64, severity: f64, tint: Option<&str>) -> Value {
    match tint {
        Some(t) => {
            json!({ "floor": floor, "minX": min_x, "maxX": max_x, "severity": severity, "tint": t })
        }
        None => json!({ "floor": floor, "minX": min_x, "maxX": max_x, "severity": severity }),
    }
}

impl Simulation {
    /// `peakCongestionHotspot()`: the worst floor's ratio and which floor it
    /// is (`null` when nothing is congested). A tie names the lowest floor,
    /// the one closest to where riders board.
    pub fn peak_congestion_hotspot(&self) -> Value {
        let mut ratio = 0.0;
        let mut floor: Option<i64> = None;
        for (f, c) in self.spatial_congestion_by_floor() {
            if c > ratio {
                ratio = c;
                floor = Some(f);
            } else if c == ratio && floor.is_some_and(|cur| f < cur) {
                floor = Some(f);
            }
        }
        json!({ "ratio": ratio, "floor": floor })
    }

    /// `floorHeatmap(mode)`.
    pub fn floor_heatmap(&self, mode: HeatmapMode) -> Value {
        let cells = match mode {
            HeatmapMode::Cleanliness => self.cleanliness_cells(),
            HeatmapMode::Satisfaction => self.satisfaction_cells(),
            HeatmapMode::Congestion | HeatmapMode::Occupancy => self.floor_cells(mode),
        };
        Value::Array(cells)
    }

    fn cleanliness_cells(&self) -> Vec<Value> {
        let comps = self.tower.staff_components();
        let mut crew_floors: HashSet<i64> = HashSet::new();
        let mut crew_comps: HashSet<i64> = HashSet::new();
        for u in &self.tower.units {
            if u.kind != Kind::Housekeeping || !u.is_operational() {
                continue;
            }
            crew_floors.insert(u.floor);
            if let Some(c) = comps.get(&u.floor) {
                crew_comps.insert(*c);
            }
        }
        let mut out = Vec::new();
        for u in &self.tower.units {
            let max_x = u.x + u.width - 1;
            if u.kind == Kind::Condo && u.is_operational() {
                out.push(cell(u.floor, u.x, max_x, 0.0, Some("na")));
                continue;
            }
            if !u.kind.is_hotel() || !u.is_operational() {
                continue;
            }
            if u.state == UnitState::Infested {
                out.push(cell(u.floor, u.x, max_x, 0.85, Some("infested")));
                continue;
            }
            let reachable = crew_floors.contains(&u.floor)
                || comps.get(&u.floor).is_some_and(|c| crew_comps.contains(c));
            let severity = if !reachable {
                1.0
            } else if u.state == UnitState::Dirty {
                0.6
            } else {
                0.0
            };
            out.push(cell(u.floor, u.x, max_x, severity, None));
        }
        out
    }

    fn satisfaction_cells(&self) -> Vec<Value> {
        self.tower
            .units
            .iter()
            .filter(|u| {
                let rentable = u.kind.facility().population > 0 || u.kind.is_hotel();
                rentable && u.is_present()
            })
            .map(|u| cell(u.floor, u.x, u.x + u.width - 1, 1.0 - u.satisfaction, None))
            .collect()
    }

    /// The congestion and occupancy maps: one cell per floor over its built
    /// extent, in the order the floors first appear in the unit list.
    fn floor_cells(&self, mode: HeatmapMode) -> Vec<Value> {
        let mut ext: IndexMap<i64, (i64, i64)> = IndexMap::new();
        let mut acc: IndexMap<i64, (i64, i64)> = IndexMap::new();
        for u in &self.tower.units {
            let right = u.x + u.width - 1;
            for fl in u.floor..u.floor + u.kind.floors() {
                match ext.get_mut(&fl) {
                    None => {
                        ext.insert(fl, (u.x, right));
                    }
                    Some(e) => {
                        if u.x < e.0 {
                            e.0 = u.x;
                        }
                        if right > e.1 {
                            e.1 = right;
                        }
                    }
                }
            }
            if mode == HeatmapMode::Occupancy
                && (u.kind.facility().population > 0 || u.kind.is_hotel())
            {
                let a = acc.entry(u.floor).or_insert((0, 0));
                a.0 += 1;
                if u.is_present() {
                    a.1 += 1;
                }
            }
        }
        let cong = (mode == HeatmapMode::Congestion).then(|| self.spatial_congestion_by_floor());
        let mut out = Vec::new();
        for (floor, (min_x, max_x)) in &ext {
            let severity = match &cong {
                Some(map) => congestion_severity(map.get(floor).copied().unwrap_or(0.0)),
                None => match acc.get(floor) {
                    Some(&(total, present)) if total > 0 => 1.0 - present as f64 / total as f64,
                    _ => continue,
                },
            };
            out.push(cell(*floor, *min_x, *max_x, severity, None));
        }
        out
    }
}

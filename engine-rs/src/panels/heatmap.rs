//! The overlays' heat cells and the traffic HUD's hotspot
//! (`floorHeatmap` and `peakCongestionHotspot`, `src/engine/sim/congestion.ts`).
//! A cell is a column span on a floor with a severity from 0 (good) to 1 (bad)
//! and, for two housekeeping categories, a semantic `tint`. Cells come back in
//! the order the TypeScript emits them.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::facilities::{Kind, MAX_FLOOR, MIN_FLOOR};
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

/// One heat cell. Fields serialize in the order the TypeScript object has
/// them, and `tint` is left out when there is none.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HeatCell {
    pub floor: i64,
    #[serde(rename = "minX")]
    pub min_x: i64,
    #[serde(rename = "maxX")]
    pub max_x: i64,
    pub severity: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tint: Option<&'static str>,
}

fn cell(floor: i64, min_x: i64, max_x: i64, severity: f64, tint: Option<&'static str>) -> HeatCell {
    HeatCell {
        floor,
        min_x,
        max_x,
        severity,
        tint,
    }
}

/// Floors up to this far past the last legal one still index the dense array;
/// anything beyond spills to a map (a multi-floor room on the top floor).
const FLOOR_SLACK: i64 = 16;

/// A value per floor, remembering the order floors were first seen. Floors in
/// the legal range live in a dense array (no hashing per unit); the rare floor
/// outside it spills to a map.
struct FloorSlots<T: Copy> {
    dense: Vec<Option<T>>,
    spill: HashMap<i64, T>,
    order: Vec<i64>,
}

impl<T: Copy> FloorSlots<T> {
    fn new() -> Self {
        let len = (MAX_FLOOR + FLOOR_SLACK - MIN_FLOOR + 1) as usize;
        FloorSlots {
            dense: vec![None; len],
            spill: HashMap::new(),
            order: Vec::new(),
        }
    }

    fn dense_index(&self, floor: i64) -> Option<usize> {
        let k = floor - MIN_FLOOR;
        (k >= 0 && (k as usize) < self.dense.len()).then_some(k as usize)
    }

    /// The floor's value, created with `init` the first time it is seen.
    fn entry(&mut self, floor: i64, init: T) -> &mut T {
        match self.dense_index(floor) {
            Some(k) => {
                if self.dense[k].is_none() {
                    self.order.push(floor);
                }
                self.dense[k].get_or_insert(init)
            }
            None => {
                if !self.spill.contains_key(&floor) {
                    self.order.push(floor);
                }
                self.spill.entry(floor).or_insert(init)
            }
        }
    }

    fn get(&self, floor: i64) -> Option<T> {
        match self.dense_index(floor) {
            Some(k) => self.dense[k],
            None => self.spill.get(&floor).copied(),
        }
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

    /// `floorHeatmap(mode)`, as typed cells.
    pub fn floor_heatmap(&self, mode: HeatmapMode) -> Vec<HeatCell> {
        match mode {
            HeatmapMode::Cleanliness => self.cleanliness_cells(),
            HeatmapMode::Satisfaction => self.satisfaction_cells(),
            HeatmapMode::Congestion | HeatmapMode::Occupancy => self.floor_cells(mode),
        }
    }

    /// `floorHeatmap(mode)` as JSON text: the cells are written straight out,
    /// without a `Value` per cell (an overlay holds thousands).
    pub fn floor_heatmap_json(&self, mode: HeatmapMode) -> String {
        serde_json::to_string(&self.floor_heatmap(mode)).expect("heat cells serialize")
    }

    fn cleanliness_cells(&self) -> Vec<HeatCell> {
        let reach = self.crew_reach();
        let mut out = Vec::new();
        for u in self.tower.room_units() {
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
            let severity = if !reach.reaches(u.floor) {
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

    fn satisfaction_cells(&self) -> Vec<HeatCell> {
        self.tower
            .room_units()
            .filter(|u| {
                let rentable = u.kind.facility().population > 0 || u.kind.is_hotel();
                rentable && u.is_present()
            })
            .map(|u| cell(u.floor, u.x, u.x + u.width - 1, 1.0 - u.satisfaction, None))
            .collect()
    }

    /// The congestion and occupancy maps: one cell per floor over its built
    /// extent, in the order the floors first appear in the unit list.
    fn floor_cells(&self, mode: HeatmapMode) -> Vec<HeatCell> {
        let mut ext: FloorSlots<(i64, i64)> = FloorSlots::new();
        for u in &self.tower.units {
            let right = u.x + u.width - 1;
            for fl in u.floor..u.floor + u.kind.floors() {
                let e = ext.entry(fl, (u.x, right));
                e.0 = e.0.min(u.x);
                e.1 = e.1.max(right);
            }
        }
        let mut occ: FloorSlots<(i64, i64)> = FloorSlots::new();
        if mode == HeatmapMode::Occupancy {
            for u in self.tower.room_units() {
                if u.kind.facility().population > 0 || u.kind.is_hotel() {
                    let a = occ.entry(u.floor, (0, 0));
                    a.0 += 1;
                    if u.is_present() {
                        a.1 += 1;
                    }
                }
            }
        }
        let cong = (mode == HeatmapMode::Congestion).then(|| self.spatial_congestion_by_floor());
        let mut out = Vec::new();
        for &floor in &ext.order {
            let (min_x, max_x) = ext.get(floor).expect("a seen floor has an extent");
            let severity = match &cong {
                Some(map) => congestion_severity(map.get(&floor).copied().unwrap_or(0.0)),
                None => match occ.get(floor) {
                    Some((total, present)) if total > 0 => 1.0 - present as f64 / total as f64,
                    _ => continue,
                },
            };
            out.push(cell(floor, min_x, max_x, severity, None));
        }
        out
    }
}

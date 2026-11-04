//! The port's render queries (facade slice 7, PR 5b; the contract is
//! `architecture-rust-facade-2026-10-20/engine-port-contract.md`): what the
//! renderer reads beyond the view frame, as numbers and records. The frame
//! reads `congestion` and `queueView`, the scene sync reads `parkingSet`,
//! `parkingUsage` and `recyclingFill`, and the walker placement reads
//! `positionReachable`. The overlay's peak is `hotspot`'s ratio.
use crate::charges::whole;
use crate::services::{recycling_capacity_of, recycling_demand_met_of};

use super::Engine;

/// `queueView`'s header: the landing rows, then the car rows, that follow.
pub(crate) const QUEUE_VIEW: [&str; 2] = ["landings", "cars"];

/// One waiting line of `queueView`, by shaft then floor in the order the
/// crowd first lists them; `tier` is the worst wait tier, 0 to 2.
pub(crate) const QUEUE_LANDING: [&str; 4] = ["shaft", "floor", "count", "tier"];

/// One elevator car of `queueView`, by shaft in tower order then car index.
pub(crate) const QUEUE_CAR: [&str; 3] = ["shaft", "car", "riders"];

/// `parkingSet`'s header: that many working space ids follow, ascending.
pub(crate) const PARKING_SET: [&str; 1] = ["count"];

/// The render records, beside the port's others in the layout.
pub(crate) fn add_render_records(layout: &mut serde_json::Value) {
    let records = &mut layout["records"];
    records["queueView"] = serde_json::json!(QUEUE_VIEW);
    records["queueLanding"] = serde_json::json!(QUEUE_LANDING);
    records["queueCar"] = serde_json::json!(QUEUE_CAR);
    records["parkingSet"] = serde_json::json!(PARKING_SET);
}

/// What `queueView` was last encoded for: the tower, the crowd step and the
/// tower revision, the key the crowd keeps its projection on.
type QueueKey = (u64, i64, i64);

/// What `congestion` was last computed for: the tower, the crowd step, the
/// tower revision, the clock's minutes (the rush factor) and the mark log's
/// position (the rooms' state and census counts).
type CongestionKey = (u64, i64, i64, u64, (u64, u64));

/// The frame's kept answers: the frame asks each once per frame, and both
/// change only with a step or an edit.
#[derive(Default)]
pub(crate) struct RenderMemo {
    queue: Option<(QueueKey, Vec<f64>)>,
    congestion: Option<(CongestionKey, f64)>,
    /// The busiest floor's `[ratio, floor]`, on the same key (#1237).
    hotspot: Option<(CongestionKey, [f64; 2])>,
}

impl Engine {
    /// The mean congestion over populated floors, the lobby left out. The
    /// frame asks once per frame, so the answer is kept until a step, an
    /// edit or a room's change moves its key: a frame between them reads it
    /// without walking the rooms.
    pub(crate) fn port_congestion(&mut self) -> f64 {
        let key = self.congestion_key();
        if let Some((k, c)) = self.render_memo.congestion {
            if k == key {
                return c;
            }
        }
        let c = self.sim.congestion();
        self.render_memo.congestion = Some((key, c));
        c
    }

    /// One floor's raw congestion ratio, 0 for a floor with no reading or a
    /// floor that is not a whole number. It builds the spatial map, one pass
    /// over the rooms, so it is a read for tests and tools (the frame uses
    /// `port_congestion` and `port_hotspot`, which are kept).
    pub(crate) fn port_floor_congestion(&self, floor: f64) -> f64 {
        whole(floor)
            .and_then(|f| self.sim.spatial_congestion_by_floor().get(&f).copied())
            .unwrap_or(0.0)
    }

    /// What the congestion answers read: the tower, the crowd step, the
    /// revision, the clock's minutes and the mark log's position.
    fn congestion_key(&self) -> CongestionKey {
        (
            self.generation,
            self.sim.crowd.step,
            self.sim.tower.revision,
            self.sim.clock.minutes.to_bits(),
            self.sim.tower.view.marks.position(),
        )
    }

    /// `[ratio, floor]` for the busiest served floor, the floor NaN when
    /// none. The HUD asks about six times a second, so the answer is kept
    /// until the congestion key moves, as `port_congestion` is: a read between
    /// steps walks no rooms (#1237).
    pub(crate) fn port_hotspot(&mut self) -> [f64; 2] {
        let key = self.congestion_key();
        if let Some((k, h)) = self.render_memo.hotspot {
            if k == key {
                return h;
            }
        }
        let (ratio, floor) = self.sim.peak_congestion();
        let h = [ratio, floor.map_or(f64::NAN, |f| f as f64)];
        self.render_memo.hotspot = Some((key, h));
        h
    }

    /// The queue projection as one record. The frame asks once per frame, so
    /// the record is kept per tower, crowd step and revision: a frame between
    /// steps copies it out without walking the crowd.
    pub(crate) fn port_queue_view(&mut self) -> Vec<f64> {
        let key = (
            self.generation,
            self.sim.crowd.step,
            self.sim.tower.revision,
        );
        if let Some((k, r)) = &self.render_memo.queue {
            if *k == key {
                return r.clone();
            }
        }
        let q = self.sim.elevator_queue_view();
        let landings: usize = q.landings.values().map(|f| f.len()).sum();
        let cars: usize = q.boarded.iter().map(|(_, c)| c.len()).sum();
        let mut r = Vec::with_capacity(2 + landings * QUEUE_LANDING.len() + cars * QUEUE_CAR.len());
        r.extend_from_slice(&[landings as f64, cars as f64]);
        for (shaft, floors) in &q.landings {
            for (floor, l) in floors {
                r.extend_from_slice(&[*shaft as f64, *floor as f64, l.count as f64, l.tier as f64]);
            }
        }
        for (shaft, riders) in &q.boarded {
            for (i, n) in riders.iter().enumerate() {
                r.extend_from_slice(&[*shaft as f64, i as f64, *n as f64]);
            }
        }
        self.render_memo.queue = Some((key, r.clone()));
        r
    }

    /// The working garage spaces (chained to a ramp) by id, ascending.
    pub(crate) fn port_parking_set(&self) -> Vec<f64> {
        let mut ids: Vec<i64> = self
            .sim
            .tower
            .functional_parking_set()
            .into_iter()
            .collect();
        ids.sort_unstable();
        let mut r = Vec::with_capacity(1 + ids.len());
        r.push(ids.len() as f64);
        r.extend(ids.iter().map(|&id| id as f64));
        r
    }

    /// The garage fill for `spots` working spaces; a negative or non-finite
    /// count reads as none.
    pub(crate) fn port_parking_usage(&self, spots: f64) -> f64 {
        if !spots.is_finite() || spots <= 0.0 {
            return 0.0;
        }
        self.sim.parking_usage(spots)
    }

    /// How full the bins are, 0 to 1. These three reads answer from the
    /// inspector's kept counts (`inspector_recycling`): the recycling card asks
    /// for all three on every hover and phone refresh, and the scene sync
    /// asks for the fill (`towerReconcile.ts`).
    pub(crate) fn port_recycling_fill(&mut self) -> f64 {
        let counts = self.sim.inspector_recycling();
        self.sim
            .recycling_fill_of(counts.population, recycling_capacity_of(counts.centers))
    }

    /// The population the working recycling centers can process.
    pub(crate) fn port_recycling_capacity(&mut self) -> f64 {
        recycling_capacity_of(self.sim.inspector_recycling().centers)
    }

    /// Whether the working recycling centers can process the whole population
    /// (the 4-star demand check).
    pub(crate) fn port_recycling_demand_met(&mut self) -> bool {
        let counts = self.sim.inspector_recycling();
        recycling_demand_met_of(counts.population, recycling_capacity_of(counts.centers))
    }

    /// Whether a walker can stand at `floor`, `x`; a position that is not a
    /// whole tile is not one. `&mut` because reachability memoizes its graph
    /// by tower revision.
    pub(crate) fn port_position_reachable(&mut self, floor: f64, x: f64) -> bool {
        match (whole(floor), whole(x)) {
            (Some(f), Some(x)) => self.sim.position_reachable(f, x),
            _ => false,
        }
    }
}

#[cfg(test)]
#[path = "wasm_port_render_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "wasm_port_recycling_tests.rs"]
mod recycling_tests;

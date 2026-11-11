//! The hour-boundary cost bench: a ~20k-unit tower shaped to price the hourly
//! pass (the noise scan above all), walked through 24 in-game hours, timing
//! the regular ticks and the ticks that cross an hour boundary.
//!
//! This is the Rust engine's copy of the bench the TypeScript engine had
//! (spec-onhour-boundary-cost). It builds
//! the same tower and walks the same day, so the series carries on across the
//! port. Timings are venue-noisy, so they are evidence for a trend, never an
//! assertion. The checks here are structural: the tower built as planned and
//! the walk crossed every hour boundary.

use std::time::Instant;

use verticopolis_engine::clock::GameMode;
use verticopolis_engine::facilities::{Kind, LOT_WIDTH};
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::tower::UnitState;

/// The seed the TypeScript bench founded its tower with.
pub const SEED: u32 = 42;
/// Ticks run before timing starts, to settle the engine's per-revision caches.
pub const WARMUP_TICKS: usize = 30;
/// One in-game minute per tick, for one day.
pub const DAY_TICKS: usize = 24 * 60;
const MID: i64 = LOT_WIDTH / 2;

/// One tick that crossed an hour boundary.
#[derive(Debug, Clone, Copy)]
pub struct Boundary {
    pub hour: i64,
    pub ms: f64,
}

/// What one walk measured.
#[derive(Debug, Clone)]
pub struct Report {
    pub units: usize,
    pub transports: usize,
    pub regular_ticks: usize,
    pub regular_avg_ms: f64,
    pub boundaries: Vec<Boundary>,
}

impl Report {
    /// The median and the slowest boundary tick, in milliseconds.
    pub fn boundary_median_max(&self) -> (f64, f64) {
        let mut ms: Vec<f64> = self.boundaries.iter().map(|b| b.ms).collect();
        ms.sort_by(f64::total_cmp);
        match ms.last() {
            Some(&max) => (ms[ms.len() / 2], max),
            None => (f64::NAN, f64::NAN),
        }
    }

    /// The report lines the weekly workflow copies into its job summary.
    pub fn lines(&self) -> Vec<String> {
        let (median, max) = self.boundary_median_max();
        let per_hour: Vec<String> = self
            .boundaries
            .iter()
            .map(|b| format!("{}:{:.1}", b.hour, b.ms))
            .collect();
        vec![
            format!("bench units={} transports={}", self.units, self.transports),
            format!(
                "regular ticks: n={} avg={:.2}ms",
                self.regular_ticks, self.regular_avg_ms
            ),
            format!("boundary ticks: median={median:.1}ms max={max:.1}ms"),
            format!("per hour: {}", per_hour.join(" ")),
        ]
    }
}

fn lay_tile(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> Result<(), String> {
    sim.tower.place(kind, floor, x);
    match sim.tower.structure_kind_at(floor, x) {
        Some(built) if built == kind => Ok(()),
        other => Err(format!(
            "lay {kind:?} at {floor},{x} did not build (got {other:?})"
        )),
    }
}

/// A full-width story of `kind`, spreading outward from the middle of the lot.
fn lay(sim: &mut Simulation, kind: Kind, floor: i64) -> Result<(), String> {
    for x in (MID..LOT_WIDTH).chain((0..MID).rev()) {
        lay_tile(sim, kind, floor, x)?;
    }
    Ok(())
}

fn place_unit(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) -> Result<(), String> {
    let r = sim.tower.place(kind, floor, x);
    if r.ok && r.unit_id.is_some() {
        Ok(())
    } else {
        Err(format!(
            "place {kind:?} at {floor},{x} failed: {}",
            r.reason.unwrap_or_default()
        ))
    }
}

/// The bench tower: a dense office grid (the noise scan's cost driver, since
/// every sensitive unit walks its band each hour whether or not a source is
/// near), a sparse clean row of fast food sources so the afflicted branch
/// fires, parking basements, and standard shafts in the column gaps. Office
/// stride 14 (a 9-wide room and a 5-tile gap) leaves room for a 4-wide shaft
/// in every fourth gap. Every placement is checked, so a quiet under-build
/// cannot skew the timings.
pub fn big_tower() -> Result<Simulation, String> {
    let mut sim = Simulation::new_game(SEED, GameMode::Classic);
    sim.money = 1e12;
    sim.star = 5;
    lay(&mut sim, Kind::Lobby, 1)?;
    for floor in 2..=45 {
        lay(&mut sim, Kind::Floor, floor)?;
    }
    // Basements connect to the story above, so they go in from B1 down.
    for floor in (-3..=0).rev() {
        lay(&mut sim, Kind::Floor, floor)?;
    }
    let mut shaft_gaps = Vec::new();
    let (mut column, mut x) = (0, 10);
    while x + 9 <= LOT_WIDTH - 10 {
        for floor in 3..=44 {
            place_unit(&mut sim, Kind::Office, floor, x)?;
        }
        for floor in (-3..=0).rev() {
            place_unit(&mut sim, Kind::Parking, floor, x)?;
        }
        if column % 4 == 3 {
            shaft_gaps.push(x - 5); // a clear tile in the gap before this column
        }
        column += 1;
        x += 14;
    }
    let mut x = 12;
    while x + 16 <= LOT_WIDTH - 12 {
        place_unit(&mut sim, Kind::FastFood, 2, x)?;
        x += 56;
    }
    // A standard shaft spans 30 floors at most (canon); serving 1 to 30 is
    // plenty to exercise the served-set read, and the noise scan does not
    // depend on service.
    for x in shaft_gaps {
        let r = sim.build_transport(Kind::ElevatorStandard, x, 1, 30);
        if !r.ok {
            return Err(format!(
                "shaft at {x} (1-30) failed: {}",
                r.reason.unwrap_or_default()
            ));
        }
    }
    for u in sim.tower.units.iter_mut() {
        if u.state == UnitState::Empty
            && u.kind != Kind::Parking
            && !u.kind.is_structural()
            && !u.kind.is_transport()
        {
            u.state = UnitState::Occupied;
            u.occupants = 2;
            u.satisfaction = 0.9;
        }
    }
    Ok(sim)
}

/// Warm up, then walk one day a minute at a time, timing each tick.
pub fn walk(sim: &mut Simulation) -> Result<Report, String> {
    for _ in 0..WARMUP_TICKS {
        sim.tick(1.0);
    }
    let (mut regular_ms, mut regular_ticks) = (0.0, 0usize);
    let mut boundaries = Vec::new();
    for _ in 0..DAY_TICKS {
        let before = sim.on_hour_runs;
        let t0 = Instant::now();
        sim.tick(1.0);
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        if sim.on_hour_runs != before {
            boundaries.push(Boundary {
                hour: sim.clock.hour(),
                ms,
            });
        } else {
            regular_ms += ms;
            regular_ticks += 1;
        }
    }
    // Checked before any division, so an engine regression (the hourly pass
    // never or always running) fails with a message rather than a NaN.
    if boundaries.len() != 24 {
        return Err(format!(
            "the walk crossed {} hour boundaries, expected 24",
            boundaries.len()
        ));
    }
    if regular_ticks == 0 {
        return Err("the walk had no regular ticks".into());
    }
    Ok(Report {
        units: sim.tower.units.len(),
        transports: sim.tower.transports.len(),
        regular_ticks,
        regular_avg_ms: regular_ms / regular_ticks as f64,
        boundaries,
    })
}

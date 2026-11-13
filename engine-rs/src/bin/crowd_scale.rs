//! Benchmark: what a step and a frame cost as the crowd grows, for the plan
//! in `_bmad-output/planning-artifacts/design/design-real-tenant-arrivals-2026-11-13.md`
//! (every tenant a walker). It loads each tower, keeps the crowd topped up
//! to a fixed size with trips between the ground lobby and the tenant
//! floors, and times `Simulation::tick` and `frame::frame_view`. The top-up
//! is outside the timed part. Run it in a release build:
//!
//! ```text
//! cargo run --release --features conformance --bin crowd_scale -- \
//!     [--steps N] [--dt MINUTES] [--sizes 0,140,1000] [tower.vctower ...]
//! ```
//!
//! With no tower named it runs the three towers the design note measured.
//! It prints one Markdown table row per tower and crowd size.

use std::path::{Path, PathBuf};
use std::time::Instant;

use verticopolis_engine::crowd::spawn::{add, spawn_floors};
use verticopolis_engine::crowd::PState;
use verticopolis_engine::frame::frame_view;
use verticopolis_engine::load::{decode_vctower, deserialize};
use verticopolis_engine::sim::Simulation;

/// The ground lobby, where every benchmark trip starts or ends.
const GROUND_LOBBY: i64 = 1;
/// The towers the design note's table measured, relative to the repository.
const DEFAULT_TOWERS: [&str; 3] = [
    "conformance/fixtures/sixseven_2.vctower",
    "conformance/fixtures/split-tower.vctower",
    "src/tests/perfCompare/towers/large.vctower",
];

struct Options {
    steps: usize,
    dt_minutes: f64,
    sizes: Vec<usize>,
    towers: Vec<PathBuf>,
}

fn usage() -> ! {
    eprintln!(
        "usage: crowd_scale [--steps N] [--dt MINUTES] [--sizes 0,140,1000] [tower.vctower ...]"
    );
    std::process::exit(2);
}

fn parse_options() -> Options {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut options = Options {
        steps: 240,
        // One 60 Hz frame at 15 game minutes a second.
        dt_minutes: 0.25,
        sizes: vec![0, 140, 1_000, 5_000, 15_000],
        towers: Vec::new(),
    };
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| usage());
        match arg.as_str() {
            "--steps" => options.steps = value().parse().unwrap_or_else(|_| usage()),
            "--dt" => options.dt_minutes = value().parse().unwrap_or_else(|_| usage()),
            "--sizes" => {
                options.sizes = value()
                    .split(',')
                    .map(|s| s.trim().parse().unwrap_or_else(|_| usage()))
                    .collect()
            }
            flag if flag.starts_with("--") => usage(),
            path => options.towers.push(PathBuf::from(path)),
        }
    }
    if options.steps == 0 || options.dt_minutes <= 0.0 || options.sizes.is_empty() {
        usage();
    }
    if options.towers.is_empty() {
        options.towers = DEFAULT_TOWERS.iter().map(|t| repo.join(t)).collect();
    }
    options
}

fn load(path: &Path) -> Simulation {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let raw = decode_vctower(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    deserialize(&raw).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The floors a tenant trip can end on: leased offices, homes and hotels.
fn tenant_floors(sim: &Simulation) -> Vec<i64> {
    let floors = spawn_floors(&sim.tower, &sim.clock);
    let mut out = floors.leased_offices.clone();
    out.extend(floors.homes.iter().copied());
    out.extend(floors.hotel_floors.iter().copied());
    out
}

/// One row of the table: the means over the run.
struct Row {
    step_mean_ms: f64,
    step_worst_ms: f64,
    moving: usize,
    frame_ms: f64,
    frame_kb: usize,
    route_us: Option<f64>,
}

/// The trips the top-up has started, and the time their routing took.
#[derive(Default)]
struct TopUp {
    next: usize,
    routes: usize,
    seconds: f64,
}

impl TopUp {
    /// Adds trips until the crowd holds `size` people. A route can fail (no
    /// way there), so it gives up after twice the shortfall in tries rather
    /// than spinning.
    fn fill(&mut self, sim: &mut Simulation, size: usize, dests: &[i64]) {
        let mut tries = size.saturating_sub(sim.crowd.people.len()) * 2;
        while sim.crowd.people.len() < size && tries > 0 {
            tries -= 1;
            let floor = dests[self.next % dests.len()];
            self.next += 1;
            let (from, to) = if self.next.is_multiple_of(2) {
                (GROUND_LOBBY, floor)
            } else {
                (floor, GROUND_LOBBY)
            };
            let t = Instant::now();
            add(&mut sim.crowd, &sim.tower, from, to, None, None);
            self.seconds += t.elapsed().as_secs_f64();
            self.routes += 1;
        }
    }
}

fn measure(path: &Path, size: usize, options: &Options, dests: &[i64]) -> Row {
    let mut sim = load(path);
    let mut top_up = TopUp::default();
    let (mut step_total, mut step_worst, mut moving_total) = (0.0f64, 0.0f64, 0usize);
    for _ in 0..options.steps {
        top_up.fill(&mut sim, size, dests);
        moving_total += sim
            .crowd
            .people
            .iter()
            .filter(|p| !matches!(p.state, PState::Dwelling | PState::Done))
            .count();
        let t = Instant::now();
        sim.tick(options.dt_minutes);
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        step_total += ms;
        step_worst = step_worst.max(ms);
    }
    // The frame is built with the crowd at full size, as a host would read
    // it between steps.
    top_up.fill(&mut sim, size, dests);
    let t = Instant::now();
    let frame = frame_view(&sim);
    let frame_ms = t.elapsed().as_secs_f64() * 1000.0;
    Row {
        step_mean_ms: step_total / options.steps as f64,
        step_worst_ms: step_worst,
        moving: moving_total / options.steps,
        frame_ms,
        frame_kb: frame.len() * std::mem::size_of::<f64>() / 1024,
        route_us: (top_up.routes > 0).then(|| top_up.seconds * 1e6 / top_up.routes as f64),
    }
}

fn main() {
    let options = parse_options();
    println!(
        "{} steps of {} game minutes per row; the frame is built once, after the last step, with the crowd topped up.\n",
        options.steps, options.dt_minutes
    );
    println!("| Tower (population) | Crowd size | Moving (mean) | Step mean | Step worst | Frame build | Frame size | Route each |");
    println!("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for path in &options.towers {
        let base = load(path);
        let dests = tenant_floors(&base);
        let name = path.file_stem().map_or_else(
            || path.display().to_string(),
            |s| s.to_string_lossy().into_owned(),
        );
        let label = format!("{name} ({})", base.tower.total_population());
        if dests.is_empty() {
            println!("| {label} | no tenant floors | | | | | | |");
            continue;
        }
        for &size in &options.sizes {
            let row = measure(path, size, &options, &dests);
            let route = row
                .route_us
                .map_or_else(|| "none".to_string(), |us| format!("{us:.1} us"));
            println!(
                "| {label} | {size} | {} | {:.3} ms | {:.3} ms | {:.3} ms | {} KB | {route} |",
                row.moving, row.step_mean_ms, row.step_worst_ms, row.frame_ms, row.frame_kb
            );
        }
    }
}

//! Benchmark: what a step and a frame cost as the crowd grows, for the plan
//! in `_bmad-output/planning-artifacts/design/design-real-tenant-arrivals-2026-11-13.md`
//! (every tenant a walker). It loads each tower, keeps the crowd topped up
//! to a fixed size with trips between the ground lobby and the tenant
//! floors, and times `Simulation::tick`, `frame::frame_view` (every person
//! with their route, as the suites read it) and the view's frame
//! (`view::ViewReader`, the web game's read) with every person and with only
//! the people on one screen at the lobby. The top-up is outside the timed
//! part. Run it in a release build:
//!
//! ```text
//! cargo run --release --features conformance --bin crowd_scale -- \
//!     [--steps N] [--dt MINUTES] [--sizes 0,140,1000] [tower.vctower|tower.TDT ...]
//! ```
//!
//! With no tower named it runs the three towers the design note measured.
//! It prints one Markdown table row per tower and crowd size.

use std::path::{Path, PathBuf};
use std::time::Instant;

use verticopolis_engine::crowd::spawn::{add, spawn_floors};
use verticopolis_engine::crowd::PState;
use verticopolis_engine::frame::frame_view;
use verticopolis_engine::load::{decode_vctower, deserialize, deserialize_tdt};
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::tdt::parse::parse_tdt;
use verticopolis_engine::view::{PeopleWindow, ViewReader};

/// The ground lobby, where every benchmark trip starts or ends.
const GROUND_LOBBY: i64 = 1;
/// One screen at zoom 1 on a 1366 by 768 display: 137 tiles of 10 pixels
/// across, 17 floors of 45 pixels up.
const SCREEN_TILES: f64 = 137.0;
const SCREEN_FLOORS: f64 = 17.0;
/// The towers the design note's table measured, relative to the repository.
/// The crate reads only `engine-rs/` and `conformance/` (`tests/read_boundary.rs`),
/// so a tower elsewhere, such as the web's perf towers, is named on the
/// command line.
const DEFAULT_TOWERS: [&str; 3] = [
    "fixtures/sixseven_2.vctower",
    "fixtures/split-tower.vctower",
    "fixtures/tdt-reddit/TOWER7.TDT",
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
    let suite = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance");
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
        options.towers = DEFAULT_TOWERS.iter().map(|t| suite.join(t)).collect();
    }
    options
}

/// A `.vctower`, or a 1994 `.TDT` through the importer.
fn load(path: &Path) -> Simulation {
    let fail = |e: String| -> ! { panic!("{}: {e}", path.display()) };
    let bytes = std::fs::read(path).unwrap_or_else(|e| fail(e.to_string()));
    let is_tdt = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("tdt"));
    if is_tdt {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned());
        let parsed = parse_tdt(&bytes, name.as_deref().unwrap_or("tower.TDT"))
            .unwrap_or_else(|e| fail(format!("{e:?}")));
        return deserialize_tdt(&parsed.save).unwrap_or_else(|e| fail(e));
    }
    let text = String::from_utf8(bytes).unwrap_or_else(|e| fail(e.to_string()));
    let raw = decode_vctower(&text).unwrap_or_else(|e| fail(e));
    deserialize(&raw).unwrap_or_else(|e| fail(e))
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
    view_ms: f64,
    view_kb: usize,
    screen_ms: f64,
    screen_kb: usize,
    screen_people: usize,
    route_us: Option<f64>,
}

/// The screen a player watches the rush from: the ground floor at its
/// bottom, centered on the tower's shafts (their middles' mean).
fn lobby_screen(sim: &Simulation) -> Option<PeopleWindow> {
    let shafts = &sim.tower.transports;
    let center = if shafts.is_empty() {
        0.0
    } else {
        shafts
            .iter()
            .map(|t| t.x as f64 + t.width as f64 / 2.0)
            .sum::<f64>()
            / shafts.len() as f64
    };
    let bottom = GROUND_LOBBY as f64 - 1.0;
    PeopleWindow::new(
        bottom,
        bottom + SCREEN_FLOORS,
        center - SCREEN_TILES / 2.0,
        center + SCREEN_TILES / 2.0,
    )
}

/// The time one call of `read` takes and the size of what it returns.
fn timed(read: impl FnOnce() -> Vec<f64>) -> (f64, usize, Vec<f64>) {
    let t = Instant::now();
    let v = read();
    let ms = t.elapsed().as_secs_f64() * 1000.0;
    (ms, v.len() * std::mem::size_of::<f64>() / 1024, v)
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
    let (frame_ms, frame_kb, _) = timed(|| frame_view(&sim));
    // Each reader sends every room on its first frame, so the second frame
    // is the one timed: the one a host reads between two steps.
    let mut all = ViewReader::new();
    all.frame(&sim, false);
    let (view_ms, view_kb, _) = timed(|| all.frame(&sim, false));
    let mut screen = ViewReader::new();
    screen.set_people_window(lobby_screen(&sim));
    screen.frame(&sim, false);
    let (screen_ms, screen_kb, v) = timed(|| screen.frame(&sim, false));
    let screen_people = v[verticopolis_engine::view::layout::header::PEOPLE] as usize;
    Row {
        step_mean_ms: step_total / options.steps as f64,
        step_worst_ms: step_worst,
        moving: moving_total / options.steps,
        frame_ms,
        frame_kb,
        view_ms,
        view_kb,
        screen_ms,
        screen_kb,
        screen_people,
        route_us: (top_up.routes > 0).then(|| top_up.seconds * 1e6 / top_up.routes as f64),
    }
}

fn main() {
    let options = parse_options();
    println!(
        "{} steps of {} game minutes per row; the frame is built once, after the last step, with the crowd topped up.\n",
        options.steps, options.dt_minutes
    );
    println!("| Tower (population) | Crowd size | Moving (mean) | Step mean | Step worst | frameView | View frame, all | View frame, one screen (people) | Route each |");
    println!("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for path in &options.towers {
        let base = load(path);
        let dests = tenant_floors(&base);
        let name = path.file_stem().map_or_else(
            || path.display().to_string(),
            |s| s.to_string_lossy().into_owned(),
        );
        let label = format!("{name} ({})", base.tower.total_population());
        if dests.is_empty() {
            println!("| {label} | no tenant floors | | | | | | | |");
            continue;
        }
        for &size in &options.sizes {
            let row = measure(path, size, &options, &dests);
            let route = row
                .route_us
                .map_or_else(|| "none".to_string(), |us| format!("{us:.1} us"));
            println!(
                "| {label} | {size} | {} | {:.3} ms | {:.3} ms | {:.3} ms, {} KB | {:.3} ms, {} KB | {:.3} ms, {} KB ({}) | {route} |",
                row.moving,
                row.step_mean_ms,
                row.step_worst_ms,
                row.frame_ms,
                row.frame_kb,
                row.view_ms,
                row.view_kb,
                row.screen_ms,
                row.screen_kb,
                row.screen_people
            );
        }
    }
}

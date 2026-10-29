//! A host of the Verticopolis engine with no frontend. It depends on the
//! engine the way a project outside this repository would (one path
//! dependency with the `conformance` feature, no Node.js) and drives it
//! through the surface `engine-rs/API.md` documents: start a game, run
//! commands, advance time, read state and events, save, load, and replay a
//! conformance scenario. CI builds and runs it from a checkout that holds no web game
//! (`.github/workflows/engine-rs.yml`, job `consumer`).
//!
//! It checks the integration. The rules belong to the conformance referee
//! (`cargo run --features conformance --bin conformance`).

use std::path::Path;

use serde_json::Value;
use verticopolis_engine::canonical::digest;
use verticopolis_engine::catalog::{catalog, CATALOG_VERSION};
use verticopolis_engine::clock::GameMode;
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::fixed_step::FrameStepper;
use verticopolis_engine::gameplay::{check_catalog, check_event, CATALOG_JSON, GAMEPLAY_RING_CAP};
use verticopolis_engine::load::{
    decode_vctower, deserialize, encode_simulation_vctower, encode_vctower,
    mark_founder_from_loaded_file, stamp_save,
};
use verticopolis_engine::scenario::{run_scenario, Checkpoint, Scenario};
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::snapshot::state_view;

mod edit;
mod reads;

pub use edit::edit;
pub use reads::{read_frame, read_view};

/// The seed every run here starts from. Any seed works; a fixed one makes
/// two runs comparable.
pub const SEED: u32 = 20261013;

/// The build name and save time the host stamps a save with. The engine has
/// no clock and no build identity, so a host always passes both.
pub const APP_VERSION: &str = "consumer-smoke";
pub const SAVED_AT_MS: f64 = 1_791_849_600_000.0;

/// What one smoke run saw, for the binary to print and the tests to check.
#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    /// The money the opening build spent, as the engine charged it.
    pub spent: f64,
    /// What the catalog quoted for the same placements.
    pub quoted: f64,
    /// The game day after the run.
    pub day: i64,
    pub population: i64,
    pub money: f64,
    /// Gameplay events drained over the run, each checked against the
    /// event catalog.
    pub events: usize,
    /// The hash of the hashed state view at the end of the run.
    pub state: String,
    /// The `.vctower` file's size in bytes.
    pub save_bytes: usize,
}

/// One placement of the opening build.
struct Place {
    kind: Kind,
    floor: i64,
    x: i64,
}

/// The opening build: a lobby row, two floors of offices, floor tiles laid
/// over the lobby's west end for the shaft, and a standard elevator from
/// the lobby to the top office floor ([`ELEVATOR_X`]).
fn opening() -> Vec<Place> {
    let mut v: Vec<Place> = (100..=123)
        .map(|x| Place {
            kind: Kind::Lobby,
            floor: 1,
            x,
        })
        .collect();
    for floor in 2..=3 {
        v.extend((100..=105).map(|x| Place {
            kind: Kind::Floor,
            floor,
            x,
        }));
        for x in [106, 115] {
            v.push(Place {
                kind: Kind::Office,
                floor,
                x,
            });
        }
    }
    v
}

/// Where the opening's elevator stands, over the floor tiles at its west
/// end.
const ELEVATOR_X: i64 = 100;

/// Start a Classic game and lay the opening build. Every placement is
/// quoted first (`can_build`, the dry run `build` makes) and must cost what
/// the quote said, so a host can price a placement ghost without applying a
/// rule itself.
pub fn found(seed: u32) -> Result<(Simulation, f64, f64), String> {
    let cat = catalog(GameMode::Classic);
    if cat.version != CATALOG_VERSION {
        return Err(format!(
            "catalog version {} is not {CATALOG_VERSION}",
            cat.version
        ));
    }
    let mut sim = Simulation::new_game(seed, GameMode::Classic);
    if sim.money != cat.economy.starting_money {
        return Err(format!(
            "a new game holds {} but the catalog quotes {}",
            sim.money, cat.economy.starting_money
        ));
    }
    let start = sim.money;
    let mut quoted = 0.0;
    for p in opening() {
        let quote = sim.can_build(p.kind, p.floor, p.x);
        if !quote.ok {
            return Err(format!(
                "{:?} @ {},{} refused: {}",
                p.kind,
                p.floor,
                p.x,
                quote.reason.unwrap_or_default()
            ));
        }
        let before = sim.money;
        let r = sim.build(p.kind, p.floor, p.x);
        if !r.ok {
            return Err(format!(
                "{:?} @ {},{} quoted ok but the build failed: {}",
                p.kind,
                p.floor,
                p.x,
                r.reason.unwrap_or_default()
            ));
        }
        if before - sim.money != quote.cost {
            return Err(format!(
                "{:?} @ {},{} quoted {} and charged {}",
                p.kind,
                p.floor,
                p.x,
                quote.cost,
                before - sim.money
            ));
        }
        quoted += quote.cost;
    }
    // A shaft is quoted the same way (`can_build_transport`), and the quote
    // must follow the catalog: the base price plus the per-floor cost for
    // each floor past the first (`transportFloorCost`).
    let quote = sim.can_build_transport(Kind::ElevatorStandard, ELEVATOR_X, 1, 3);
    if !quote.ok {
        return Err(format!(
            "elevator refused: {}",
            quote.reason.unwrap_or_default()
        ));
    }
    let elevator = cat
        .facilities
        .iter()
        .find(|f| f.key == "elevatorStandard")
        .ok_or("the catalog lists no elevatorStandard")?;
    if quote.cost != elevator.cost + 2.0 * cat.economy.transport_floor_cost {
        return Err(format!(
            "the elevator quoted {} against the catalog's {} plus two floors at {}",
            quote.cost, elevator.cost, cat.economy.transport_floor_cost
        ));
    }
    let before = sim.money;
    let r = sim.build_transport(Kind::ElevatorStandard, ELEVATOR_X, 1, 3);
    if !r.ok {
        return Err(format!(
            "the elevator quoted ok but the build failed: {}",
            r.reason.unwrap_or_default()
        ));
    }
    if before - sim.money != quote.cost {
        return Err(format!(
            "the elevator quoted {} and charged {}",
            quote.cost,
            before - sim.money
        ));
    }
    quoted += quote.cost;
    let spent = start - sim.money;
    Ok((sim, spent, quoted))
}

/// Fail with `what` unless `ok`.
fn check(ok: bool, what: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(what.to_string())
    }
}

/// The event catalog both engines are held to, checked once.
fn event_catalog() -> Result<Value, String> {
    let c: Value = serde_json::from_str(CATALOG_JSON).map_err(|e| e.to_string())?;
    check_catalog(&c)?;
    Ok(c)
}

/// Advance `minutes` of game time in one-minute frames through the engine's
/// frame stepper (`FrameStepper::advance`, the way a Rust host drives time),
/// draining and checking the gameplay events after every frame. Returns the
/// number of events drained.
pub fn advance(sim: &mut Simulation, minutes: u32, events: &Value) -> Result<usize, String> {
    let mut n = 0;
    let mut frames = FrameStepper::default();
    for _ in 0..minutes {
        // One real second at one game minute per second, on the steady clock,
        // owes exactly one game minute.
        frames.advance(sim, 1000.0, 1.0, true, true);
        for e in sim.gameplay.drain() {
            check_event(events, &e.to_json())?;
            n += 1;
        }
    }
    // The buffer holds `GAMEPLAY_RING_CAP` events and counts what a full
    // buffer pushed out. One-minute frames stay far under the cap, but a
    // host that ticks a long `dt` between drains can overflow it, so the
    // count is checked whatever the frame length.
    if sim.gameplay.dropped > 0 {
        return Err(format!(
            "{} gameplay events were dropped from a buffer of {GAMEPLAY_RING_CAP}",
            sim.gameplay.dropped
        ));
    }
    Ok(n)
}

/// Load a `.vctower` file the way the web game does: decode, deserialize,
/// then mark a file with no build stamp as a founder's tower (an unstamped
/// save predates the stamp, so it is a founder's).
pub fn load_file(text: &str) -> Result<Simulation, String> {
    let raw = decode_vctower(text)?;
    let mut sim = deserialize(&raw)?;
    mark_founder_from_loaded_file(&mut sim, &raw);
    Ok(sim)
}

/// Save to a `.vctower` file and load it back. The loaded game must hash
/// the same as the one that wrote it.
pub fn round_trip(sim: &Simulation) -> Result<(Simulation, usize), String> {
    let bytes = encode_simulation_vctower(sim, APP_VERSION, SAVED_AT_MS)?;
    // The same file in two steps, for a host that holds the save JSON.
    let mut save = sim.serialize();
    stamp_save(&mut save, APP_VERSION, SAVED_AT_MS)?;
    if encode_vctower(&save)? != bytes {
        return Err("stamp_save and encode_vctower wrote another file".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
    let raw = decode_vctower(text)?;
    if raw["appVersion"] != APP_VERSION {
        return Err(format!("the save is stamped {}", raw["appVersion"]));
    }
    let loaded = load_file(text)?;
    if loaded.founder {
        return Err("a stamped save loaded as a founder's tower".into());
    }
    let (a, b) = (digest(&state_view(sim)), digest(&state_view(&loaded)));
    if a != b {
        return Err(format!("the loaded game hashes {b}, the saved one {a}"));
    }
    Ok((loaded, bytes.len()))
}

/// The whole smoke run: found, play two days, save, load, and play a third
/// day. A save holds the tower and leaves out the live crowd and the
/// elevator dispatch (`conformance/README.md`, `reload`), so a loaded game
/// restarts them and need not track the game that wrote it; two loads of
/// the same save must track each other exactly.
pub fn smoke(seed: u32) -> Result<Report, String> {
    let events = event_catalog()?;
    let (mut sim, spent, quoted) = found(seed)?;
    if spent != quoted {
        return Err(format!(
            "the opening build cost {spent}, the catalog quoted {quoted}"
        ));
    }
    edit(&mut sim)?;
    let start_day = sim.clock.day();
    let mut drained = advance(&mut sim, 2 * 1440, &events)?;
    if sim.clock.day() != start_day + 2 {
        return Err(format!(
            "two days from day {start_day} reached day {}",
            sim.clock.day()
        ));
    }
    // The state a frontend draws besides money and the tower: the rating,
    // the live crowd and the message log.
    if sim.star < 1 || sim.log.is_empty() {
        return Err(format!(
            "star {} and {} log entries",
            sim.star,
            sim.log.len()
        ));
    }
    read_frame(&sim)?;
    read_view(&sim)?;
    // People come and go; at the hour the run ends the tower may be empty,
    // but two working days must have spawned some.
    let crowd = sim.crowd.view();
    if crowd["nextId"].as_i64().unwrap_or(0) <= 1 || !crowd["people"].is_array() {
        return Err(format!("no one came in two days: {}", crowd["nextId"]));
    }
    let (mut first, save_bytes) = round_trip(&sim)?;
    let (mut second, _) = round_trip(&sim)?;
    drained += advance(&mut first, 1440, &events)?;
    advance(&mut second, 1440, &events)?;
    let (a, b) = (digest(&state_view(&first)), digest(&state_view(&second)));
    if a != b {
        return Err(format!(
            "two loads of one save differ a day later: {a} and {b}"
        ));
    }
    Ok(Report {
        spent,
        quoted,
        day: first.clock.day(),
        population: first.population(),
        money: first.money,
        events: drained,
        state: a,
        save_bytes,
    })
}

/// Replay one scenario of the conformance suite through the engine's own
/// runner and compare every checkpoint with the lock, as the referee does.
/// `conformance` is the suite's directory, and a scenario that starts from
/// a fixture reads it from there, whatever the directory is called.
pub fn replay(conformance: &Path, id: &str) -> Result<usize, String> {
    let read = |p: &Path| {
        std::fs::read_to_string(p).map_err(|e| format!("cannot read {}: {e}", p.display()))
    };
    let lock: Value = serde_json::from_str(&read(&conformance.join("expected.json"))?)
        .map_err(|e| e.to_string())?;
    let want: Vec<Checkpoint> = serde_json::from_value(lock["scenarios"][id].clone())
        .map_err(|e| format!("lock entry {id}: {e}"))?;
    if want.is_empty() {
        return Err(format!("the lock pins no checkpoint for {id}"));
    }
    let scenario = Scenario::parse(&read(
        &conformance.join("scenarios").join(format!("{id}.json")),
    )?)?;
    let run = run_scenario(&scenario, conformance);
    if let Some(e) = run.error {
        return Err(format!("{id}: {e:?}"));
    }
    if run.checkpoints != want {
        let at = run
            .checkpoints
            .iter()
            .zip(&want)
            .position(|(a, b)| a != b)
            .unwrap_or(want.len().min(run.checkpoints.len()));
        return Err(format!("{id}: diverges from the lock at checkpoint {at}"));
    }
    Ok(want.len())
}

/// The ids of every scenario in the suite, sorted, each parsed so a broken
/// file fails here. Some start from a new game and some from a save under
/// `conformance/fixtures/`, named `conformance/fixtures/...` and found inside
/// whatever directory `replay` hands the runner as the suite.
pub fn scenarios(conformance: &Path) -> Result<Vec<String>, String> {
    let dir = conformance.join("scenarios");
    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    let mut ids = Vec::new();
    for e in entries {
        let p = e.map_err(|e| e.to_string())?.path();
        let Some(id) = p.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if p.extension().is_none_or(|x| x != "json") {
            continue;
        }
        let text = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
        Scenario::parse(&text).map_err(|e| format!("{id}: {e}"))?;
        ids.push(id.to_string());
    }
    ids.sort();
    Ok(ids)
}

#[cfg(test)]
mod tests;

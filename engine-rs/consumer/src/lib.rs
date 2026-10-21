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
use verticopolis_engine::charges::ExtendEnd;
use verticopolis_engine::clock::GameMode;
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::fixed_step::FrameStepper;
use verticopolis_engine::frame::{
    frame_view, header, log_since, person, transport, unit, CAR_RECORD, FRAME_HEADER, PERSON_FIXED,
    TRANSPORT_FIXED, UNIT_RECORD, UNKNOWN_ROUTINE,
};
use verticopolis_engine::gameplay::{
    check_catalog, check_event, RemovalMethod, CATALOG_JSON, GAMEPLAY_RING_CAP,
};
use verticopolis_engine::load::{
    decode_vctower, deserialize, encode_simulation_vctower, encode_vctower,
    mark_founder_from_loaded_file, stamp_save,
};
use verticopolis_engine::rent::BatchTarget;
use verticopolis_engine::scenario::{run_scenario, Checkpoint, Scenario};
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::snapshot::state_view;
use verticopolis_engine::{export_tdt, import_tdt};

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

/// The player's edit commands on a founded tower, each checked for the
/// money it moves against the catalog: cars, an elevator extension, rent,
/// sales, the choice and bridging calls, and a `.TDT` round trip.
pub fn edit(sim: &mut Simulation) -> Result<(), String> {
    let cat = catalog(sim.mode);
    let elevator = sim
        .tower
        .transport_at(1, ELEVATOR_X)
        .map(|t| t.id)
        .ok_or("no elevator at the lobby")?;
    let r = sim.add_car(elevator);
    check(
        r.ok && r.delta == -cat.economy.add_car_cost,
        "add_car charges the quoted price",
    )?;
    let r = sim.remove_car(elevator);
    check(
        r.ok && r.delta == cat.economy.car_resale_refund,
        "remove_car refunds the quoted refund",
    )?;
    let r = sim.remove_car(elevator);
    check(!r.ok && r.delta == 0.0, "the last car stays")?;

    for x in ELEVATOR_X..ELEVATOR_X + 6 {
        check(sim.build(Kind::Floor, 4, x).ok, "floor tiles on floor 4")?;
    }
    let r = sim.extend_transport(elevator, ExtendEnd::Up, 4);
    check(
        r.charge.ok && r.top == 4 && r.added == 1,
        "the elevator extends one floor",
    )?;
    check(
        r.charge.delta == -cat.economy.transport_floor_cost,
        "an extension charges the quoted floor cost",
    )?;

    let office = |sim: &Simulation, x| sim.tower.unit_at(2, x).map(|u| u.id);
    let a = office(sim, 106).ok_or("no office at 2,106")?;
    let b = office(sim, 115).ok_or("no office at 2,115")?;
    check(sim.adjust_rent(a, 1).is_some(), "adjust_rent on an office")?;
    check(sim.set_no_rate(b), "set_no_rate on an office")?;
    let price = sim.price_unit(b, 10_000.0);
    check(price.is_some(), "price_unit on an office")?;
    let batch = sim
        .apply_rent_batch(Kind::Office, BatchTarget::Default, false)
        .ok_or("apply_rent_batch on offices")?;
    check(batch.matched == 4, "the batch sees the four offices")?;

    let before = sim.money;
    let sold = sim
        .tower
        .unit_at(3, 115)
        .map(|u| u.id)
        .ok_or("no office at 3,115")?;
    let r = sim.remove_facility(sold, RemovalMethod::Sell);
    check(
        r.ok && r.delta > 0.0 && sim.money == before + r.delta,
        "selling refunds",
    )?;
    let before = sim.money;
    check(
        sim.sell_at(3, 106) && sim.money > before,
        "sell_at sells the office on the tile",
    )?;
    check(
        sim.tower
            .unit_at(3, 106)
            .is_none_or(|u| u.kind.is_structural()),
        "sell_at removed the office it sold",
    )?;

    // `toggle_auto_bridge` returns the setting after the call. Classic
    // always bridges, so it stays on; with no emergency pending, resolving a
    // choice changes nothing. A host may call both at any time.
    check(
        sim.toggle_auto_bridge() && sim.auto_bridge,
        "Classic always bridges",
    )?;
    let money = sim.money;
    sim.resolve_choice(false);
    check(sim.money == money, "resolving no choice changes nothing")?;
    check(
        sim.set_film_policy(a, "auto").is_none(),
        "an office has no film policy",
    )?;

    let tdt = export_tdt(&sim.serialize().to_string())?;
    let (save, _warnings) = import_tdt(&tdt, "SMOKE.TDT")?;
    let save: Value = serde_json::from_str(&save).map_err(|e| e.to_string())?;
    let from_tdt = deserialize(&save)?;
    // The 1994 format stores floors its own way and orders units by floor,
    // so compare the rooms as a set.
    let rooms = |sim: &Simulation| {
        let mut v: Vec<_> = sim
            .tower
            .units
            .iter()
            .filter(|u| !u.kind.is_structural())
            .map(|u| (u.kind.as_str(), u.floor, u.x))
            .collect();
        v.sort();
        v
    };
    check(
        rooms(&from_tdt) == rooms(sim),
        "a .TDT round trip keeps every room where it stood",
    )?;
    Ok(())
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

/// Read the per-frame view the way a renderer would (`frame_view`, see
/// `src/frame.rs` for the layout): the header must agree with the
/// simulation's own fields, and the person, unit and car records must fill
/// the rest exactly. Returns the number of people in the frame.
pub fn read_frame(sim: &Simulation) -> Result<usize, String> {
    let v = frame_view(sim);
    let head = v
        .get(..FRAME_HEADER)
        .ok_or("the frame is shorter than its header")?;
    use header::*;
    let (people, units) = (sim.crowd.people.len(), sim.tower.units.len());
    let expect = [
        (MINUTES, sim.clock.minutes, "minutes"),
        (LOG_SEQ, sim.log_seq as f64, "logSeq"),
        (MONEY, sim.money, "money"),
        (STAR, sim.star as f64, "star"),
        (PEOPLE, people as f64, "people"),
        (UNITS, units as f64, "units"),
        (TRANSPORTS, sim.tower.transports.len() as f64, "transports"),
    ];
    for (slot, want, name) in expect {
        if head[slot] != want {
            let got = head[slot];
            return Err(format!("frame slot {slot} ({name}) is {got}, not {want}"));
        }
    }
    // Walk the records against the simulation they came from: each person's
    // id and route lengths, each unit's id, each shaft's id and car count.
    let short = || "a record runs off the frame".to_string();
    let slice = |at: usize, n: usize| {
        at.checked_add(n)
            .and_then(|end| v.get(at..end))
            .ok_or_else(short)
    };
    let mut at = FRAME_HEADER;
    for p in &sim.crowd.people {
        let fixed = slice(at, PERSON_FIXED)?;
        let want = [p.id as f64, p.floors.len() as f64, p.shafts.len() as f64];
        if fixed[person::ROUTINE] == UNKNOWN_ROUTINE {
            let id = p.id;
            return Err(format!(
                "person {id} has a routine the frame has no code for"
            ));
        }
        let got = [person::ID, person::FLOOR_COUNT, person::SHAFT_COUNT].map(|i| fixed[i]);
        if got != want {
            return Err(format!("person record at {at} reads {got:?}, not {want:?}"));
        }
        at += PERSON_FIXED + p.floors.len() + p.shafts.len();
    }
    for u in &sim.tower.units {
        if slice(at, UNIT_RECORD)?[unit::ID] != u.id as f64 {
            return Err(format!("unit record at {at} is not unit {}", u.id));
        }
        at += UNIT_RECORD;
    }
    for t in &sim.tower.transports {
        let r = slice(at, TRANSPORT_FIXED)?;
        if [r[transport::ID], r[transport::CARS]] != [t.id as f64, t.cars as f64] {
            let (id, cars) = (t.id, t.cars);
            return Err(format!(
                "shaft record at {at} reads {r:?}, not [{id}, {cars}]"
            ));
        }
        at += TRANSPORT_FIXED + CAR_RECORD * t.cars as usize;
    }
    if at != v.len() {
        return Err(format!("the frame records end at {at} of {}", v.len()));
    }
    // The log ring is numbered back from `log_seq`: the newest entry is
    // `log_seq`, asking from below the ring returns every entry, and asking
    // from `log_seq` returns none.
    let entries = |seq: i64| -> Result<Vec<Value>, String> {
        log_since(sim, seq)
            .as_array()
            .cloned()
            .ok_or_else(|| "log_since is not an array".to_string())
    };
    let newest = entries(sim.log_seq - 1)?;
    if !sim.log.is_empty() && (newest.len() != 1 || newest[0]["seq"] != sim.log_seq) {
        return Err(format!("log_since(logSeq - 1) gave {newest:?}"));
    }
    if entries(i64::MIN)?.len() != sim.log.len() || !entries(sim.log_seq)?.is_empty() {
        return Err("log_since does not number the ring back from logSeq".into());
    }
    Ok(people)
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
mod tests {
    use super::*;
    use std::path::PathBuf;
    use verticopolis_engine::scenario::Start;

    /// `VC_CONFORMANCE`, or the suite beside this crate in the repository.
    /// CI sets it when it runs a copy of this crate from outside the
    /// checkout, the way a host in its own repository would.
    fn conformance_dir() -> PathBuf {
        std::env::var_os("VC_CONFORMANCE")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../conformance"))
    }

    #[test]
    fn the_smoke_run_passes() {
        let r = smoke(SEED).expect("smoke run");
        assert_eq!(r.spent, r.quoted);
        assert!(r.spent > 0.0);
        assert!(r.save_bytes > 0);
        assert!(
            r.population > 0,
            "offices with an elevator fill up in two days"
        );
    }

    #[test]
    fn the_same_seed_and_commands_give_the_same_game() {
        let a = smoke(SEED).expect("first run");
        let b = smoke(SEED).expect("second run");
        assert_eq!(a, b);
    }

    #[test]
    fn the_frame_reads_back_with_people_in_the_tower() {
        let events = event_catalog().unwrap();
        let (mut sim, _, _) = found(7).unwrap();
        edit(&mut sim).unwrap();
        // A new game opens at 7:00; eight hours a frame at a time takes it
        // through the working morning, when the offices fill.
        let mut most = 0;
        for _ in 0..480 {
            advance(&mut sim, 1, &events).unwrap();
            most = most.max(read_frame(&sim).unwrap());
        }
        assert!(most > 0, "no one in the tower all morning");
    }

    #[test]
    fn a_refused_placement_charges_nothing() {
        let (mut sim, _, _) = found(SEED).expect("found");
        let before = sim.money;
        let quote = sim.can_build(Kind::Office, 2, 106);
        assert!(!quote.ok, "the tile is taken");
        let r = sim.build(Kind::Office, 2, 106);
        assert!(!r.ok);
        assert_eq!(r.reason, quote.reason);
        assert_eq!(sim.money, before);
    }

    #[test]
    fn an_unstamped_file_loads_as_a_founders_tower() {
        let (sim, _, _) = found(SEED).expect("found");
        let bytes = encode_vctower(&sim.serialize()).expect("encode");
        let text = std::str::from_utf8(&bytes).expect("utf-8");
        assert!(load_file(text).expect("load").founder);
        let (loaded, _) = round_trip(&sim).expect("round trip");
        assert!(!loaded.founder, "a stamped save keeps its status");
    }

    #[test]
    fn a_damaged_file_is_refused_not_panicked_on() {
        assert!(decode_vctower("VCTOWER1\nnot base64 of a deflated save\n").is_err());
        assert!(decode_vctower("").is_err());
        // A file that decodes but holds damaged fields is not refused: the
        // loader coerces them the way the web game's loader does.
        assert!(deserialize(&serde_json::json!({ "units": "no" })).is_ok());
    }

    #[test]
    fn a_modern_game_starts_with_the_host_settings() {
        use verticopolis_engine::clock::CalendarKind;
        let mut sim = Simulation::new_game_with(SEED, GameMode::Modern, CalendarKind::Canon, true);
        assert!(!sim.auto_bridge, "founded unbridged");
        assert!(
            sim.toggle_auto_bridge(),
            "Modern lets the player switch it back on"
        );
        let cat = catalog(GameMode::Modern);
        assert_eq!(sim.money, cat.economy.starting_money);
        assert!(cat.economy.auto_bridge_toggleable);
    }

    #[test]
    fn a_new_game_scenario_matches_the_lock() {
        let n = replay(&conformance_dir(), "starter-classic").expect("starter-classic");
        assert!(n > 1);
    }

    #[test]
    fn every_scenario_is_found_both_kinds_included() {
        let dir = conformance_dir();
        let ids = scenarios(&dir).expect("scenario dir");
        let files = std::fs::read_dir(dir.join("scenarios"))
            .expect("scenario dir")
            .filter(|e| {
                e.as_ref()
                    .is_ok_and(|e| e.path().extension().is_some_and(|x| x == "json"))
            })
            .count();
        assert_eq!(ids.len(), files, "{ids:?}");
        let start = |id: &str| {
            let text = std::fs::read_to_string(dir.join("scenarios").join(format!("{id}.json")))
                .expect("scenario");
            Scenario::parse(&text).expect("parses").start
        };
        assert!(ids
            .iter()
            .any(|id| matches!(start(id), Start::NewGame { .. })));
        assert!(ids
            .iter()
            .any(|id| matches!(start(id), Start::Fixture { .. })));
    }

    #[test]
    fn a_fixture_scenario_matches_the_lock() {
        let n = replay(&conformance_dir(), "star-climb-classic").expect("star-climb-classic");
        assert!(n > 1);
    }

    #[test]
    fn a_lock_entry_without_its_scenario_or_checkpoints_is_an_error() {
        let dir = std::env::temp_dir().join(format!("vc-consumer-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let checkpoint =
            serde_json::json!({ "label": "start", "state": "0", "crowd": "0", "events": "0" });
        let lock = serde_json::json!({ "scenarios": { "gone": [checkpoint], "empty": [] } });
        std::fs::write(dir.join("expected.json"), lock.to_string()).expect("lock");
        let gone = replay(&dir, "gone");
        let empty = replay(&dir, "empty");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            gone.unwrap_err().contains("cannot read"),
            "the scenario file is read"
        );
        assert!(empty.unwrap_err().contains("no checkpoint"));
    }
}

//! `save_text` writes the bytes `serialize().to_string()` writes (#1242), on
//! the games the engine plays, every loader case, every committed tower, and
//! games edited to carry the values a writer can get wrong.
use super::*;
use crate::clock::{CalendarKind, GameMode};
use crate::facilities::Kind;
use crate::ledger::{DayTotals, LEDGER_CATS, WINDOW};
use crate::load::{decode_vctower, deserialize};
use crate::load_stream::read_save;
use crate::sim::LogKind;
use std::collections::HashSet;

fn same(sim: &Simulation, what: &str) {
    let text = reference(sim).to_string();
    assert_eq!(sim.save_text(), text, "{what}: the text");
    assert_eq!(sim.serialize().to_string(), text, "{what}: the tree");
}

/// `serialize()` as it was before #1242, kept verbatim (but for `self`) as
/// the reference both writers must match.
fn reference(sim: &Simulation) -> Value {
    let mut m = Map::new();
    m.insert("version".into(), json!(SAVE_VERSION));
    m.insert("seed".into(), json!(sim.rng.seed()));
    m.insert("initialSeed".into(), json!(sim.rng.initial_seed));
    m.insert("money".into(), json!(sim.money));
    m.insert("star".into(), json!(sim.star));
    m.insert("minutes".into(), json!(sim.clock.minutes));
    m.insert("mode".into(), json!(sim.mode.as_str()));
    m.insert("modernCalendar".into(), json!(sim.modern_calendar.as_str()));
    if !sim.auto_bridge {
        m.insert("autoBridge".into(), json!(false));
    }
    if sim.founder {
        m.insert("founder".into(), json!(true));
    }
    m.insert("lastQuarterMoney".into(), json!(sim.last_quarter_money));
    m.insert(
        "units".into(),
        Value::Array(sim.tower.units.iter().map(|u| u.serialize()).collect()),
    );
    m.insert(
        "transports".into(),
        Value::Array(sim.tower.transports.iter().map(|t| t.serialize()).collect()),
    );
    m.insert("nextId".into(), json!(sim.tower.next_id));
    if let Some(n) = &sim.tower.tower_name {
        m.insert("towerName".into(), json!(n));
    }
    if let Some(b) = sim.tower.built_wedding_hall {
        m.insert("builtWeddingHall".into(), json!(b));
    }
    if let Some(b) = sim.evaluated_tower {
        m.insert("evaluatedTower".into(), json!(b));
    }
    m.insert("vipVisitDay".into(), json!(sim.vip_visit_day));
    m.insert("vipFavorable".into(), json!(sim.vip_favorable));
    m.insert("vipVisits".into(), json!(sim.vip_visits));
    m.insert("lastVipNagDay".into(), json!(sim.last_vip_nag_day));
    m.insert("treasuresFound".into(), json!(sim.treasures_found));
    if let Some(d) = sim.extermination_due_day {
        m.insert("exterminationDueDay".into(), json!(d));
        if let Some(ids) = &sim.extermination_room_ids {
            m.insert("exterminationRoomIds".into(), json!(ids));
        }
    }
    m.insert("events".into(), sim.events.save_state());
    m.insert("excavated".into(), json!(sim.excavated));
    m.insert("blockbusters".into(), json!(sim.blockbusters));
    m.insert("milestones".into(), json!(sim.milestones));
    m.insert("ledger".into(), sim.ledger.serialize());
    if let Some(v) = &sim.view {
        m.insert("view".into(), v.clone());
    }
    if !sim.log.is_empty() {
        let start = sim.log.len().saturating_sub(LOG_SAVE_CAP);
        let log: Vec<Value> = sim.log[start..]
            .iter()
            .map(|e| json!({ "minute": e.minute, "text": e.text, "kind": e.kind.as_str() }))
            .collect();
        m.insert("log".into(), Value::Array(log));
    }
    Value::Object(m)
}

/// A small tower with rooms, an elevator, stairs and an hour of play.
fn played(mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game_with(7, mode, CalendarKind::RealWorld, false);
    sim.money = 1e9;
    for x in 100..160 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        for f in 2..=6 {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    assert!(
        sim.tower
            .place_transport(Kind::ElevatorStandard, 100, 1, 6)
            .ok
    );
    assert!(sim.tower.place_transport(Kind::Stairs, 150, 1, 2).ok);
    for (kind, floor, x) in [
        (Kind::Office, 2, 110),
        (Kind::Office, 3, 110),
        (Kind::Condo, 4, 110),
        (Kind::FastFood, 2, 130),
    ] {
        assert!(sim.tower.place(kind, floor, x).ok, "{kind:?}");
    }
    for _ in 0..30 {
        sim.tick(2.0);
    }
    sim
}

/// A new game, a played one, and the played one after a load, in both
/// modes: every optional field the engine writes on the way is covered by
/// one of them or by the edits below.
#[test]
fn engine_games_write_the_trees_text() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        same(
            &Simulation::new(1, mode, CalendarKind::RealWorld, true),
            "a new game",
        );
        let sim = played(mode);
        same(&sim, "a played game");
        let loaded = deserialize(&sim.serialize()).unwrap();
        same(&loaded, "the game loaded back");
        let (streamed, took) = read_save(sim.save_text().as_bytes()).unwrap();
        assert!(took, "the streamed reader declined the played game");
        same(
            &streamed,
            "the game loaded back through the streamed reader",
        );
    }
}

/// Values a JSON writer can spell differently (numbers that are not finite
/// or are whole as floats, negative zero, escapes, characters outside the
/// basic plane), a view, every optional field, events whose Santa year and
/// random state no new game carries and whose pending choice's message
/// carries escapes, a ledger past its window, excavated tiles, room ids
/// (negative ones and an empty list included), blockbuster cinemas and
/// milestones past the known ones (the loader keeps any it reads), and a log
/// past the save's cap. The tree holds each as a `Value`; the streamed writer
/// writes each list element from its own `Value`, or the strings and numbers
/// straight from the game, and the ledger's and the events' objects itself.
/// This pins the two to the same text.
#[test]
fn edited_games_write_the_trees_text() {
    let mut sim = played(GameMode::Classic);
    sim.money = f64::NAN;
    sim.last_quarter_money = f64::INFINITY;
    sim.auto_bridge = false;
    sim.founder = true;
    sim.tower.tower_name = Some("Tower \"One\" \\ \u{1}\n\u{2028} \u{1F3E2} é".into());
    sim.tower.built_wedding_hall = Some(true);
    sim.evaluated_tower = Some(false);
    sim.extermination_due_day = Some(-0.0);
    sim.extermination_room_ids = Some(vec![3, -7, 5, 2_147_483_647]);
    sim.events.last_santa_year = 1e21;
    sim.events.extra.restore(4_000_000_000);
    sim.events.pending = Some(PendingChoice {
        kind: "bombThreat",
        cost: 0.1 + 0.2,
        message: "Pay \"$300,000\" \\ \u{1F3E2}\n\u{2028}".repeat(3),
    });
    sim.view = Some(json!({ "x": 1.5, "y": -2, "zoom": 1e300, "tags": ["a", null] }));
    let u = sim
        .tower
        .units
        .iter_mut()
        .find(|u| u.kind == Kind::Office)
        .expect("played() places an office");
    u.satisfaction = f64::NEG_INFINITY;
    u.pending_income = 1e21;
    u.label = "Desk \u{0} \u{7f} \u{FFFD}".into();
    u.rent = Some(0.1 + 0.2);
    // The log's ring keeps no more lines than the save does, so the lines
    // past the save's cap go in directly.
    for i in 0..LOG_SAVE_CAP + 5 {
        sim.log.push(LogEntry {
            minute: i as f64,
            text: format!("line {i} \"quoted\" \t"),
            kind: LogKind::Info,
        });
    }
    assert!(sim.log.len() > LOG_SAVE_CAP);
    let day = |d: usize| -> DayTotals {
        let cats = LEDGER_CATS.iter().enumerate();
        cats.map(|(i, c)| (*c, (d * LEDGER_CATS.len() + i) as f64 * 0.1))
            .collect()
    };
    // Past the window the ledger keeps, so a writer that trimmed would show.
    sim.ledger.history = (0..WINDOW + 2).map(day).collect();
    sim.ledger.today = day(WINDOW);
    sim.ledger.today.insert("food", -0.0);
    sim.ledger.history[0].insert("offices", 1e21);
    sim.ledger.history[1].insert("condos", f64::NAN);
    sim.excavated = vec!["-1:3".into(), "-2:\"4\" \u{1F3E2}".into()];
    sim.blockbusters = vec![
        3.0,
        2.5,
        -0.0,
        1e21,
        5e-324,
        0.1 + 0.2,
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
    ];
    sim.milestones = (0..20)
        .map(|i| format!("goal {i} \"\u{1F3E2}\" \\"))
        .collect();
    let keys: Vec<&str> = sim.save_fields().iter().map(|(k, _)| *k).collect();
    let distinct: HashSet<&str> = keys.iter().copied().collect();
    assert_eq!(
        (keys.len(), distinct.len()),
        (31, 31),
        "every field once: {keys:?}"
    );
    same(&sim, "an edited game");
    sim.extermination_room_ids = None;
    same(&sim, "a due day without room ids");
    sim.extermination_due_day = None;
    sim.extermination_room_ids = Some(vec![3, 5]);
    same(&sim, "room ids without a due day");
    sim.view = None;
    sim.events.pending = None;
    sim.extermination_due_day = Some(0.0);
    sim.extermination_room_ids = Some(Vec::new());
    sim.log.clear();
    sim.tower.units.clear();
    sim.tower.transports.clear();
    sim.excavated.clear();
    sim.blockbusters.clear();
    sim.milestones.clear();
    sim.ledger.today.clear();
    sim.ledger.history.clear();
    same(&sim, "a game with empty lists and no view, choice or log");
}

/// Every loader case that loads writes the same text both ways.
#[test]
fn loader_cases_write_the_trees_text() {
    let table: Value =
        serde_json::from_str(include_str!("../../conformance/loader-cases.json")).unwrap();
    let mut loaded = 0;
    for case in table["cases"].as_array().unwrap() {
        if let Ok(sim) = deserialize(&case["input"]) {
            same(&sim, case["id"].as_str().unwrap_or("a loader case"));
            loaded += 1;
        }
    }
    assert!(loaded >= 50, "only {loaded} loader cases loaded");
}

/// Every committed player tower writes the same text both ways.
#[test]
fn fixture_towers_write_the_trees_text() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "vctower"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty());
    for p in paths {
        let save = decode_vctower(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let sim = deserialize(&save).unwrap();
        same(&sim, &p.display().to_string());
    }
}

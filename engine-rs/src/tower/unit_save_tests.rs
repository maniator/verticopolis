//! The unit's save entry walk (`unit_save`) against `Unit::serialize` as it
//! was when each entry was built as a `Value`, kept verbatim below (but for
//! `self`): the tree, the written text and the floor-run check read the same
//! entry, for every unit of every committed tower as loaded and twelve
//! hours on, and for units carrying every optional key, with values a JSON
//! writer can spell differently.

use serde_json::{json, Map, Value};

use super::*;
use crate::clock::GameMode;
use crate::economy::films::FilmTier;
use crate::economy::screens::ScreenFilm;
use crate::facilities::{Kind, FACILITIES};
use crate::load::{decode_vctower, deserialize};
use crate::save_entry::Written;
use crate::sim::Simulation;

/// `Unit::serialize` before the walk, verbatim but for `self`.
fn reference(u: &Unit) -> Value {
    let f = u.kind.facility();
    let mut m = Map::new();
    m.insert("id".into(), json!(u.id));
    m.insert("kind".into(), json!(u.kind.as_str()));
    m.insert("floor".into(), json!(u.floor));
    m.insert("x".into(), json!(u.x));
    if !(u.width == 1 && f.width == 1 && u.kind.is_structural()) {
        m.insert("width".into(), json!(u.width));
    }
    if u.state != UnitState::Empty {
        m.insert("state".into(), json!(u.state.as_str()));
    }
    if u.satisfaction != 1.0 {
        m.insert("satisfaction".into(), json!(u.satisfaction));
    }
    if u.occupants != 0 && !u.kind.counts_visitors() {
        m.insert("occupants".into(), json!(u.occupants));
    }
    if u.ever_occupied {
        m.insert("everOccupied".into(), json!(true));
    }
    if u.pending_income != 0.0 {
        m.insert("pendingIncome".into(), json!(u.pending_income));
    }
    if u.label != f.name {
        m.insert("label".into(), json!(u.label));
    }
    if let Some(r) = u.residents {
        m.insert("residents".into(), json!(r));
    }
    if let Some(v) = u.visitors_yest {
        m.insert("visitorsYest".into(), json!(v));
    }
    if let Some(r) = u.rent {
        m.insert("rent".into(), json!(r));
    }
    if u.no_rate {
        m.insert("noRate".into(), json!(true));
    }
    let extras = u.extras();
    if let Some(v) = extras.vacate_reason {
        m.insert("vacateReason".into(), json!(v));
    }
    if let Some(v) = extras.vacate_at {
        m.insert("vacateAt".into(), json!(v));
    }
    if let Some(v) = extras.film_policy {
        m.insert("filmPolicy".into(), json!(v));
    }
    if let Some(v) = extras.film_days {
        m.insert("filmDays".into(), json!(v));
    }
    if extras.film_classic {
        m.insert("filmClassic".into(), json!(true));
    }
    if extras.film_blockbuster {
        m.insert("filmBlockbuster".into(), json!(true));
    }
    if let Some(v) = extras.ticket_price {
        m.insert("ticketPrice".into(), json!(v));
    }
    if let Some(screen) = extras.second_screen {
        m.insert("screen2".into(), screen.to_json());
    }
    if let Some(v) = u.subtype {
        m.insert("subtype".into(), json!(v));
    }
    if u.kind.subtype_list().is_some() {
        if let Some(v) = extras.patronage_today {
            m.insert("patronageToday".into(), json!(v));
        }
        if let Some(v) = extras.patronage_yest {
            m.insert("patronageYest".into(), json!(v));
        }
        if let Some(v) = extras.profit_today {
            m.insert("profitToday".into(), json!(v));
        }
        if let Some(v) = extras.profit_yest {
            m.insert("profitYest".into(), json!(v));
        }
    }
    if let Some(v) = extras.complete_at {
        m.insert("completeAt".into(), json!(v));
    } else if let Some(raw) = &extras.complete_at_raw {
        m.insert("completeAt".into(), raw.clone());
    }

    if let Some(d) = extras.dirty_days {
        if d != 0 && u.state == UnitState::Dirty {
            m.insert("dirtyDays".into(), json!(d));
        }
    }
    Value::Object(m)
}

/// The three readings of the walk agree with the reference on `u`.
fn same(u: &Unit, what: &str) {
    let want = reference(u);
    assert_eq!(u.serialize(), want, "{what}: the tree");
    assert_eq!(
        serde_json::to_string(&Written(u)).unwrap(),
        want.to_string(),
        "{what}: the text"
    );
    assert_eq!(u.save_text(), want.to_string(), "{what}: save_text");
    let saved = SavedUnit { unit: u, run: None };
    assert_eq!(
        serde_json::to_string(&saved).unwrap(),
        want.to_string(),
        "{what}: a lone entry"
    );
    assert_eq!(saved.to_value(), want, "{what}: a lone entry's tree");
    let runs = SavedUnit {
        unit: u,
        run: Some(7),
    };
    let mut with_run = want.as_object().unwrap().clone();
    with_run.insert("run".into(), json!(7));
    assert_eq!(
        serde_json::to_string(&runs).unwrap(),
        Value::Object(with_run.clone()).to_string(),
        "{what}: a run"
    );
    assert_eq!(
        runs.to_value(),
        Value::Object(with_run),
        "{what}: a run's tree"
    );
    assert_eq!(
        u.saves_only_position(),
        want.as_object().unwrap().len() == 4,
        "{what}: only its position"
    );
}

fn fixtures() -> Vec<(String, Simulation)> {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures");
    let mut paths: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|x| x == "vctower"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty());
    paths
        .into_iter()
        .map(|p| {
            let save = decode_vctower(&std::fs::read_to_string(&p).unwrap()).unwrap();
            (p.display().to_string(), deserialize(&save).unwrap())
        })
        .collect()
}

#[test]
fn every_committed_towers_units_write_as_before() {
    for (name, mut sim) in fixtures() {
        for u in &sim.tower.units {
            same(u, &name);
        }
        for _ in 0..12 * 60 {
            sim.tick(1.0);
        }
        for u in &sim.tower.units {
            same(u, &format!("{name} twelve hours on"));
        }
    }
}

#[test]
fn units_with_every_key_write_as_before() {
    let odd = [f64::NAN, f64::INFINITY, -0.0, 0.1 + 0.2, 1e21, 5e-324, 2.0];
    let mut sim = Simulation::new_game(1, GameMode::Modern);
    assert!(sim.tower.place(Kind::Lobby, 1, 100).ok);
    let base = sim.tower.units[0].clone();
    for (i, f) in FACILITIES.iter().enumerate() {
        let n = odd[i % odd.len()];
        let mut u = base.clone();
        u.kind = f.kind;
        u.width = f.width + 1;
        u.state = crate::tower::UnitState::Dirty;
        u.satisfaction = n;
        u.occupants = 3;
        u.ever_occupied = true;
        u.pending_income = n;
        u.label = "Desk \"One\" \\ \u{0} \u{2028} \u{1F3E2}".into();
        u.residents = Some(2);
        u.visitors_yest = Some(120);
        u.rent = Some(n);
        u.no_rate = true;
        u.subtype = Some("French");
        {
            let mut x = u.extras_mut();
            x.vacate_reason = Some("rent");
            x.vacate_at = Some(n);
            x.film_policy = Some("auto");
            x.film_days = Some(4);
            x.film_classic = true;
            x.film_blockbuster = true;
            x.ticket_price = Some("high");
            x.second_screen = Some(ScreenFilm {
                tier: FilmTier::Blockbuster,
                days: Some(2),
                policy: Some("keep"),
            });
            x.patronage_today = Some(n);
            x.patronage_yest = Some(1.5);
            x.profit_today = Some(-0.0);
            x.profit_yest = Some(f64::NEG_INFINITY);
            x.complete_at = Some(n);
            x.dirty_days = Some(3);
        }
        same(&u, f.kind.as_str());
        // A `completeAt` kept as the save had it, and the keys each rule
        // leaves out.
        u.extras_mut().complete_at = None;
        u.extras_mut().complete_at_raw = Some(json!({ "at": [1, "two", null] }));
        u.width = f.width;
        u.state = crate::tower::UnitState::Empty;
        u.satisfaction = 1.0;
        u.label = f.name.to_string();
        same(&u, &format!("{} with a raw completeAt", f.kind.as_str()));
        let mut plain = base.clone();
        plain.kind = f.kind;
        plain.width = 1;
        plain.label = f.name.to_string();
        same(&plain, &format!("a plain {}", f.kind.as_str()));
    }
    assert!(FACILITIES.iter().any(|f| f.kind == Kind::Floor));
}

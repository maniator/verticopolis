//! The frame mark log: the setters log what they change, a reader visits
//! only what was logged, and no engine write gets past the setters.
use super::layout::{header, unit, HEADER, PERSON_RECORD, UNIT_RECORD};
use super::marks::MARK_CAP;
use super::ViewReader;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A small tower half a day into play, with tenants and people.
fn served() -> Simulation {
    super::session_tests::at("events-classic", "fire")
}

/// The room records of a frame, as (slot, fields).
fn rooms(frame: &[f64]) -> Vec<(usize, Vec<f64>)> {
    let at = HEADER + frame[header::PEOPLE] as usize * PERSON_RECORD;
    (0..frame[header::UNITS] as usize)
        .map(|k| {
            let r = &frame[at + k * UNIT_RECORD..at + (k + 1) * UNIT_RECORD];
            (r[unit::SLOT] as usize, r[unit::STATE..].to_vec())
        })
        .collect()
}

#[test]
fn a_setter_logs_only_a_change() {
    let sim = served();
    let tower = &sim.tower;
    let start = tower.view.marks.end();
    let i = tower.room_index()[0];
    let mut u = tower.units[i].clone();
    let at = tower.view.marks.at(i);
    u.set_occupants(at, u.occupants);
    u.set_state(at, u.state);
    assert_eq!(
        tower.view.marks.end(),
        start,
        "an unchanged value logs nothing"
    );
    u.set_occupants(at, u.occupants + 1);
    u.set_customers_in(at, Some(9));
    assert_eq!(
        tower.view.marks.end(),
        start + 2,
        "each change logs the unit"
    );
}

/// A unit changed again after a reader read its first change is sent again:
/// the log keeps the repeat, since that reader has passed the first entry.
#[test]
fn a_change_after_a_read_is_sent() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let i = sim.tower.room_index()[1];
    for n in 1..=3 {
        let u = &mut sim.tower.units[i];
        let occupants = u.occupants + n;
        u.set_occupants(sim.tower.view.marks.at(i), occupants);
        let sent = rooms(&reader.frame(&sim, false));
        assert_eq!(sent.len(), 1, "change {n}: {sent:?}");
        assert_eq!(sent[0].1[unit::OCCUPANTS - unit::STATE], occupants as f64);
    }
}

#[test]
fn a_quiet_frame_visits_no_room() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let still = reader.frame(&sim, false);
    assert_eq!(still[header::UNITS], 0.0);
    assert_eq!(still[header::POPULATION], sim.population() as f64);
    // A change the setters made is sent, and the population follows it.
    let i = sim.tower.room_index()[2];
    let slot = 2;
    let u = &mut sim.tower.units[i];
    let state = if u.state == UnitState::Dirty {
        UnitState::Empty
    } else {
        UnitState::Dirty
    };
    u.set_state(sim.tower.view.marks.at(i), state);
    let moved = reader.frame(&sim, false);
    let sent = rooms(&moved);
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(sent[0].0, slot);
    assert_eq!(moved[header::POPULATION], sim.population() as f64);
    assert_eq!(moved[header::FULL], 0.0);
}

#[test]
fn a_reader_left_behind_compares_every_room_once() {
    let mut sim = served();
    let mut reader = ViewReader::new();
    reader.frame(&sim, false);
    let rooms_index = sim.tower.room_index();
    let (a, b) = (rooms_index[0], rooms_index[1]);
    let first = sim.tower.units[a].occupants;
    // Alternate two units past the log's cap, so it drops marks the reader
    // never read; the last write leaves unit `a` changed and `b` as it was.
    for n in 0..MARK_CAP + 2 {
        let i = if n % 2 == 0 { a } else { b };
        let u = &mut sim.tower.units[i];
        let n = u.occupants + 1;
        u.set_occupants(sim.tower.view.marks.at(i), n);
    }
    let b_now = sim.tower.units[b].occupants;
    sim.tower.units[b].set_occupants(
        sim.tower.view.marks.at(b),
        b_now - (MARK_CAP as i64 + 2) / 2,
    );
    let frame = reader.frame(&sim, false);
    assert_eq!(frame[header::FULL], 0.0, "a compare, not a full frame");
    let sent = rooms(&frame);
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(
        sent[0].1[unit::OCCUPANTS - unit::STATE],
        (first + (MARK_CAP as i64 + 2) / 2) as f64
    );
    assert_eq!(frame[header::POPULATION], sim.population() as f64);
}

#[test]
fn readers_keep_their_own_place_in_the_log() {
    let mut sim = served();
    let mut early = ViewReader::new();
    let mut late = ViewReader::new();
    early.frame(&sim, false);
    late.frame(&sim, false);
    for _ in 0..5 {
        sim.tick(2.0);
        let a = early.frame(&sim, false);
        assert_eq!(a[header::POPULATION], sim.population() as f64);
    }
    // `late` has read nothing since; it still gets every room that changed.
    let b = late.frame(&sim, false);
    let fresh = ViewReader::new().frame(&sim, true);
    let fresh_rooms = rooms(&fresh);
    for (slot, fields) in rooms(&b) {
        assert_eq!(fields, fresh_rooms[slot].1, "slot {slot}");
    }
    assert_eq!(b[header::POPULATION], fresh[header::POPULATION]);
}

/// The setters in `view/marks.rs` are the only engine writes of a room's
/// frame fields and residents, the save loader and a new unit's
/// construction aside: a write anywhere else would leave the room unmarked,
/// and a frame reader would keep showing its old value.
#[test]
fn only_the_setters_write_the_frame_fields() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut stack = vec![src.clone()];
    let mut writers = Vec::new();
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(&src)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            // The loaders build a new tower, whose first frame is full; the
            // panels' test modules (`tests.rs`, `tests_*.rs`) set up towers.
            let loader = rel == "load.rs" || rel.starts_with("tdt/");
            let name = rel.rsplit('/').next().unwrap();
            let test = name.ends_with("_tests.rs") || name.starts_with("tests");
            if !rel.ends_with(".rs") || test || loader {
                continue;
            }
            let text = std::fs::read_to_string(&path)
                .unwrap()
                .replace("\r\n", "\n");
            let body = text.split("#[cfg(test)]\nmod tests").next().unwrap();
            for (n, line) in body.lines().enumerate() {
                let code = line.split("//").next().unwrap();
                if rel != "rng.rs" && writes_frame_field(code) {
                    writers.push(format!("{rel}:{}", n + 1));
                }
            }
        }
    }
    for (line, writes) in [
        ("u.state = UnitState::Empty;", true),
        ("u.occupants=0;", true),
        ("u.occupants += 1;", true),
        ("venue.customers_in = Some(n - 1);", true),
        ("v.hotel_customers_in.take()", true),
        ("o.out_for_meal.as_mut()", true),
        ("u.residents = None;", true),
        ("sim.tower.units[i].state = UnitState::Occupied;", true),
        ("let n = &mut u.occupants;", true),
        ("std::mem::replace(&mut u.customers_in, None)", true),
        ("u.state == UnitState::Empty", false),
        ("let n = u.occupants;", false),
        ("p.state = PState::Riding;", false),
        ("crowd.people[i].state = PState::Done;", false),
        ("probe.residents = None;", false),
    ] {
        assert_eq!(writes_frame_field(line), writes, "{line}");
    }
    assert!(
        writers.iter().all(|w| w.starts_with("view/marks.rs:")),
        "{writers:?}"
    );
    assert_eq!(writers.len(), 6, "{writers:?}");
}

/// Whether a line of code writes a room's frame field or residents in
/// place: an assignment (compound included), a mutating method on an
/// optional counter, or a `&mut` borrow of the field. A person's `state`
/// (a `PState`) and a local probe copy are not a room's. A new unit gets its
/// fields in a struct literal (`Tower::place`), which a line check cannot
/// tell from a rebuild elsewhere; the session oracle covers that case.
fn writes_frame_field(code: &str) -> bool {
    const FIELDS: [&str; 6] = [
        ".state",
        ".occupants",
        ".customers_in",
        ".hotel_customers_in",
        ".out_for_meal",
        ".residents",
    ];
    let squeezed: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    let person = squeezed.contains("PState") || squeezed.starts_with("p.state");
    if person || squeezed.starts_with("probe.") {
        return false;
    }
    let assigns = |field: &str| {
        squeezed.match_indices(field).any(|(at, m)| {
            let rest = &squeezed[at + m.len()..];
            (rest.starts_with('=') && !rest.starts_with("=="))
                || rest.starts_with("+=")
                || rest.starts_with("-=")
        })
    };
    let methods = [
        ".take(",
        ".replace(",
        ".insert(",
        ".get_or_insert",
        ".as_mut(",
    ];
    let mutates = |field: &str| {
        methods
            .iter()
            .any(|m| squeezed.contains(&format!("{field}{m}")))
    };
    let borrowed = squeezed.match_indices("&mut").any(|(at, m)| {
        let rest = &squeezed[at + m.len()..];
        let place = rest.split([')', ',', ';']).next().unwrap();
        FIELDS.iter().any(|f| place.ends_with(f))
    });
    FIELDS.iter().any(|f| assigns(f) || mutates(f)) || borrowed
}

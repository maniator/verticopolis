//! Reading the frame and view records the way a renderer would.

use serde_json::Value;
use verticopolis_engine::frame::{
    frame_view, header, log_since, person, transport, unit, CAR_RECORD, FRAME_HEADER, PERSON_FIXED,
    TRANSPORT_FIXED, UNIT_RECORD, UNKNOWN_ROUTINE,
};
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::view::{layout, meta_since, structure_view, ViewReader};

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

/// Read the renderer-facing view the way a host that keeps no copy of the
/// simulation would (`view`, layouts in `src/view/layout.rs`): the
/// structure's rooms and runs account for every unit, a first frame sends
/// every room with the population the simulation counts, a second frame
/// with nothing changed sends none, and the metadata listing parses.
pub fn read_view(sim: &Simulation) -> Result<(), String> {
    let s = structure_view(sim);
    use layout::structure;
    let (rooms, runs) = (s[structure::ROOMS] as usize, s[structure::RUNS] as usize);
    let run_at = layout::STRUCTURE_HEADER + rooms * layout::ROOM_RECORD;
    let tiles: f64 = (0..runs)
        .map(|k| s[run_at + k * layout::RUN_RECORD + layout::run::COUNT])
        .sum();
    if rooms + tiles as usize != sim.tower.units.len() {
        return Err(format!(
            "the structure holds {rooms} rooms and {tiles} tiles, the tower {} units",
            sim.tower.units.len()
        ));
    }
    let mut reader = ViewReader::new();
    let first = reader.frame(sim, false);
    use layout::header;
    let got = [
        first[header::FULL],
        first[header::ROOMS],
        first[header::UNITS],
    ];
    if got != [1.0, rooms as f64, rooms as f64] {
        return Err(format!("a first frame reads full, rooms, units {got:?}"));
    }
    if first[header::POPULATION] != sim.population() as f64 {
        let got = first[header::POPULATION];
        return Err(format!(
            "the frame counts {got} people, the simulation {}",
            sim.population()
        ));
    }
    let again = reader.frame(sim, false);
    if again[header::UNITS] != 0.0 {
        return Err(format!(
            "an unchanged frame resent {} rooms",
            again[header::UNITS]
        ));
    }
    let meta = meta_since(&sim.tower, None);
    if meta["full"] != true || !meta["units"].is_array() {
        return Err(format!("the metadata listing reads {meta}"));
    }
    Ok(())
}

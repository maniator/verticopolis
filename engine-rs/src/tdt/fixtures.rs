//! Test files for the retail SimTower (#920 claims 1 and 7, #740).
//!
//! Each builder takes a tower, exports it through the shipped encoder and
//! then rewrites one part of the finished file: the person block, the order
//! of the elevator table, or the position of two shafts. Nothing here is game
//! logic. The files are loaded by the original game on a PC to answer
//! questions the format notes leave open. Where a block sits in the file is
//! read from the importer's own walk (`parse_tdt_binary`), and the record
//! sizes come from `format.rs`, so no part of the layout is repeated here.

use serde_json::Value;

use super::export::build_tdt;
use super::format::{
    parse_tdt_binary, TDT_ELEVATOR_TYPE_EXPRESS, TDT_FLOOR_OFFSET, TDT_MAX_CENSUS,
    TDT_PERSON_RECORD_SIZE,
};
use super::tables::{tenant_kind, HOTEL_DIRTY_FLAG, HOTEL_INFESTED_FLAG, HOTEL_STAY_VACANT};
use super::types::TdtElevator;
use crate::facilities::Kind;

/// The most person records the census allows.
pub const MAX_PERSON_RECORDS: usize = TDT_MAX_CENSUS as usize;

/// A slot holds an express shaft when its type byte says so.
pub fn is_express(shaft: &TdtElevator) -> bool {
    shaft.type_id == TDT_ELEVATOR_TYPE_EXPRESS
}

/// Shafts that write an elevator slot and can share a column with another:
/// the standard and service kinds. Stairs and escalators go to another
/// table, and an express shaft is sized differently.
pub fn is_standard_or_service(kind: Kind) -> bool {
    matches!(kind, Kind::ElevatorStandard | Kind::ElevatorService)
}

/// Where the decoder found the blocks these edits move: the people block and
/// the built elevator slots, in file order. The file is read by
/// `parse_tdt_binary`, the importer's own walk, so no layout is repeated here.
pub struct Blocks {
    /// Start of the people block: its count, then that many records.
    pub people_at: usize,
    pub people_count: usize,
    pub elevators: Vec<TdtElevator>,
}

/// Read where the blocks sit in a finished export.
pub fn read_blocks(bytes: &[u8]) -> Result<Blocks, String> {
    let tail = parse_tdt_binary(bytes).map_err(|e| e.0)?.tail;
    let (Some(people_at), Some(people_count), Some(elevators)) =
        (tail.people_at, tail.people_count, tail.elevators)
    else {
        return Err(format!(
            "the file does not hold the documented tail ({})",
            tail.warnings.join(" ")
        ));
    };
    Ok(Blocks {
        people_at,
        people_count: people_count as usize,
        elevators,
    })
}

/// How many person records the file carries.
pub fn person_record_count(bytes: &[u8]) -> Result<usize, String> {
    Ok(read_blocks(bytes)?.people_count)
}

/// The same file with exactly `count` all-zero person records.
pub fn with_person_records(bytes: &[u8], count: usize) -> Result<Vec<u8>, String> {
    if count > MAX_PERSON_RECORDS {
        return Err(format!(
            "person record count {count} is outside 0 to {MAX_PERSON_RECORDS}"
        ));
    }
    let blocks = read_blocks(bytes)?;
    let old_end = blocks.people_at + 4 + blocks.people_count * TDT_PERSON_RECORD_SIZE;
    let mut out = Vec::with_capacity(bytes.len() + count * TDT_PERSON_RECORD_SIZE);
    out.extend_from_slice(&bytes[..blocks.people_at]);
    out.extend_from_slice(&(count as u32).to_le_bytes());
    out.resize(out.len() + count * TDT_PERSON_RECORD_SIZE, 0);
    out.extend_from_slice(&bytes[old_end..]);
    Ok(out)
}

/// The same file with every express shaft ahead of the other shafts, the
/// order the exporter deliberately avoids (#740). Each record keeps its
/// bytes; only their order in the table changes, so the length is the same.
/// The built slots sit together at the start of the table in an export, so
/// the records are rewritten over the span they already fill.
pub fn with_express_first(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let blocks = read_blocks(bytes)?;
    if !blocks
        .elevators
        .windows(2)
        .all(|w| w[0].record.end == w[1].record.start)
    {
        return Err(
            "the built elevator slots are not contiguous, so the file is not one of our exports"
                .into(),
        );
    }
    let (express, rest): (Vec<_>, Vec<_>) = blocks.elevators.iter().partition(|e| is_express(e));
    let mut out = bytes.to_vec();
    let mut at = blocks.elevators.first().map_or(0, |e| e.record.start);
    for e in express.into_iter().chain(rest) {
        out[at..at + e.record.len()].copy_from_slice(&bytes[e.record.clone()]);
        at += e.record.len();
    }
    Ok(out)
}

/// How two shafts sit relative to each other.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Overlap {
    /// Side by side with no shared column: the control.
    Apart,
    /// Exactly one shared tile column.
    Partial,
    /// The same columns.
    Full,
}

/// What an overlap edit changed.
#[derive(Debug, PartialEq, Eq)]
pub struct OverlapEdit {
    /// The `x` of the shaft that stays where it is.
    pub anchor_x: i64,
    /// The `x` the second shaft moved to.
    pub moved_x: i64,
    /// Tiles the two footprints share after the edit.
    pub shared_tiles: i64,
}

fn transport_i64(t: &Value, key: &str) -> Result<i64, String> {
    t.get(key)
        .and_then(Value::as_f64)
        .map(|v| v as i64)
        .ok_or_else(|| format!("a transport has no numeric {key}"))
}

fn transport_kind(t: &Value) -> Option<Kind> {
    t.get("kind").and_then(Value::as_str).and_then(Kind::parse)
}

/// Move the second standard or service shaft onto the first, over the same
/// floors. The edit is on the save, not the file, so the exporter's own
/// sorting and sizing still run. The width of a footprint is its kind's
/// catalog width, which the exporter checks overlap against.
pub fn overlap_first_two_shafts(save: &mut Value, mode: Overlap) -> Result<OverlapEdit, String> {
    let transports = save
        .get_mut("transports")
        .and_then(Value::as_array_mut)
        .ok_or("the save has no transports")?;
    let mut shafts = transports
        .iter_mut()
        .filter(|t| transport_kind(t).is_some_and(is_standard_or_service));
    let (Some(anchor), Some(moved)) = (shafts.next(), shafts.next()) else {
        return Err(
            "the save has fewer than two standard or service shafts; claim 1 needs at least two"
                .into(),
        );
    };
    let anchor_kind = transport_kind(anchor).expect("filtered on kind");
    let moved_kind = transport_kind(moved).expect("filtered on kind");
    let (anchor_x, bottom, top) = (
        transport_i64(anchor, "x")?,
        transport_i64(anchor, "bottom")?,
        transport_i64(anchor, "top")?,
    );
    let width = anchor_kind.facility().width;
    let shared = match mode {
        Overlap::Apart => 0,
        Overlap::Partial => 1,
        Overlap::Full => width.min(moved_kind.facility().width),
    };
    let moved_x = anchor_x + width - shared;
    moved["x"] = moved_x.into();
    moved["bottom"] = bottom.into();
    moved["top"] = top.into();
    Ok(OverlapEdit {
        anchor_x,
        moved_x,
        shared_tiles: shared,
    })
}

/// One file to hand to the original game.
pub struct Fixture {
    /// DOS 8.3 file name, with the extension.
    pub name: &'static str,
    pub bytes: Vec<u8>,
}

fn export(save: &Value) -> Result<Vec<u8>, String> {
    build_tdt(save).map(|b| b.bytes).map_err(|e| e.0)
}

/// #920 claim 1: the same tower with its first two shafts apart, sharing one
/// column and sharing every column. Returns each file with its edit.
pub fn claim1_fixtures(save: &Value) -> Result<Vec<(Fixture, OverlapEdit)>, String> {
    let cases = [
        (Overlap::Apart, "OVLAPCTL.TDT"),
        (Overlap::Partial, "OVLAP1.TDT"),
        (Overlap::Full, "OVLAPFUL.TDT"),
    ];
    cases
        .into_iter()
        .map(|(mode, name)| {
            let mut edited = save.clone();
            let edit = overlap_first_two_shafts(&mut edited, mode)?;
            Ok((
                Fixture {
                    name,
                    bytes: export(&edited)?,
                },
                edit,
            ))
        })
        .collect()
}

/// #920 claim 7: the same export with no person records, its own count and
/// the census maximum. Returns the files and the tower's own count.
pub fn claim7_fixtures(save: &Value) -> Result<(Vec<Fixture>, usize), String> {
    let base = export(save)?;
    let current = person_record_count(&base)?;
    let files = vec![
        Fixture {
            name: "PERS0.TDT",
            bytes: with_person_records(&base, 0)?,
        },
        Fixture {
            name: "PERSCUR.TDT",
            bytes: with_person_records(&base, current)?,
        },
        Fixture {
            name: "PERS15K.TDT",
            bytes: with_person_records(&base, MAX_PERSON_RECORDS)?,
        },
    ];
    Ok((files, current))
}

/// #740: our export (express last) and the same shafts with express first.
/// Returns the files, the built shaft count and the express count.
pub fn express740_fixtures(save: &Value) -> Result<(Vec<Fixture>, usize, usize), String> {
    let base = export(save)?;
    let shafts = read_blocks(&base)?.elevators;
    let express = shafts.iter().filter(|e| is_express(e)).count();
    if express < 1 || shafts.len() == express {
        return Err("the test needs at least one express shaft and one other shaft in the tower; use a save that has both (TOWER2 or TOWER6)".into());
    }
    let first = with_express_first(&base)?;
    let files = vec![
        Fixture {
            name: "EXPLAST.TDT",
            bytes: base,
        },
        Fixture {
            name: "EXPFIRST.TDT",
            bytes: first,
        },
    ];
    Ok((files, shafts.len(), express))
}

/// A hotel room in a finished export: where it stands and where its status
/// byte sits in the file.
#[derive(Debug, PartialEq, Eq)]
pub struct HotelRoom {
    /// Our floor number (the file's index less the floor offset).
    pub floor: i64,
    /// Left edge in tiles.
    pub x: i64,
    pub status_at: usize,
}

/// The hotel rooms of a finished export, in file order.
pub fn hotel_rooms(bytes: &[u8]) -> Result<Vec<HotelRoom>, String> {
    let tower = parse_tdt_binary(bytes).map_err(|e| e.0)?;
    Ok(tower
        .floors
        .iter()
        .flat_map(|floor| {
            floor
                .tenants
                .iter()
                .filter(|t| tenant_kind(t.type_id).is_some_and(|k| k.is_hotel()))
                .map(move |t| HotelRoom {
                    floor: floor.index - TDT_FLOOR_OFFSET,
                    x: t.left,
                    status_at: t.status_at,
                })
        })
        .collect())
}

/// How many hotel rooms the infested-flag files rewrite.
pub const INFESTED_TEST_ROOMS: usize = 3;

/// #1629: the same export with the first three hotel rooms each holding one
/// status the game's own saves never showed us, next to a control. The bytes
/// are set directly, since our exporter never writes the infested flag.
/// Returns the files and the rooms that were rewritten.
pub fn infested1629_fixtures(save: &Value) -> Result<(Vec<Fixture>, Vec<HotelRoom>), String> {
    let base = export(save)?;
    let rooms: Vec<_> = hotel_rooms(&base)?
        .into_iter()
        .take(INFESTED_TEST_ROOMS)
        .collect();
    if rooms.len() < INFESTED_TEST_ROOMS {
        return Err(format!(
            "the test needs {INFESTED_TEST_ROOMS} hotel rooms in the tower; use a save that has them (TOWER2)"
        ));
    }
    let with_status = |name, status: i64| {
        let mut bytes = base.clone();
        for room in &rooms {
            bytes[room.status_at] = status as u8;
        }
        Fixture { name, bytes }
    };
    let files = vec![
        with_status("INFCTL.TDT", HOTEL_STAY_VACANT),
        with_status("INFFLAG.TDT", HOTEL_INFESTED_FLAG),
        with_status("INFVAC.TDT", HOTEL_INFESTED_FLAG | HOTEL_STAY_VACANT),
        with_status("INFDIRTY.TDT", HOTEL_INFESTED_FLAG | HOTEL_DIRTY_FLAG),
    ];
    Ok((files, rooms))
}

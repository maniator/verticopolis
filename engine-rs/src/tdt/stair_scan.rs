//! The stairs table: its record shape and the signature scan that finds it
//! (`tdtTail.ts`). A table is never trusted by position alone.

use super::format::*;
use super::types::TdtStair;

fn rd16(bytes: &[u8], at: usize) -> i64 {
    bytes[at] as i64 | ((bytes[at + 1] as i64) << 8)
}

/// A crowd word. SimTower writes these as signed runtime values (a count can
/// dip below zero), so `0xfffb` is -5 and a real table is not rejected for it.
fn crowd(bytes: &[u8], at: usize) -> i64 {
    i64::from(rd16(bytes, at) as u16 as i16)
}

/// Read one stairs record: 0 = empty slot, 1 = built flight, -1 = not a
/// stair record at all.
fn classify_stair_record(bytes: &[u8], o: usize) -> i64 {
    const REC: usize = TDT_STAIR_RECORD_SIZE;
    if o + REC > bytes.len() {
        return -1;
    }
    let built = bytes[o];
    if built == 0 {
        return 0;
    }
    if built != 1 {
        return -1;
    }
    let type_id = bytes[o + 1] as i64;
    let x = rd16(bytes, o + 2);
    let floor = rd16(bytes, o + 4);
    if type_id > 5 {
        return -1;
    }
    if !(1..=TDT_MAX_TILE).contains(&x) {
        return -1;
    }
    if floor >= TDT_FLOOR_COUNT {
        return -1;
    }
    if crowd(bytes, o + 6).abs() > TDT_MAX_STAIR_CROWD
        || crowd(bytes, o + 8).abs() > TDT_MAX_STAIR_CROWD
    {
        return -1;
    }
    1
}

/// `locateStairs`: find the 64-record stairs table by scanning from `from`
/// for the window that holds the most built flights with no bad record, the
/// earliest such window winning a tie.
pub fn locate_stairs(bytes: &[u8], from: usize) -> Vec<TdtStair> {
    const REC: usize = TDT_STAIR_RECORD_SIZE;
    if bytes.len() < REC {
        return vec![];
    }
    let last = (bytes.len() - REC).min(from + TDT_STAIR_SCAN_WINDOW);
    // Windows start one byte apart and are 64 records long, so each offset is
    // read by up to 640 of them. Read every record once, and a window then
    // only adds up what is already known.
    let reach = (last + TDT_STAIR_SLOTS * REC).min(bytes.len());
    let classes: Vec<i8> = (from..reach)
        .map(|o| classify_stair_record(bytes, o) as i8)
        .collect();
    let mut best_base: Option<usize> = None;
    let mut best_built = 0;
    let mut base = from;
    while base <= last {
        let mut built = 0;
        let mut ok = true;
        for s in 0..TDT_STAIR_SLOTS {
            let o = base + s * REC;
            if o + REC > bytes.len() {
                break;
            }
            let c = classes[o - from];
            if c < 0 {
                ok = false;
                break;
            }
            built += i64::from(c);
        }
        if ok && built > best_built {
            best_built = built;
            best_base = Some(base);
        }
        base += 1;
    }
    let Some(best_base) = best_base else {
        return vec![];
    };
    let mut stairs = vec![];
    for s in 0..TDT_STAIR_SLOTS {
        let o = best_base + s * REC;
        if o + REC > bytes.len() {
            break;
        }
        if bytes[o] == 1 {
            stairs.push(TdtStair {
                type_id: bytes[o + 1] as i64,
                x: rd16(bytes, o + 2),
                floor: rd16(bytes, o + 4),
            });
        }
    }
    stairs
}

/// Could a complete stairs table start exactly at `at`?
pub fn stairs_table_starts_at(bytes: &[u8], at: usize) -> bool {
    if at + TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE > bytes.len() {
        return false;
    }
    let mut built = 0;
    for s in 0..TDT_STAIR_SLOTS {
        let c = classify_stair_record(bytes, at + s * TDT_STAIR_RECORD_SIZE);
        if c < 0 {
            return false;
        }
        built += c;
    }
    built > 0
}

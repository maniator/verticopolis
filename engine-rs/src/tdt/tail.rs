//! Tolerant walk of the blocks after the `.TDT` floor map (people, retail,
//! elevators, finance, parking, stairs) plus the signature scan that locates
//! the stairs table (`tdtTail.ts`). A misfit here never fails the import:
//! each unreadable stage is nulled and recorded as a warning.

use super::byte_reader::ByteReader;
use super::format::*;
use super::stamp::stamped_generation;
use super::types::{TdtElevator, TdtStair, TdtTail};

fn rd16(bytes: &[u8], at: usize) -> i64 {
    bytes[at] as i64 | ((bytes[at + 1] as i64) << 8)
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
    if rd16(bytes, o + 6) > TDT_MAX_STAIR_CROWD || rd16(bytes, o + 8) > TDT_MAX_STAIR_CROWD {
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
            let c = classify_stair_record(bytes, o);
            if c < 0 {
                ok = false;
                break;
            }
            built += c;
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

/// Does the trailing routing region begin exactly at `at`?
fn routing_tail_starts_at(bytes: &[u8], at: usize) -> bool {
    const RUN: usize = 64;
    if at == 0 || at + RUN > bytes.len() {
        return false;
    }
    if bytes[at - 1] == 0xff {
        return false;
    }
    bytes[at..at + RUN].iter().all(|&b| b == 0xff)
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

/// How a built elevator slot's payload is sized; see `tdtTail.ts`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum PayloadLayout {
    ExpressServiced,
    Spanned,
    Serviced,
}

/// Stops recorded in a slot's serviced bitmap, counting only floors the
/// shaft actually spans.
fn stop_count(serviced: &[u8], bottom_floor: i64, top_floor: i64) -> i64 {
    let from = bottom_floor.max(0);
    let to = top_floor.min(serviced.len() as i64 - 1);
    let mut stops = 0;
    let mut i = from;
    while i <= to {
        if serviced[i as usize] != 0 {
            stops += 1;
        }
        i += 1;
    }
    stops
}

fn payload_size(
    layout: PayloadLayout,
    type_id: i64,
    bottom_floor: i64,
    top_floor: i64,
    serviced: &[u8],
) -> i64 {
    // The table walk checks the span before sizing, so the helpers cannot
    // refuse here; a refusal would be a walker bug.
    let size = match layout {
        PayloadLayout::ExpressServiced => built_shaft_payload_size_for(
            type_id,
            bottom_floor,
            top_floor,
            stop_count(serviced, bottom_floor, top_floor),
        ),
        PayloadLayout::Spanned => built_shaft_payload_size(bottom_floor, top_floor),
        PayloadLayout::Serviced => {
            built_shaft_payload_size(1, stop_count(serviced, bottom_floor, top_floor).max(1))
        }
    };
    size.expect("elevator span checked before sizing")
}

struct TableWalk {
    elevators: Option<Vec<TdtElevator>>,
    warning: Option<&'static str>,
    end: usize,
}

const CUT_SHORT: &str = "The elevator table is cut short, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.";
const NOT_DOCUMENTED: &str = "The elevator table doesn't match the documented layout, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.";

/// Walk the 24-slot elevator table, sizing built payloads per `layout`.
fn read_elevator_table(r: &mut ByteReader, layout: PayloadLayout) -> TableWalk {
    r.enter_block("elevator table");
    let mut elevators = vec![];
    // Every read below is guarded by the size check first, so the reader
    // cannot run short mid-slot; `expect` marks that invariant.
    for _slot in 0..TDT_ELEVATOR_SLOTS {
        if r.remaining() < TDT_ELEVATOR_HEADER_SIZE {
            return TableWalk {
                elevators: None,
                warning: Some(CUT_SHORT),
                end: r.offset(),
            };
        }
        let used = r.u8().expect("header sized");
        let type_id = r.u8().expect("header sized");
        let capacity = r.u8().expect("header sized");
        let cars = r.u8().expect("header sized");
        r.skip(56).expect("header sized");
        r.skip(2).expect("header sized");
        let x = r.u16().expect("header sized");
        let top_floor = r.u8().expect("header sized");
        let bottom_floor = r.u8().expect("header sized");
        let serviced = r.bytes(TDT_FLOOR_COUNT as usize).expect("header sized");
        let mut car_homes = Vec::with_capacity(8);
        for _ in 0..8 {
            car_homes.push(r.u8().expect("header sized"));
        }
        if used == 0 {
            continue;
        }
        if used != 1
            || type_id > 2
            || !(1..=8).contains(&cars)
            || top_floor < bottom_floor
            || top_floor >= TDT_FLOOR_COUNT
        {
            return TableWalk {
                elevators: None,
                warning: Some(NOT_DOCUMENTED),
                end: r.offset(),
            };
        }
        let payload = payload_size(layout, type_id, bottom_floor, top_floor, &serviced) as usize;
        if r.remaining() < payload {
            return TableWalk {
                elevators: None,
                warning: Some(CUT_SHORT),
                end: r.offset(),
            };
        }
        r.skip(payload).expect("payload sized");
        elevators.push(TdtElevator {
            type_id,
            capacity,
            cars,
            x,
            top_floor,
            bottom_floor,
            serviced,
            car_homes,
        });
    }
    TableWalk {
        elevators: Some(elevators),
        warning: None,
        end: r.offset(),
    }
}

/// Which payload layout does this file use? Decided once for the whole file;
/// see `chooseLayout` in `tdtTail.ts` for the reasoning behind each step.
fn choose_layout(bytes: &[u8], table_start: usize) -> PayloadLayout {
    if stamped_generation(bytes) == Some(TDT_STAMP_GENERATION) {
        return PayloadLayout::Spanned;
    }
    let walk = |layout: PayloadLayout| -> TableWalk {
        let mut r = ByteReader::new(bytes);
        r.skip(table_start).expect("table start inside the file");
        read_elevator_table(&mut r, layout)
    };
    let current = walk(PayloadLayout::ExpressServiced);
    let ambiguous = current.elevators.as_ref().is_some_and(|es| {
        es.iter().any(|e| {
            stop_count(&e.serviced, e.bottom_floor, e.top_floor) != e.top_floor - e.bottom_floor + 1
        })
    });
    if current.elevators.is_some() && !ambiguous {
        return PayloadLayout::ExpressServiced;
    }
    let anchored = |end: usize| {
        let after_parking = end + TDT_FINANCE_SIZE + TDT_PARKING_SIZE;
        stairs_table_starts_at(bytes, after_parking)
            || routing_tail_starts_at(
                bytes,
                after_parking + TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE,
            )
    };
    let spanned = walk(PayloadLayout::Spanned);
    let serviced = walk(PayloadLayout::Serviced);
    for (layout, w) in [
        (PayloadLayout::ExpressServiced, &current),
        (PayloadLayout::Spanned, &spanned),
        (PayloadLayout::Serviced, &serviced),
    ] {
        if w.elevators.is_some() && anchored(w.end) {
            return layout;
        }
    }
    if spanned.elevators.is_some() {
        PayloadLayout::Spanned
    } else {
        PayloadLayout::ExpressServiced
    }
}

/// `walkTolerantTail`: the blocks after the floor map, in file order.
pub fn walk_tolerant_tail(r: &mut ByteReader) -> TdtTail {
    let mut tail = TdtTail::default();

    r.enter_block("people block");
    if r.remaining() < 4 {
        tail.warnings.push(
            "The file ends right after the floor map, so no people or transport data is present."
                .into(),
        );
        return tail;
    }
    let people_count = r.u32().expect("four bytes remain");
    if people_count > TDT_MAX_PEOPLE {
        tail.warnings.push(
            "The people table claims an impossible head count, so the rest of the file was skipped."
                .into(),
        );
        return tail;
    }
    let people_bytes = people_count as usize * TDT_PERSON_RECORD_SIZE;
    if r.remaining() < people_bytes {
        tail.warnings.push(
            "The people table runs past the end of the file, so the rest of the file was skipped."
                .into(),
        );
        tail.people_count = Some(people_count);
        return tail;
    }
    r.skip(people_bytes).expect("people block sized");
    tail.people_count = Some(people_count);

    r.enter_block("retail table");
    if r.remaining() < TDT_RETAIL_SLOTS * TDT_RETAIL_RECORD_SIZE {
        tail.warnings.push(
            "The retail table is missing or cut short, so the save's transport data couldn't be reached."
                .into(),
        );
        return tail;
    }
    let mut occupied = 0;
    for _ in 0..TDT_RETAIL_SLOTS {
        let floor = r.u8().expect("retail table sized");
        r.skip(TDT_RETAIL_RECORD_SIZE - 1)
            .expect("retail table sized");
        if floor != 0xff {
            occupied += 1;
        }
    }
    tail.retail_rows = Some(occupied);

    let table_start = r.offset();
    let layout = choose_layout(r.raw(), table_start);
    let table = read_elevator_table(r, layout);
    let Some(elevators) = table.elevators else {
        tail.warnings
            .push(table.warning.unwrap_or(CUT_SHORT).to_string());
        return tail;
    };
    tail.elevators = Some(elevators);
    let after_elevators = r.offset();

    r.enter_block("finance block");
    if r.remaining() >= TDT_FINANCE_SIZE {
        r.skip(TDT_FINANCE_SIZE).expect("finance block sized");
        r.enter_block("parking block");
        if r.remaining() >= TDT_PARKING_SIZE {
            tail.parking_connected = Some(r.u16().expect("parking block sized"));
            r.skip(TDT_PARKING_SIZE - 2).expect("parking block sized");
        } else {
            tail.warnings.push(
                "The save ends inside its parking data, so the connected-stall count could not be read."
                    .into(),
            );
        }
    } else {
        tail.warnings.push(
            "The save ends right after its elevators, so its finance, parking, and stairway data could not be read."
                .into(),
        );
    }

    r.enter_block("stairs table");
    tail.stairs = Some(locate_stairs(r.raw(), after_elevators));
    tail
}

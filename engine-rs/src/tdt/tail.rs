//! Tolerant walk of the blocks after the `.TDT` floor map (people, retail,
//! elevators, finance, parking, stairs) plus the signature scan that locates
//! the stairs table (`tdtTail.ts`). A misfit here never fails the import:
//! each unreadable stage is nulled and recorded as a warning.

use super::byte_reader::ByteReader;
use super::format::*;
use super::resync::{empty_slots_in_gap, find_next_header, MAX_BUILT_PAYLOAD, MIN_BUILT_PAYLOAD};
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

/// Does a structure whose position we know sit where a table ending at `end`
/// puts it: the stairs table after the finance and parking blocks, or the
/// routing region one stairs table further on?
fn table_end_anchored(bytes: &[u8], end: usize) -> bool {
    let after_parking = end + TDT_FINANCE_SIZE + TDT_PARKING_SIZE;
    // The game's own files leave a gap before the stairs table; our exports
    // from before it was measured did not.
    [TDT_STAIRS_GAP, 0].into_iter().any(|gap| {
        let stairs = after_parking + gap;
        stairs_table_starts_at(bytes, stairs)
            || routing_tail_starts_at(bytes, stairs + TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE)
    })
}

/// How a built elevator slot's payload is sized; see `tdtTail.ts`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum PayloadLayout {
    /// Express shafts carry an entry per eligible floor, the rest per spanned
    /// floor: what SimTower writes.
    ExpressEligible,
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
        PayloadLayout::ExpressEligible if type_id == TDT_ELEVATOR_TYPE_EXPRESS => {
            express_payload_size(bottom_floor, top_floor)
        }
        PayloadLayout::ExpressEligible => built_shaft_payload_size(bottom_floor, top_floor),
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
const RESYNCED: &str = "Some of the save's elevators are stored in a layout we don't fully understand, so their shafts were found by searching the file. Check that your elevators look right.";
const NOT_DOCUMENTED: &str = "The elevator table doesn't match the documented layout, so elevators were rebuilt from the floor layout and the save's stairways couldn't be read.";

/// Walk the 24-slot elevator table, sizing built payloads per `layout`. With
/// `resync`, a header that does not parse after a built slot is not the end of
/// the walk: the previous shaft's payload was sized wrong, so the next
/// plausible header is searched for past that shaft's smallest possible
/// payload and the walk goes on from there.
fn read_elevator_table(r: &mut ByteReader, layout: PayloadLayout, resync: bool) -> TableWalk {
    r.enter_block("elevator table");
    let mut elevators = vec![];
    let mut prev_header: Option<usize> = None;
    let mut slot_after_prev = 0;
    let mut slot = 0;
    // Every read below is guarded by the size check first, so the reader
    // cannot run short mid-slot; `expect` marks that invariant.
    while slot < TDT_ELEVATOR_SLOTS {
        if r.remaining() < TDT_ELEVATOR_HEADER_SIZE {
            return TableWalk {
                elevators: None,
                warning: Some(CUT_SHORT),
                end: r.offset(),
            };
        }
        let header_at = r.offset();
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
            slot += 1;
            continue;
        }
        if used != 1
            || type_id > 2
            || !(1..=8).contains(&cars)
            || top_floor < bottom_floor
            || top_floor >= TDT_FLOOR_COUNT
        {
            if let Some(prev) = prev_header.filter(|_| resync) {
                // The next shaft starts after this one's smallest possible
                // payload and no later than its largest (a whole-tower span).
                let past_smallest_payload = prev + TDT_ELEVATOR_HEADER_SIZE + MIN_BUILT_PAYLOAD;
                let within_largest_payload = prev + TDT_ELEVATOR_HEADER_SIZE + MAX_BUILT_PAYLOAD;
                // The stretch up to a header is the previous shaft's payload
                // (whole floors) and any empty slots between the two. Only one
                // count of empty slots makes that add up, so a header that
                // leaves none is not the next slot.
                let gap_fits =
                    |found: usize| empty_slots_in_gap(found - prev, slot_after_prev).is_some();
                if let Some(found) = find_next_header(
                    r.raw(),
                    past_smallest_payload,
                    within_largest_payload,
                    gap_fits,
                ) {
                    let empty_slots =
                        empty_slots_in_gap(found - prev, slot_after_prev).expect("accepted above");
                    slot = slot_after_prev + empty_slots;
                    r.seek(found).expect("found inside the file");
                    continue;
                }
            }
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
        prev_header = Some(header_at);
        slot += 1;
        slot_after_prev = slot;
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
    match stamped_generation(bytes) {
        Some(TDT_STAMP_SPANNED_GENERATION) => return PayloadLayout::Spanned,
        Some(TDT_STAMP_GENERATION) => return PayloadLayout::ExpressEligible,
        _ => {}
    }
    let walk = |layout: PayloadLayout| -> TableWalk {
        let mut r = ByteReader::new(bytes);
        r.skip(table_start).expect("table start inside the file");
        read_elevator_table(&mut r, layout, false)
    };
    let anchored = |end: usize| table_end_anchored(bytes, end);
    // A layout that sizes a payload wrong lands later headers on payload bytes,
    // which read as empty slots, so the walk that finds the most shafts has
    // the right layout. Ties go to the order below.
    let layouts = [
        PayloadLayout::ExpressEligible,
        PayloadLayout::ExpressServiced,
        PayloadLayout::Spanned,
        PayloadLayout::Serviced,
    ];
    let walks = layouts.map(&walk);
    // The legacy serviced-stops layout is read only when its table ends where
    // the rest of the file says it should; it fits too many broken files.
    let shafts = |layout: PayloadLayout, w: &TableWalk| {
        let believable = layout != PayloadLayout::Serviced || anchored(w.end);
        w.elevators.as_ref().filter(|_| believable).map(Vec::len)
    };
    let Some(most) = layouts
        .iter()
        .zip(walks.iter())
        .filter_map(|(layout, w)| shafts(*layout, w))
        .max()
    else {
        return PayloadLayout::ExpressServiced;
    };
    let ties: Vec<(PayloadLayout, &TableWalk)> = layouts
        .into_iter()
        .zip(walks.iter())
        .filter(|(layout, w)| shafts(*layout, w) == Some(most))
        .collect();
    if let Some((layout, _)) = ties.iter().find(|(_, w)| anchored(w.end)) {
        return *layout;
    }
    let ambiguous = |w: &TableWalk| {
        w.elevators.as_ref().is_some_and(|es| {
            es.iter().any(|e| {
                stop_count(&e.serviced, e.bottom_floor, e.top_floor)
                    != e.top_floor - e.bottom_floor + 1
            })
        })
    };
    ties.iter()
        .find(|(layout, w)| *layout != PayloadLayout::ExpressServiced || !ambiguous(w))
        .or(ties.first())
        .map(|(layout, _)| *layout)
        .expect("a walk found the most shafts")
}

/// The per-class people in the finance block, trusted only when they add up to
/// the total beside them and the total is not zero: a file from before the
/// block was filled holds zeros, which say nothing.
fn finance_population(finance: &[u8]) -> Option<[i64; TDT_POPULATION_CLASSES]> {
    let word = |at: usize| {
        i64::from(u32::from_le_bytes(
            finance[at..at + 4].try_into().expect("four bytes"),
        ))
    };
    let mut pops = [0; TDT_POPULATION_CLASSES];
    for (class, pop) in pops.iter_mut().enumerate() {
        *pop = word(TDT_FINANCE_POPULATION_AT + class * 4);
    }
    let total = word(TDT_FINANCE_TOTAL_AT);
    (total > 0 && pops.iter().sum::<i64>() == total).then_some(pops)
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
    let mut table = read_elevator_table(r, layout, false);
    if table.elevators.is_none() && table.warning == Some(NOT_DOCUMENTED) {
        // Some real saves size a shaft's payload by a rule none of the three
        // layouts has. Walk again, finding each header by its shape.
        r.seek(table_start).expect("table start inside the file");
        let retry = read_elevator_table(r, layout, true);
        if retry.elevators.is_some() {
            tail.warnings.push(RESYNCED.to_string());
            table = retry;
        }
    }
    let Some(elevators) = table.elevators else {
        tail.warnings
            .push(table.warning.unwrap_or(CUT_SHORT).to_string());
        return tail;
    };
    tail.elevators = Some(elevators);
    let after_elevators = r.offset();

    // The stairs table comes after the finance block, whose people counts can
    // read as a flight, so the search starts past it when the block is there.
    let mut stairs_search_from = after_elevators;
    r.enter_block("finance block");
    if r.remaining() >= TDT_FINANCE_SIZE {
        let finance = r.bytes(TDT_FINANCE_SIZE).expect("finance block sized");
        stairs_search_from = r.offset();
        tail.finance_population = finance_population(&finance);
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
    tail.stairs = Some(locate_stairs(r.raw(), stairs_search_from));
    tail
}

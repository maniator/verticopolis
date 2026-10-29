//! Finding elevator slot headers by their shape, for a save whose shaft
//! payloads are sized by a rule none of the documented layouts has
//! (`tdtElevatorResync.ts`; see `tail.rs`).

use super::format::*;

fn rd16(bytes: &[u8], at: usize) -> i64 {
    i64::from(u16::from_le_bytes([bytes[at], bytes[at + 1]]))
}

/// What a built shaft appends besides its per-floor entries.
const FIXED_PAYLOAD: usize = (TDT_ELEVATOR_BUILT_FIXED + TDT_ELEVATOR_CAR_BLOCK_SIZE) as usize;
/// The least a built shaft can append after its header: the fixed block, one
/// per-floor entry and the car block.
pub const MIN_BUILT_PAYLOAD: usize =
    (TDT_ELEVATOR_BUILT_FIXED + TDT_ELEVATOR_PER_FLOOR_SIZE + TDT_ELEVATOR_CAR_BLOCK_SIZE) as usize;
/// The most a built shaft can append: the fixed block, an entry for every
/// floor of the tower and the car block.
pub const MAX_BUILT_PAYLOAD: usize = (TDT_ELEVATOR_BUILT_FIXED
    + TDT_FLOOR_COUNT * TDT_ELEVATOR_PER_FLOOR_SIZE
    + TDT_ELEVATOR_CAR_BLOCK_SIZE) as usize;
/// Does a built elevator slot header start at `o`? Every field the walk
/// checks, plus what a real shaft always has: a position on the lot, and a
/// stop somewhere in its span (an express shaft may skip its own bottom
/// floor, as one measured 1997 save does). Strict on purpose: `find_next_header` uses
/// it to find a header inside payload bytes of unknown length.
fn plausible_header(bytes: &[u8], o: usize) -> bool {
    if o + TDT_ELEVATOR_HEADER_SIZE > bytes.len() {
        return false;
    }
    let (used, type_id, cars) = (bytes[o], bytes[o + 1], bytes[o + 3]);
    let x = rd16(bytes, o + 62);
    let (top, bottom) = (bytes[o + 64] as usize, bytes[o + 65] as usize);
    let serviced = &bytes[o + 66..o + 66 + TDT_FLOOR_COUNT as usize];
    used == 1
        && type_id <= 2
        && (1..=8).contains(&cars)
        && (1..=TDT_MAX_TILE).contains(&x)
        && bottom <= top
        && top < TDT_FLOOR_COUNT as usize
        && serviced[bottom..=top].iter().any(|&stop| stop != 0)
}

/// Empty slots that fit between a built shaft's header and the next built
/// header, `distance` bytes on, given that the shaft's payload is the fixed
/// block, the car block and a whole number of 324-byte floor entries (at least
/// one) and each empty slot is a 194-byte header. The two sizes share no factor
/// the slot count could hide in (194 x k is a multiple of 324 only when k is a
/// multiple of 162), so there is at most one answer, and `None` means the
/// distance fits no shaft followed by empty slots that still fit in the table
/// (`slot` is the index of the slot after the shaft).
pub fn empty_slots_in_gap(distance: usize, slot: usize) -> Option<usize> {
    let after_fixed = distance.checked_sub(TDT_ELEVATOR_HEADER_SIZE + FIXED_PAYLOAD)?;
    (0..TDT_ELEVATOR_SLOTS - slot).find(|&empty| {
        after_fixed
            .checked_sub(empty * TDT_ELEVATOR_HEADER_SIZE)
            .is_some_and(|floors| {
                floors >= TDT_ELEVATOR_PER_FLOOR_SIZE as usize
                    && floors % TDT_ELEVATOR_PER_FLOOR_SIZE as usize == 0
            })
    })
}

/// The first plausible built-slot header from `from` up to `to` that
/// `accepts` (the walk's own check on the distance to it).
pub fn find_next_header(
    bytes: &[u8],
    from: usize,
    to: usize,
    accepts: impl Fn(usize) -> bool,
) -> Option<usize> {
    (from..bytes.len().min(to + 1)).find(|&o| plausible_header(bytes, o) && accepts(o))
}

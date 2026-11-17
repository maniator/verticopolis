//! The extend drag's billing step, [`extend_bill`], kept beside `charges.rs`
//! so that file stays under the source ceiling.

use super::ExtendEnd;

#[doc(hidden)]
/// `extendBill`: one step of budget-clamped billing for an elevator extend.
/// Returns the new ends and the count of floors past the high-water mark.
pub fn extend_bill(
    cur: (i64, i64),
    hwm: (i64, i64),
    end: ExtendEnd,
    target_floor: i64,
    money: f64,
    per_floor: f64,
) -> (i64, i64, i64) {
    let (mut nb, mut nt) = cur;
    match end {
        ExtendEnd::Up => nt = (cur.0 + 1).max(target_floor),
        ExtendEnd::Down => nb = (cur.1 - 1).min(target_floor),
    }
    let budget = (money / per_floor).floor().max(0.0);
    // The budget is a whole count of floors; a balance too large for i64
    // saturates, which still pays for any span the tower can hold.
    let budget = if budget > i64::MAX as f64 {
        i64::MAX
    } else {
        budget as i64
    };
    if nt > hwm.1 {
        nt = hwm.1 + (nt - hwm.1).min(budget);
    }
    if nb < hwm.0 {
        nb = hwm.0 - (hwm.0 - nb).min(budget);
    }
    let added = (nt - hwm.1).max(0) + (hwm.0 - nb).max(0);
    (nb, nt, added)
}

#[cfg(test)]
#[path = "charges_extend_tests.rs"]
mod tests;

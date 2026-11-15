//! The segments a search has seen, as one bit per segment id (`seg_id`):
//! a search tests every edge it walks against the set, and a bit costs a
//! few instructions where a hashed set costs a hash and a probe. An id
//! outside the tower's lot (no node carries one today) goes to a hashed
//! set instead, so the set answers the same for every id. The crowd keeps
//! one set between searches (`Crowd::route_seen`): the bits are allocated
//! once, and `clear` zeroes only the words a search touched.

use super::fasthash::FastSet;
use crate::facilities::{LOT_WIDTH, MAX_FLOOR, MIN_FLOOR};

/// Every segment id a floor of the lot can carry: `0..LOT_IDS`.
const LOT_IDS: i64 = (MAX_FLOOR - MIN_FLOOR + 1) * LOT_WIDTH;

#[derive(Default)]
pub(crate) struct SegSet {
    /// One bit per lot id, empty until the first insert.
    bits: Vec<u64>,
    /// The words of `bits` that hold a set bit.
    touched: Vec<usize>,
    beyond: FastSet<i64>,
}

impl SegSet {
    /// Forgets every id, in time proportional to the words set.
    pub(crate) fn clear(&mut self) {
        for &word in &self.touched {
            self.bits[word] = 0;
        }
        self.touched.clear();
        self.beyond.clear();
    }

    /// Adds `seg`; whether it was new.
    #[inline]
    pub(crate) fn insert(&mut self, seg: i64) -> bool {
        if !(0..LOT_IDS).contains(&seg) {
            return self.beyond.insert(seg);
        }
        if self.bits.is_empty() {
            self.bits = vec![0; ((LOT_IDS + 63) / 64) as usize];
        }
        let (word, bit) = ((seg / 64) as usize, 1u64 << (seg % 64));
        let held = self.bits[word];
        if held == 0 {
            self.touched.push(word);
        }
        self.bits[word] = held | bit;
        held & bit == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_like_a_hashed_set_inside_and_outside_the_lot() {
        let mut bits = SegSet::default();
        let mut hashed = FastSet::default();
        let ids = [
            0,
            1,
            63,
            64,
            65,
            LOT_IDS - 1,
            LOT_IDS,
            -1,
            i64::MIN + 1,
            375,
            1,
        ];
        for round in 0..2 {
            for &id in &ids {
                assert_eq!(bits.insert(id), hashed.insert(id), "{id} round {round}");
            }
        }
        // A cleared set answers as a new one, so a search can reuse it.
        bits.clear();
        hashed.clear();
        for &id in &ids {
            assert_eq!(bits.insert(id), hashed.insert(id), "{id} after clear");
        }
        assert!(bits.bits.iter().filter(|&&w| w != 0).count() <= bits.touched.len());
    }
}

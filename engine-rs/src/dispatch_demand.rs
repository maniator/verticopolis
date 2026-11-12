//! The stop search of the SCAN dispatcher in `dispatch.rs`: a shaft's stops
//! as bit sets, and the nearest stop ahead of a car that answers its calls.

use std::collections::BTreeSet;

use super::{AT_STOP_FLOORS, WORD};

pub(super) fn set_bit(bits: &mut [u64], k: usize) {
    bits[k / WORD] |= 1u64 << (k % WORD);
}

pub(super) fn has_bit(bits: &[u64], k: usize) -> bool {
    bits[k / WORD] & (1u64 << (k % WORD)) != 0
}

/// The car's cab floors as a bit set over `stops`, in `bits`. A cab floor
/// that is not a stop is left out, as the scan never reached it. The set is
/// ordered, so the floors are read in floor order.
pub(super) fn fill_cab_stops<'a>(
    stops: &[i64],
    cab: &BTreeSet<i64>,
    bits: &'a mut Vec<u64>,
) -> &'a [u64] {
    bits.clear();
    bits.resize(stops.len().div_ceil(WORD), 0);
    for fl in cab {
        if let Ok(k) = stops.binary_search(fl) {
            set_bit(bits, k);
        }
    }
    bits
}

/// What one car asks of its shaft: the stops in ascending order, the
/// `calls` and `claimed` bit sets over them, and the car's own cab stops.
pub(super) struct Demand<'a> {
    pub(super) stops: &'a [i64],
    pub(super) calls: &'a [u64],
    pub(super) claimed: &'a [u64],
    pub(super) cab: Option<&'a [u64]>,
}

impl Demand<'_> {
    /// The stops that answer in word `w`: a live call no car has claimed,
    /// or one of this car's cab stops (never blocked by a claim).
    fn word(&self, w: usize) -> u64 {
        (self.calls[w] & !self.claimed[w]) | self.cab.map_or(0, |c| c[w])
    }

    /// Whether stop `k` is one of this car's cab stops.
    pub(super) fn is_cab(&self, k: usize) -> bool {
        self.cab.is_some_and(|c| has_bit(c, k))
    }

    /// The lowest answering stop at or above index `from`.
    fn first_from(&self, from: usize) -> Option<usize> {
        let mut w = from / WORD;
        if w >= self.calls.len() {
            return None;
        }
        let mut bits = self.word(w) & (u64::MAX << (from % WORD));
        while bits == 0 {
            w += 1;
            if w >= self.calls.len() {
                return None;
            }
            bits = self.word(w);
        }
        Some(w * WORD + bits.trailing_zeros() as usize)
    }

    /// The highest answering stop below index `end`.
    fn last_below(&self, end: usize) -> Option<usize> {
        let last = end.checked_sub(1)?;
        let mut w = last / WORD;
        let mut bits = self.word(w) & (u64::MAX >> (WORD - 1 - last % WORD));
        while bits == 0 {
            w = w.checked_sub(1)?;
            bits = self.word(w);
        }
        Some(w * WORD + (WORD - 1) - bits.leading_zeros() as usize)
    }

    /// `nextDemandStop`: the index of the nearest stop strictly ahead that
    /// answers.
    ///
    /// The TypeScript scans every stop and keeps the first strict minimum,
    /// which is the lowest floor among equal distances. `stops` ascends, so
    /// going up the nearest is the lowest answering stop ahead, and going
    /// down it is the highest one below, then any lower stop at the same
    /// distance. Ties need a position far beyond any tower, where rounding
    /// merges distances. Each search reads a word or two (a shaft built in
    /// play has at most 31 stops, and a floor range of about 110 caps any
    /// shaft at two words); going down, the tie check makes one more search.
    /// So a car with nothing to serve no longer tests its shaft's stops one
    /// by one.
    pub(super) fn next_stop(&self, pos: f64, dir: i64) -> Option<usize> {
        debug_assert_ne!(dir, 0);
        let stops = self.stops;
        let dist = |k: usize| (stops[k] as f64 - pos).abs();
        let k = if dir > 0 {
            self.first_from(stops.partition_point(|&s| s as f64 <= pos + AT_STOP_FLOORS))?
        } else {
            self.last_below(stops.partition_point(|&s| (s as f64) < pos - AT_STOP_FLOORS))?
        };
        let d = dist(k);
        // Going down, a lower stop at the same distance wins. Only a finite
        // distance can tie usefully: the check below drops the rest.
        let mut k = k;
        if dir < 0 && d < f64::INFINITY {
            while let Some(j) = self.last_below(k).filter(|&j| dist(j) == d) {
                k = j;
            }
        }
        // The scan's `dist < best_dist` from infinity: a position that is not
        // finite finds no stop.
        (d < f64::INFINITY).then_some(k)
    }
}

//! The crowd's floor index (#2151): the people by the floor band they stand
//! in, so a view's people window (`view::ViewReader::frame`) visits only the
//! people on its floors instead of testing the whole crowd every frame.
//!
//! The step keeps it current in the pass that drops the people who finished
//! (`settle`, which reads every person's floor position once, in the same
//! walk `retain` already made, then sorts the indices into bands with one
//! counting pass), and a load builds it whole (`rebuild`). Someone added
//! after a settle is counted as a newcomer (`joined`) and stays outside the
//! bands until the next one, so a reader tests every newcomer. It is never
//! saved or hashed, and nothing in the simulation reads it. Only the step
//! moves a person's floor position, so the bands hold between steps; a debug
//! build checks that before every windowed frame (`agrees`). A reader asks
//! [`FloorIndex::fits`] first: an index out of step with the crowd (a host
//! that added or dropped people itself) is passed over for a walk over the
//! crowd until the next step settles it.
//!
//! A crowd under [`INDEXED_FROM`] people keeps no index: testing that few
//! people costs a frame less than reading an index does, so the step skips
//! the work and a reader tests everyone, as before the index.

use std::ops::Range;

use super::{Crowd, PState, Person};

/// The lowest and highest band the index keeps apart. A person outside
/// them (no floor of any lot reaches that far) shares the edge band, and a
/// reader still tests their exact position, so the clamp only bounds the
/// band list.
const LOWEST_BAND: i64 = -64;
const HIGHEST_BAND: i64 = 256;

/// The band a floor position falls in: the floor at or below it, so a
/// rider between floors 3 and 4 is in band 3 (and one at -0.5 in band -1).
/// A cast and a compare, so the step pays no call to `floor` per person.
pub fn band(fy: f64) -> i64 {
    let toward_zero = fy as i64;
    let below = i64::from((toward_zero as f64) > fy);
    (toward_zero - below).clamp(LOWEST_BAND, HIGHEST_BAND)
}

/// A band's place in the band list, from 0.
fn slot(fy: f64) -> u16 {
    (band(fy) - LOWEST_BAND) as u16
}

/// The crowd size from which the step keeps the index. Below it a frame
/// tests every person: #2151 measured a frame at 140 people a little
/// slower read through the index than by testing everyone, so today's
/// crowd (at most 140) keeps none and costs what it did.
pub const INDEXED_FROM: usize = 512;

/// The people by band: the crowd indices sorted by band, each band's
/// ascending (the crowd's order).
pub struct FloorIndex {
    /// Each settled person's band slot, by crowd index.
    slots: Vec<u16>,
    /// The settled crowd indices, band by band.
    order: Vec<u32>,
    /// Where each band from `lowest` on ends in `order`; it starts where the
    /// band before it ends (band `lowest` at 0).
    ends: Vec<u32>,
    lowest: u16,
    /// The crowd's length the index describes (the settled people, then
    /// the newcomers since), or `None` while it keeps none.
    people: Option<usize>,
    /// The crowd size from which it is kept: [`INDEXED_FROM`], which a test
    /// may lower.
    from: usize,
}

impl Default for FloorIndex {
    fn default() -> FloorIndex {
        FloorIndex {
            slots: Vec::new(),
            order: Vec::new(),
            ends: Vec::new(),
            lowest: 0,
            people: None,
            from: INDEXED_FROM,
        }
    }
}

impl FloorIndex {
    /// Whether the index describes `people`, the crowd it was built from.
    pub fn fits(&self, people: &[Person]) -> bool {
        self.people == Some(people.len())
    }

    /// The settled crowd indices in `band`, ascending; empty for a band
    /// nobody was in.
    #[cfg(any(test, debug_assertions))]
    pub fn in_band(&self, band: i64) -> &[u32] {
        self.in_bands(band, band)
    }

    /// The settled crowd indices in the bands `lo..=hi`, band by band (each
    /// band's ascending). The bands lie side by side in one list, so this is
    /// one slice, found without a visit to any band.
    pub fn in_bands(&self, lo: i64, hi: i64) -> &[u32] {
        let place = |band: i64| {
            band.clamp(LOWEST_BAND, HIGHEST_BAND) - LOWEST_BAND - i64::from(self.lowest)
        };
        let (first, last) = (place(lo).max(0), place(hi).min(self.ends.len() as i64 - 1));
        if first > last {
            return &[];
        }
        let start = if first == 0 {
            0
        } else {
            self.ends[first as usize - 1]
        };
        &self.order[start as usize..self.ends[last as usize] as usize]
    }

    /// The crowd indices added since the last settle, in no band yet.
    pub fn newcomers(&self) -> Range<usize> {
        self.slots.len()..self.people.unwrap_or(self.slots.len())
    }

    /// Sort the indices into their bands from `slots`: a count per band, a
    /// running sum, then each index placed in turn, so every band keeps the
    /// crowd's order.
    fn fill(&mut self) {
        self.people = Some(self.slots.len());
        self.ends.clear();
        self.order.clear();
        let Some(&first) = self.slots.first() else {
            return;
        };
        let (lo, hi) =
            (self.slots.iter()).fold((first, first), |(lo, hi), &s| (lo.min(s), hi.max(s)));
        self.lowest = lo;
        self.ends.resize(usize::from(hi - lo) + 1, 0);
        for &s in &self.slots {
            self.ends[usize::from(s - lo)] += 1;
        }
        let mut start = 0;
        for n in &mut self.ends {
            let count = *n;
            *n = start;
            start += count;
        }
        // Each band's entry is now where it starts; placing an index moves
        // it on, so it ends where the band does.
        self.order.resize(self.slots.len(), 0);
        for (i, &s) in self.slots.iter().enumerate() {
            let at = &mut self.ends[usize::from(s - lo)];
            self.order[*at as usize] = i as u32;
            *at += 1;
        }
    }

    /// Keep the index from a crowd of `from` people on, in place of
    /// [`INDEXED_FROM`], so a test can read it with a small crowd. Takes
    /// effect at the next settle or rebuild.
    #[cfg(test)]
    pub fn keep_from(&mut self, from: usize) {
        self.from = from;
    }

    /// Build the index for `people` from scratch (none under the size it is
    /// kept from).
    pub fn rebuild(&mut self, people: &[Person]) {
        self.slots.clear();
        if people.len() < self.from {
            self.people = None;
            return;
        }
        self.slots.extend(people.iter().map(|p| slot(p.fy)));
        self.fill();
    }

    /// Whether every settled person stands in the band the index holds them
    /// in, and the newcomers make up the rest: the check a debug build makes
    /// before a frame trusts the index, so a path that moves someone outside
    /// the step's walk fails a test.
    #[cfg(any(test, debug_assertions))]
    pub fn agrees(&self, people: &[Person]) -> bool {
        let banded = |(i, (p, &s)): (usize, (&Person, &u16))| {
            let b = i64::from(s) + LOWEST_BAND;
            b == band(p.fy) && self.in_band(b).binary_search(&(i as u32)).is_ok()
        };
        self.fits(people)
            && self.slots.len() <= people.len()
            && people.iter().zip(&self.slots).enumerate().all(banded)
    }
}

/// Drop the people who finished, keeping the crowd's order, and bring the
/// index up to date with where everyone now stands. The one walk over the
/// crowd that `retain` made before; the index's own work is two passes over
/// the bands.
pub fn settle(crowd: &mut Crowd) {
    let Crowd {
        people, by_floor, ..
    } = crowd;
    by_floor.slots.clear();
    if people.len() < by_floor.from {
        people.retain(|p| p.state != PState::Done);
        by_floor.people = None;
        return;
    }
    by_floor.slots.reserve(people.len());
    people.retain(|p| {
        let keep = p.state != PState::Done;
        if keep {
            by_floor.slots.push(slot(p.fy));
        }
        keep
    });
    by_floor.fill();
}

/// The person just pushed onto the crowd counts as a newcomer until the
/// next settle bands them. An index already out of step stays out of step.
pub fn joined(crowd: &mut Crowd) {
    let index = &mut crowd.by_floor;
    if let Some(n) = index
        .people
        .as_mut()
        .filter(|n| **n + 1 == crowd.people.len())
    {
        *n += 1;
    }
}

#[cfg(test)]
#[path = "floor_index_tests.rs"]
mod tests;

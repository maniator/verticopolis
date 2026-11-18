//! The refusals a newly served floor can raise, which `resize_transport`
//! checks for every new floor and an extend drag stops just short of
//! (#1847).

use super::{Tower, Transport};
use crate::facilities::*;

impl Tower {
    /// Why shaft `id` (at `tx`, `twidth` wide) cannot newly serve floor
    /// `fl`: another shaft is in the way, or a lobby is due there and not
    /// built (the ground floor holds only lobby, and a sky lobby floor needs
    /// every tile under the shaft built first). `None` when it can.
    pub(super) fn new_floor_refusal(
        &self,
        id: i64,
        tx: i64,
        twidth: i64,
        fl: i64,
    ) -> Option<String> {
        let blocked = self
            .transports
            .iter()
            .any(|other| other.id != id && Self::transport_overlaps(other, tx, twidth, fl));
        if blocked {
            return Some(SHAFT_OVERLAP.into());
        }
        if is_lobby_floor(fl) && !self.span_has_floor(fl, tx, twidth) {
            let lobby = if is_sky_lobby_floor(fl) {
                "sky lobby"
            } else {
                "lobby"
            };
            return Some(format!(
                "Build the {lobby} on floor {fl} first, then extend through it."
            ));
        }
        None
    }

    /// Why a new `kind` shaft at `x`, `width` wide, cannot run `bottom..=top`:
    /// a floor without structure under it, or a built shaft in the way. The
    /// lowest failing floor wins, and a missing floor beats an overlap on the
    /// same floor. One pass over the shafts in the probe's columns finds the
    /// lowest overlap, and the structure walk stops there, so a drag costs
    /// those shafts plus floors rather than every shaft times floors (#1261).
    pub(super) fn shaft_floor_refusal(
        &self,
        kind: Kind,
        x: i64,
        width: i64,
        bottom: i64,
        top: i64,
    ) -> Option<&'static str> {
        if !self.shaft_has_structure_at(bottom, x, width) {
            return Some(NEEDS_FLOORS);
        }
        let overlap = self.lowest_overlap_floor(kind, x, width, bottom, top);
        if (bottom + 1..=overlap.unwrap_or(top))
            .any(|fl| !self.shaft_has_structure_at(fl, x, width))
        {
            return Some(NEEDS_FLOORS);
        }
        overlap.map(|_| SHAFT_OVERLAP)
    }

    /// The lowest floor of `bottom..=top` where a new `kind` shaft at `x`,
    /// `width` wide, would share tiles with a built shaft. Two fixed-span
    /// flights of the same column that meet end to end are a stack. The
    /// first probe at a revision walks every shaft, as a placement does
    /// once; a second (a preview drag) builds the column index and reads
    /// only the shafts whose columns meet `x..x + width`.
    fn lowest_overlap_floor(
        &self,
        kind: Kind,
        x: i64,
        width: i64,
        bottom: i64,
        top: i64,
    ) -> Option<i64> {
        let overlap_low = |t: &Transport| -> Option<i64> {
            if !(x < t.x + t.width && x + width > t.x) {
                return None;
            }
            let stacked = kind.is_fixed_span()
                && t.kind.is_fixed_span()
                && t.x == x
                && t.width == width
                && (bottom == t.top || top == t.bottom);
            let low = bottom.max(t.bottom);
            (!stacked && low <= top.min(t.top)).then_some(low)
        };
        let mut lowest: Option<i64> = None;
        let mut consider = |low: i64| {
            lowest = Some(lowest.map_or(low, |l| l.min(low)));
            low == bottom
        };
        match self.shaft_columns() {
            Some(cols) => {
                for &i in cols.meeting(x, width) {
                    if overlap_low(&self.transports[i]).is_some_and(&mut consider) {
                        break;
                    }
                }
            }
            None => {
                for t in &self.transports {
                    if overlap_low(t).is_some_and(&mut consider) {
                        break;
                    }
                }
            }
        }
        lowest
    }

    /// The column index once this revision has been probed before, else
    /// `None` (and the probe is noted).
    fn shaft_columns(&self) -> Option<std::sync::Arc<ShaftColumns>> {
        let key = (self.revision, self.transports.len());
        let mut memo = self.memo.borrow_mut();
        match &memo.shaft_columns {
            Some((k, Some(cols))) if *k == key => return Some(cols.clone()),
            Some((k, None)) if *k == key => {}
            _ => {
                memo.shaft_columns = Some((key, None));
                return None;
            }
        }
        let cols = std::sync::Arc::new(ShaftColumns::new(&self.transports));
        memo.shaft_columns = Some((key, Some(cols.clone())));
        Some(cols)
    }
}

impl Tower {
    /// How many transports of `kind` the tower has, from one count of every
    /// kind per edit (#1261).
    pub(super) fn transport_kind_count(&self, kind: Kind) -> i64 {
        let key = (self.revision, self.transports.len());
        if let Some((k, counts)) = &self.memo.borrow().transport_kinds {
            if *k == key {
                return counts[kind as usize];
            }
        }
        let mut counts = vec![0; FACILITIES.len()];
        for t in &self.transports {
            counts[t.kind as usize] += 1;
        }
        let answer = counts[kind as usize];
        self.memo.borrow_mut().transport_kinds = Some((key, counts.into()));
        answer
    }
}

/// The shafts bucketed by left column (a counting sort, so a build is one
/// pass over the shafts and one over the columns), with the widest shaft's
/// width, so a probe reads only the buckets whose shafts can meet it.
pub struct ShaftColumns {
    /// Shaft indexes in left column order.
    by_x: Vec<usize>,
    /// Where each column's bucket starts in `by_x`, from `min_x`, with one
    /// end entry.
    starts: Vec<usize>,
    min_x: i64,
    max_width: i64,
}

impl ShaftColumns {
    fn new(transports: &[Transport]) -> ShaftColumns {
        let min_x = transports.iter().map(|t| t.x).min().unwrap_or(0);
        let max_x = transports.iter().map(|t| t.x).max().unwrap_or(-1);
        let max_width = transports.iter().map(|t| t.width).max().unwrap_or(0);
        let span = usize::try_from(max_x - min_x + 1).unwrap_or(0);
        let mut starts = vec![0; span + 1];
        for t in transports {
            starts[(t.x - min_x) as usize + 1] += 1;
        }
        for c in 0..span {
            starts[c + 1] += starts[c];
        }
        let mut next = starts.clone();
        let mut by_x = vec![0; transports.len()];
        for (i, t) in transports.iter().enumerate() {
            let c = (t.x - min_x) as usize;
            by_x[next[c]] = i;
            next[c] += 1;
        }
        ShaftColumns {
            by_x,
            starts,
            min_x,
            max_width,
        }
    }

    /// The shafts whose left column lies where a shaft of up to `max_width`
    /// could meet `x..x + width`; the caller still checks the overlap.
    fn meeting(&self, x: i64, width: i64) -> &[usize] {
        let columns = self.starts.len() as i64 - 1;
        let lo = (x - self.max_width + 1 - self.min_x).max(0);
        let hi = (x + width - 1 - self.min_x).min(columns - 1);
        if lo > hi {
            return &[];
        }
        &self.by_x[self.starts[lo as usize]..self.starts[hi as usize + 1]]
    }
}

#[cfg(test)]
#[path = "transport_overlap_tests.rs"]
mod tests;

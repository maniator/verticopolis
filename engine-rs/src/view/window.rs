//! The people window: the part of the tower a view draws, so its frame
//! carries only the people there (`ViewReader::set_people_window`). The 1994
//! game draws every person in its scrolling window and none outside it; a
//! view does the same here, so the frame's size follows the screen and stays
//! flat as the crowd grows. The window is the host's camera and no part of
//! the game: it is not saved and not hashed, and the simulation steps every
//! person whatever it is.

use crate::crowd::floor_index::{band, FloorIndex};
use crate::crowd::Person;
use crate::tower::Transport;

/// The floors and tiles a view shows: a person is in it when their floor
/// position (`fy`) lies within `floor_lo..=floor_hi` and their tile (`x`)
/// within `x_lo..=x_hi`, after the pads [`PeopleWindow::padded`] adds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PeopleWindow {
    /// The lowest floor shown.
    pub floor_lo: f64,
    /// The highest floor shown.
    pub floor_hi: f64,
    /// The leftmost tile shown.
    pub x_lo: f64,
    /// The rightmost tile shown.
    pub x_hi: f64,
}

/// The floors a window reaches past its edges, so a figure standing on the
/// edge floor, or a car gliding between two floors there, keeps its people.
pub const FLOOR_PAD: f64 = 1.0;

impl PeopleWindow {
    /// A window from a host's four numbers, or `None` (every person) when
    /// one is not finite or a range is empty, so a host that sends nonsense
    /// gets the whole crowd instead of an empty frame.
    pub fn new(floor_lo: f64, floor_hi: f64, x_lo: f64, x_hi: f64) -> Option<PeopleWindow> {
        let finite = [floor_lo, floor_hi, x_lo, x_hi]
            .iter()
            .all(|v| v.is_finite());
        (finite && floor_lo <= floor_hi && x_lo <= x_hi).then_some(PeopleWindow {
            floor_lo,
            floor_hi,
            x_lo,
            x_hi,
        })
    }

    /// The window as a frame tests people against: [`FLOOR_PAD`] floors
    /// past each edge, and half the widest shaft plus one tile past each
    /// side. A rider stands at their shaft's middle, so a car whose edge is
    /// on screen has its middle at most half its width outside, and every
    /// rider of a car the view shows is in the frame.
    pub fn padded(self, transports: &[Transport]) -> PeopleWindow {
        self.padded_by(widest_shaft(transports))
    }

    /// [`PeopleWindow::padded`] with the widest shaft's width already
    /// found, so a reader that keeps it per tower revision pads each frame's
    /// window without a walk over the transports.
    pub(crate) fn padded_by(self, widest: i64) -> PeopleWindow {
        let x_pad = widest as f64 / 2.0 + 1.0;
        PeopleWindow {
            floor_lo: self.floor_lo - FLOOR_PAD,
            floor_hi: self.floor_hi + FLOOR_PAD,
            x_lo: self.x_lo - x_pad,
            x_hi: self.x_hi + x_pad,
        }
    }

    /// Whether `p` is in the window as it stands (pads already added).
    pub fn holds(&self, p: &Person) -> bool {
        (self.floor_lo..=self.floor_hi).contains(&p.fy) && (self.x_lo..=self.x_hi).contains(&p.x)
    }

    /// Marks in `marks`, one bit per crowd index, everyone the crowd's
    /// floor index `index` (which must fit a crowd of `people`) holds in the
    /// bands this window spans (pads already added), and every newcomer it
    /// has not banded yet, and returns how many; the window's people are
    /// among them, and a reader tests each in crowd order with
    /// [`PeopleWindow::holds`] (`marked`). Bits instead of a list keep crowd
    /// order with no sort, at one word per 64 people to clear. `None`, with
    /// nothing marked, when those people are a third of the crowd or more:
    /// a test of every person in turn then costs no more (#2151 measured
    /// the lobby screen, where the crowd gathers).
    pub(crate) fn mark(
        &self,
        index: &FloorIndex,
        people: usize,
        marks: &mut Vec<u64>,
    ) -> Option<usize> {
        let banded = index.in_bands(band(self.floor_lo), band(self.floor_hi));
        let found = banded.len() + index.newcomers().len();
        if found * 3 >= people {
            return None;
        }
        marks.clear();
        marks.resize(people.div_ceil(64), 0);
        for i in banded.iter().map(|&i| i as usize).chain(index.newcomers()) {
            marks[i / 64] |= 1u64 << (i % 64);
        }
        Some(found)
    }
}

/// The crowd indices `marks` holds (`PeopleWindow::mark`), ascending.
pub(crate) fn marked(marks: &[u64]) -> impl Iterator<Item = usize> + '_ {
    marks.iter().enumerate().flat_map(|(w, &word)| {
        let mut bits = word;
        std::iter::from_fn(move || {
            (bits != 0).then(|| {
                let i = w * 64 + bits.trailing_zeros() as usize;
                bits &= bits - 1;
                i
            })
        })
    })
}

/// The widest transport's width in tiles, 0 with none: the width
/// [`PeopleWindow::padded`] pads by. One pass over the transports.
pub(crate) fn widest_shaft(transports: &[Transport]) -> i64 {
    transports.iter().map(|t| t.width).max().unwrap_or(0)
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod window_tests;

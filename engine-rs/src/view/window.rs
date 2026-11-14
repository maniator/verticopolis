//! The people window: the part of the tower a view draws, so its frame
//! carries only the people there (`ViewReader::set_people_window`). The 1994
//! game draws every person in its scrolling window and none outside it; a
//! view does the same here, so the frame's size follows the screen and stays
//! flat as the crowd grows. The window is the host's camera and no part of
//! the game: it is not saved and not hashed, and the simulation steps every
//! person whatever it is.

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
        let widest = transports.iter().map(|t| t.width).max().unwrap_or(0);
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
}

#[cfg(test)]
#[path = "window_tests.rs"]
mod window_tests;

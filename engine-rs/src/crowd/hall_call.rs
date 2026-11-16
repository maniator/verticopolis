//! One stop's hall call: the people waiting there for a shaft, and the ways
//! they are bound, so a car can tell whom it takes.

/// The people waiting at one stop of a shaft, and how many of them are
/// bound up and down (one whose next floor is unknown counts in neither).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HallCall {
    pub callers: f64,
    pub up: u32,
    pub down: u32,
}

impl From<f64> for HallCall {
    /// `callers` waiting, their ways unknown.
    fn from(callers: f64) -> Self {
        HallCall {
            callers,
            ..HallCall::default()
        }
    }
}

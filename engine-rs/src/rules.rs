//! The Classic and Modern rules, as named methods on [`GameMode`]. Each
//! submodule holds one domain's rules, and every other file asks them by
//! name: a direct mode check outside this module fails
//! `src/tests/modeBranch.guard.test.ts`.

use crate::clock::GameMode;

mod amenities;
mod commute;
mod construction;
mod economy;
mod films;
mod households;
mod parking;
mod people;
mod presentation;
mod rent;
mod satisfaction;
mod services;

pub use amenities::*;
pub use commute::{CLASSIC_WAIT_LIMIT, MODERN_WAIT_LIMIT};
pub use economy::*;
pub use households::*;
pub use parking::OfficeParking;
pub use people::*;
pub use rent::RentModel;
pub use satisfaction::*;
pub use services::HousekeepingShift;

#[doc(hidden)]
impl GameMode {
    pub fn is_modern(self) -> bool {
        self == GameMode::Modern
    }
}

//! Mode rules for real commute waits (#1971): how long a floor's tenants
//! may wait on average before the wait counts as congestion.

use crate::clock::GameMode;
use crate::crowd::GIVE_UP;

/// Real commute waits (#1971): the average crowd seconds a floor's tenants
/// wait per trip that reads as a full transport (congestion 1.0). In Classic
/// it is a rider's patience ([`GIVE_UP`]): a floor whose trips wait that long
/// on average drains. Lower limits sank the nine real player towers in
/// `conformance/fixtures/tdt-reddit` (50 seconds cost the healthy 4 and 5
/// star ones 15 to 35 percent of their tenants in four days); at this one only
/// the busiest (6,223 people) loses a few of its worst-served rooms. Modern
/// tolerates half as long again.
pub const CLASSIC_WAIT_LIMIT: f64 = GIVE_UP;
pub const MODERN_WAIT_LIMIT: f64 = 1.5 * GIVE_UP;

/// Real office commutes and the faster Modern express, switched off (owner,
/// 2026-11-14). On Naftali's own Modern tower (about 4,950 office workers)
/// they kept only 56% of its tenants over four days, against 100% today:
/// the cars board too few people per stop to carry a real rush. They stay
/// off, so nothing changes for players, until the stop fix (#2061) and the
/// line-counting router let that tower keep 95%. What must be true before
/// they turn on is issue #2214 (backlog row `real-office-commutes-switch-on`).
pub const REAL_OFFICE_COMMUTES_ON: bool = false;

/// Whether real office commutes are on in this build.
#[cfg(not(test))]
pub(crate) fn real_office_commutes_on() -> bool {
    REAL_OFFICE_COMMUTES_ON
}

/// Whether real office commutes are on: in the tests, also when the test's
/// thread turned them on.
#[cfg(test)]
pub(crate) fn real_office_commutes_on() -> bool {
    REAL_OFFICE_COMMUTES_ON || office_commutes_switch::is_on()
}

#[doc(hidden)]
impl GameMode {
    /// The congestion a floor's real average commute wait stands for
    /// (#1971): the wait over this mode's limit, so a floor whose tenants
    /// wait past it drains as an overloaded transport does.
    pub fn commute_wait_congestion(self, average_wait: f64) -> f64 {
        let limit = match self {
            GameMode::Classic => CLASSIC_WAIT_LIMIT,
            GameMode::Modern => MODERN_WAIT_LIMIT,
        };
        average_wait / limit
    }

    /// Whether office workers come in and go home as people
    /// (`crowd::commuters`) instead of an hourly head count. Modern only
    /// (owner, 2026-11-14), and only while [`REAL_OFFICE_COMMUTES_ON`]: in
    /// Classic the full rush jams the shared elevators of healthy 1990s
    /// towers with today's car timing, so Classic offices keep the head
    /// count until a run of the 1994 game measures how it spreads its rush
    /// and times its cars.
    pub fn office_workers_commute_in_person(self) -> bool {
        self == GameMode::Modern && real_office_commutes_on()
    }
}

/// Lets a test turn real office commutes on for its own thread.
#[cfg(test)]
pub(crate) mod office_commutes_switch {
    use std::cell::Cell;

    thread_local! {
        static ON: Cell<bool> = const { Cell::new(false) };
    }

    /// Keeps real office commutes on for this thread until it is dropped.
    pub(crate) struct On;

    impl Drop for On {
        fn drop(&mut self) {
            ON.with(|on| on.set(false));
        }
    }

    pub(crate) fn turn_on() -> On {
        ON.with(|on| on.set(true));
        On
    }

    pub(crate) fn is_on() -> bool {
        ON.with(Cell::get)
    }
}

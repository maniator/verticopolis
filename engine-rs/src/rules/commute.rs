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

/// Real office commutes in Modern, with its faster cars (owner,
/// 2026-11-14). They merged switched off in #2199, when the owner's own Modern
/// tower (about 4,950 office workers) kept only 56% of its tenants over four
/// days. The jam was routing: nearly the whole rush lined up for one
/// street-lobby shaft while its twin stood idle. With the line-counting
/// router (#2203) and Modern cars twice as fast, that tower keeps all of
/// them (#2214). Setting this to `false` puts Modern offices back on the
/// hourly head count and its cars back at the Classic speed.
pub const REAL_OFFICE_COMMUTES_ON: bool = true;

/// Whether real office commutes are on in this build.
pub(crate) fn real_office_commutes_on() -> bool {
    REAL_OFFICE_COMMUTES_ON
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

    /// Whether a venue's staff (`Kind::staff_size`) come in and go home as
    /// people, and the venue opens only once one of them is in. Modern
    /// only, with the office commutes (owner, 2026-11-14: nobody appears or
    /// vanishes in the tower). The original draws no venue staff, so
    /// Classic venues open by the clock.
    pub fn venue_staff_commute_in_person(self) -> bool {
        self.office_workers_commute_in_person()
    }
}

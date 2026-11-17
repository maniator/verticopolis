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

/// A commute that gives up counts as waiting at least this many times the
/// mode's limit (owner, 2026-11-17, #2019). A rider runs out of patience at
/// about the Classic limit and below the Modern one, so without this a jam
/// that strands a floor's commuters would hardly lift its average past the
/// limit. A wait right at the limit only stops recovery; past it the floor
/// drains, here as fast as a floor whose every trip waits twice the limit.
pub(crate) const GIVE_UP_WAIT_LIMITS: f64 = 2.0;

/// Real office commutes in Modern, with its faster cars (owner,
/// 2026-11-14). They merged switched off in #2199, when the owner's own Modern
/// tower (about 4,950 office workers) kept only 56% of its tenants over four
/// days. The jam was routing: nearly the whole rush lined up for one
/// street-lobby shaft while its twin stood idle. With the line-counting
/// router (#2203) and Modern cars twice as fast, that tower keeps all of
/// them (#2214). Setting this to `false` puts Modern offices back on the
/// hourly head count and its cars back at the Classic speed.
pub const REAL_OFFICE_COMMUTES_ON: bool = true;

/// Residents of Modern condos, apartments and studios who really leave for
/// the day and come home (owner, 2026-11-15, the real-tenant-arrivals plan's
/// homes step). Before, the dispatch's estimate stood in for them: cars
/// drove to their floors and carried riders nobody could see. Setting this to
/// `false` puts Modern homes back on the hourly head count and the estimate.
pub const REAL_RESIDENT_TRIPS_ON: bool = true;

/// Guests of Modern hotel rooms who really check in and check out (owner,
/// 2026-11-16, the real-tenant-arrivals plan's hotels step). Before, a room
/// filled the moment it was let and emptied at checkout, and the dispatch's
/// estimate kept sending cars to hotel floors for guests nobody could see,
/// sleeping ones included. Setting this to `false` puts Modern hotels back
/// on the hourly head count and the estimate.
pub const REAL_HOTEL_GUESTS_ON: bool = true;

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
        average_wait / self.commute_wait_limit()
    }

    /// The average commute wait that reads as a full transport in this mode
    /// ([`CLASSIC_WAIT_LIMIT`], [`MODERN_WAIT_LIMIT`]).
    pub(crate) fn commute_wait_limit(self) -> f64 {
        match self {
            GameMode::Classic => CLASSIC_WAIT_LIMIT,
            GameMode::Modern => MODERN_WAIT_LIMIT,
        }
    }

    /// The least wait a commute that gave up counts as (#2019): over this
    /// mode's limit ([`GIVE_UP_WAIT_LIMITS`]), so a floor whose commuters
    /// keep giving up drains.
    pub(crate) fn given_up_commute_wait(self) -> f64 {
        GIVE_UP_WAIT_LIMITS * self.commute_wait_limit()
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

    /// Whether the residents of a home (a condo, apartment or studio) leave
    /// for the day and come home as people (`crowd::commuters`) instead of
    /// an hourly head count and the dispatch's estimate. Modern only, with
    /// the office commutes, and only while [`REAL_RESIDENT_TRIPS_ON`]
    /// (owner, 2026-11-15: a car carries only riders the player can see).
    /// Classic homes keep the head count until a run of the 1994 game
    /// measures its rush.
    pub fn residents_commute_in_person(self) -> bool {
        self.office_workers_commute_in_person() && REAL_RESIDENT_TRIPS_ON
    }

    /// Whether hotel guests ride in from the lobby or the Metro once their
    /// room is let and ride out again at checkout (`crowd::commuters`),
    /// instead of appearing in the room and the dispatch's estimate. Modern
    /// only, with the residents, and only while [`REAL_HOTEL_GUESTS_ON`]
    /// (owner, 2026-11-16: a car carries only riders the player can see).
    /// Classic hotels keep the head count until a run of the 1994 game
    /// measures its check-in.
    pub fn hotel_guests_arrive_in_person(self) -> bool {
        self.residents_commute_in_person() && REAL_HOTEL_GUESTS_ON
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

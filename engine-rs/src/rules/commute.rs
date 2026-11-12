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
}

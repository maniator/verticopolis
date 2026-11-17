//! Housekeeping, the exterminator and the bomb and ransom events.

use crate::clock::GameMode;
use crate::services::{EXTERMINATOR_CALLOUT_FEE, EXTERMINATOR_PER_ROOM_FEE};

#[derive(Clone, Copy, Debug)]
pub struct HousekeepingShift {
    pub start: i64,
    pub end: i64,
    pub cutoff: f64,
}

#[doc(hidden)]
impl GameMode {
    pub fn housekeeping_shift(self) -> HousekeepingShift {
        match self {
            GameMode::Classic => HousekeepingShift {
                start: 12,
                end: 17,
                cutoff: 16.5,
            },
            GameMode::Modern => HousekeepingShift {
                start: 8,
                end: 19,
                cutoff: 18.5,
            },
        }
    }

    /// Whether housekeeping sends the nearest staff-connected crew to a room:
    /// Modern orders each floor's crews by distance and scores rooms by it;
    /// Classic tries the crews in tower order.
    pub fn housekeeping_sends_nearest_crew(self) -> bool {
        self == GameMode::Modern
    }

    /// `infestationRecovery()`: the paid exterminator's `(calloutFee,
    /// perRoomFee)`, or `None` where the mode has no exterminator.
    pub fn infestation_recovery(self) -> Option<(f64, f64)> {
        match self {
            GameMode::Classic => None,
            GameMode::Modern => Some((EXTERMINATOR_CALLOUT_FEE, EXTERMINATOR_PER_ROOM_FEE)),
        }
    }

    /// Whether a Security office that opens during a bomb search sends its
    /// guards to join it. Modern lets the player answer the countdown by
    /// building; Classic searches with the guards it had when the call came
    /// (the Mac FAQ has no Security built during a threat).
    pub fn security_joins_bomb_search(self) -> bool {
        self == GameMode::Modern
    }

    /// Whether the ransom call needs a Security office in the tower first:
    /// the SimTower manual has terrorists strike only a tower with security
    /// personnel. Modern rolls it at four stars either way.
    pub fn ransom_needs_security(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether a fire needs Security in the tower before it can start: the
    /// SimTower manual has fires, like terrorists, strike only a tower with
    /// security personnel (#1889). Modern towers can burn without it.
    pub fn fire_needs_security(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether a thief needs Security in the tower before he can prowl it:
    /// the SimTower manual brings its emergencies only to a tower with
    /// security personnel, and the thief joins the fire and the ransom call
    /// (#2364). Modern thieves strike with or without it.
    pub fn thief_needs_security(self) -> bool {
        self == GameMode::Classic
    }

    /// Whether a Security office that opens while a fire burns sends its
    /// guards to it, as late offices join a bomb search. Classic's guards are
    /// the ones on duty when the fire starts (#1889).
    pub fn security_joins_fire(self) -> bool {
        self == GameMode::Modern
    }

    /// The Fire Rescue helicopter's fixed price, or `None` where it scales
    /// with the tower's stars. Classic charges the $500,000 the PC fan guides
    /// agree on (MentalMan, kiwizoid, furdude2; the combined Mac and Windows
    /// manual shows $300,000), #1889. Modern keeps its star-scaled price.
    pub fn fire_rescue_fixed_price(self) -> Option<f64> {
        (self == GameMode::Classic).then_some(500_000.0)
    }
}

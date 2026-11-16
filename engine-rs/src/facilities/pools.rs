//! The pooled build caps: kinds that share one cap per tower (`Tower::cap_reason`).

use super::{Kind, LOT_WIDTH, MAX_FLOOR, MIN_FLOOR};

#[doc(hidden)]
pub struct Pool {
    pub kinds: &'static [Kind],
    pub cap: i64,
    pub label: &'static str,
}

#[doc(hidden)]
/// `POOLED_CAPS`.
pub static POOLED_CAPS: [Pool; 2] = [
    Pool {
        kinds: &[
            Kind::ElevatorStandard,
            Kind::ElevatorService,
            Kind::ElevatorExpress,
        ],
        cap: 24,
        label: "elevator shafts",
    },
    Pool {
        kinds: &[Kind::Stairs, Kind::Escalator],
        cap: 64,
        label: "stairs/escalators",
    },
];

/// The elevator shafts a Modern tower may hold, all three kinds together:
/// twice SimTower's 24, so a lot of several towers can give each its own
/// banks (owner, 2026-11-15).
pub const MODERN_ELEVATOR_SHAFT_CAP: i64 = 48;

/// Modern's transport pools: the elevator pool of [`POOLED_CAPS`], with room
/// for [`MODERN_ELEVATOR_SHAFT_CAP`] shafts. Modern sets no limit on stairs
/// and escalators (owner, 2026-11-16), so it has no second pool: only the
/// lot's own room bounds them ([`lot_flight_room`]).
pub static MODERN_POOLED_CAPS: [Pool; 1] = [Pool {
    kinds: POOLED_CAPS[0].kinds,
    cap: MODERN_ELEVATOR_SHAFT_CAP,
    label: POOLED_CAPS[0].label,
}];

/// The transport pools `mode` enforces, in [`POOLED_CAPS`] order: the
/// elevator pool, then the stairs and escalators pool where the mode keeps
/// SimTower's limit of 64.
pub fn transport_pools(mode: crate::clock::GameMode) -> &'static [Pool] {
    if mode.builds_more_elevator_shafts() {
        &MODERN_POOLED_CAPS
    } else {
        &POOLED_CAPS
    }
}

/// The most stairs and escalators the lot itself can hold. Each flight
/// climbs one story, and two flights that overlap across the lot can share a
/// floor only when one stands on the other, so each of the lot's stories
/// holds at most a row of the narrowest flights side by side.
pub fn lot_flight_room() -> i64 {
    let narrowest = [Kind::Stairs, Kind::Escalator]
        .iter()
        .map(|k| k.facility().width)
        .min()
        .unwrap_or(1)
        .max(1);
    (LOT_WIDTH / narrowest) * (MAX_FLOOR - MIN_FLOOR)
}

/// The most transports, of every kind together, a tower in `mode` may hold:
/// its pools' limits, and where it sets no limit on stairs and escalators,
/// the lot's room for them ([`lot_flight_room`]). The loader keeps no more.
pub fn transport_cap(mode: crate::clock::GameMode) -> i64 {
    let pooled: i64 = transport_pools(mode).iter().map(|p| p.cap).sum();
    if mode.limits_stairs_and_escalators() {
        pooled
    } else {
        pooled + lot_flight_room()
    }
}

/// Classic's party hall and theater pool (#1932): the 1994 save keeps one
/// table of 16 records shared by every party hall and theater, so the two
/// kinds share one cap of 16. Modern keeps a cap of 16 for each.
pub static CLASSIC_VENUE_POOL: Pool = Pool {
    kinds: &[Kind::Cinema, Kind::PartyHall],
    cap: 16,
    label: "party halls and theaters",
};

/// Every pooled cap `mode` enforces: the transport pools, then Classic's
/// venue pool.
pub fn pools_for(mode: crate::clock::GameMode) -> impl Iterator<Item = &'static Pool> {
    let venues = mode.shares_venue_cap().then_some(&CLASSIC_VENUE_POOL);
    transport_pools(mode).iter().chain(venues)
}

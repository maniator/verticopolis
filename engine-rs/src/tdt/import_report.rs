//! The import fidelity report (`tdtImportReport.ts`). This phase carries the
//! running tally the parse pass fills; the player-facing report text is the
//! next phase of the port (AC3).

/// The running tally `parse_tdt` fills while decoding the floor map
/// (`ImportCounts`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ImportCounts {
    pub rooms: i64,
    pub offices: i64,
    pub occupied_offices: i64,
    pub condos: i64,
    pub sold_condos: i64,
    pub hotel_rooms: i64,
    pub hotel_asleep: i64,
    pub hotel_dirty: i64,
    pub hotel_booked: i64,
    pub asleep_converted: i64,
    pub infested: i64,
    pub venues: i64,
    pub services: i64,
    pub parking_stalls: i64,
    pub construction: i64,
    pub rents_applied: i64,
    pub twin_rooms: i64,
    pub secom: i64,
    pub cathedral: i64,
    pub burned: i64,
    pub unknown: i64,
    pub dropped_floors: i64,
    pub off_lot: i64,
    pub overlapping: i64,
    pub misplaced: i64,
    pub clamped: i64,
    pub width_mismatch: i64,
}

/// The transport decode's loss accounting, as the report reads it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DecodeStats {
    pub dropped_shafts: i64,
    pub adjusted_shafts: i64,
    pub dropped_flights: i64,
}

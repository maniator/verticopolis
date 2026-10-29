//! The records the gather pass hands to the encoder.

use indexmap::IndexMap;
use serde_json::Value;

use super::FloorKey;
use crate::facilities::Kind;
use crate::tdt::export_tables::OutTenant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkipReason {
    OutOfRange,
    Burned,
    Unmappable,
}

/// A normalized room plus whether the gather pass wrote a tenant record for
/// it (`GatheredRoom`).
#[derive(Clone, Debug)]
pub struct GatheredRoom {
    pub kind: Kind,
    pub floor: f64,
    pub x: f64,
    pub width: f64,
    /// Whether `x` and the defaulted `width` were both finite numbers in the
    /// save, as `Number.isFinite` reads them: a `null` or a string `x` fails
    /// this even though `js_num` turns it into a usable 0. Only a room that
    /// writes no record consults it (the extent it may still claim).
    pub coords_finite: bool,
    /// The state string, or "" for a value that is not a string (which
    /// matches no state, as a stray number matches none in TypeScript).
    pub state: String,
    pub occupants: f64,
    pub ever_occupied: bool,
    pub label: Option<String>,
    /// The raw `rent` value, `None` for undefined.
    pub rent: Option<Value>,
    pub no_rate: bool,
    pub subtype: Option<String>,
    /// `residents`: `None` for undefined, else the value as `Number.isFinite`
    /// reads it (a `null` or a string reads as NaN, which the census then
    /// skips; `residentCount` returns the raw household without coercing).
    pub residents: Option<f64>,
    pub emitted: bool,
    pub skip_reason: Option<SkipReason>,
}

/// Loss/quirk tally the exporter fills while gathering (`ExportCounts`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExportCounts {
    pub rooms: i64,
    pub rents_snapped: i64,
    pub names_dropped: i64,
    pub hotel_states: i64,
    pub occupied: i64,
    pub construction: i64,
    pub parking_stalls: i64,
    pub burned_out: i64,
    pub vacancy_history_lost: i64,
    pub out_of_range: i64,
}

/// The header aggregate counts the 1994 game trusts.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ExportHeaderCounts {
    pub recycling: i64,
    pub commercial: i64,
    pub security: i64,
    pub hall_cinema: i64,
}

/// Everything the gather pass produces for the encoder and report.
pub struct GatheredTower {
    /// Tenant records keyed by TDT floor index.
    pub tenants_by_tdt: IndexMap<FloorKey, Vec<OutTenant>>,
    /// Built extent [left, right) per our floor.
    pub extents: IndexMap<FloorKey, (f64, f64)>,
    /// Retail-table rows (TDT-space floor, canon variant), bounded at 512.
    pub retail_rows: Vec<(f64, i64)>,
    pub counts: ExportCounts,
    pub header: ExportHeaderCounts,
    pub has_ground_lobby: bool,
    pub people_pop: f64,
    pub rooms: Vec<GatheredRoom>,
}

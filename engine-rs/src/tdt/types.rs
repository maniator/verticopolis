//! The raw intermediate model of a `.TDT` file (`tdtTypes.ts`): a dumb mirror
//! of the bytes with no game semantics applied. The mapping to the serialized
//! game lives in `parse.rs`.

/// One tenant record, mirrored raw from the file (`TdtTenant`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdtTenant {
    /// Left/right extents in tiles (half-open range).
    pub left: i64,
    pub right: i64,
    /// Tenant type ID; negative means under construction.
    pub type_id: i64,
    /// Status/flags byte at offset 5.
    pub status: i64,
    /// Retail variant ordinal at offset 6.
    pub variant: i64,
    /// Rent/lease rate byte at offset 16.
    pub rent_rate: i64,
    /// Byte 17 (unused in v1).
    pub subtype: i64,
}

/// One floor record: built extent plus its tenant list (`TdtFloor`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdtFloor {
    /// TDT floor index 0..119.
    pub index: i64,
    pub left_edge: i64,
    pub right_edge: i64,
    pub tenants: Vec<TdtTenant>,
}

/// The fixed-offset header fields v1 consumes (`TdtHeader`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdtHeader {
    pub version: i64,
    pub level: i64,
    /// Funds in stored units; display dollars are x100. Signed.
    pub balance: i64,
    pub frame_time: i64,
    pub current_day: i64,
    pub view_x: i64,
    pub view_y: i64,
}

/// One decoded elevator entry (`TdtElevator`; floors are TDT indexes).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdtElevator {
    /// 0 = express, 1 = standard, 2 = service.
    pub type_id: i64,
    pub capacity: i64,
    pub cars: i64,
    pub x: i64,
    pub top_floor: i64,
    pub bottom_floor: i64,
    /// Per-floor stop flags (120 entries; nonzero = cars stop there).
    pub serviced: Vec<u8>,
    /// Home floor for each of the 8 car slots (TDT indexes).
    pub car_homes: Vec<i64>,
}

/// One decoded stair/escalator record (`TdtStair`; floor is a TDT index).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdtStair {
    /// 0 = escalator, 1 = stairs; 2/3 two-story, 4/5 three-story.
    pub type_id: i64,
    pub x: i64,
    pub floor: i64,
}

/// Everything the tolerant tail walk can produce (`TdtTail`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TdtTail {
    pub people_count: Option<i64>,
    pub retail_rows: Option<i64>,
    pub elevators: Option<Vec<TdtElevator>>,
    pub stairs: Option<Vec<TdtStair>>,
    pub parking_connected: Option<i64>,
    pub warnings: Vec<String>,
}

/// The whole file, mirrored (`TdtTower`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdtTower {
    pub header: TdtHeader,
    pub floors: Vec<TdtFloor>,
    pub tail: TdtTail,
}

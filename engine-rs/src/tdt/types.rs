//! The raw intermediate model of a `.TDT` file (`tdtTypes.ts`): a dumb mirror
//! of the bytes with no game semantics applied. The mapping to the serialized
//! game lives in `parse.rs`.

use super::format::TDT_POPULATION_CLASSES;

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
    /// Where that status byte sits in the file.
    pub status_at: usize,
    /// Byte 6: a shop, fast food or restaurant's row in the retail table
    /// (its low byte), a party hall or theatre's row in their table.
    pub variant: i64,
    /// Byte 7: the high byte of a retail room's row, for a tower with more
    /// than 256 retail rooms; 0 in every save the game wrote that we hold.
    pub row_high: i64,
    /// Byte 15: a theatre's film draw (2 for a new film, then 1 and 0 as it
    /// ages); other kinds carry their own values here.
    pub draw: i64,
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
    /// The floor's 94-entry map from a retail row's room slot to its tenant.
    pub index_map: Vec<u16>,
}

/// One row of the retail table: its place in the table, its floor index,
/// room slot (through the floor's `index_map`), the visitors it served
/// yesterday (byte 8, #1500) and the room's style (byte 11, #2044), which
/// is `None` in a row without the game's constant 255 in byte 13 (our own
/// exports before #2044 kept the style elsewhere).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TdtRetailRow {
    pub row: usize,
    pub floor: u8,
    pub slot: u8,
    pub served: u8,
    pub style: Option<u8>,
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
    /// The ground lobby's height in stories (offset 28): 1 to 3 in a tower
    /// with a lobby, 0 before the first lobby is placed (#308).
    pub lobby_height: i64,
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
    /// Where the slot's header and payload sit in the file.
    pub record: std::ops::Range<usize>,
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
    /// Where the people block starts (its count, then the records).
    pub people_at: Option<usize>,
    pub people_count: Option<i64>,
    pub retail_rows: Option<i64>,
    /// The retail table's filled rows, in file order.
    pub retail: Vec<TdtRetailRow>,
    pub elevators: Option<Vec<TdtElevator>>,
    pub stairs: Option<Vec<TdtStair>>,
    pub parking_connected: Option<i64>,
    /// The party hall and theatre table's filled records (#1932).
    pub venues: Vec<TdtVenue>,
    /// The people of each class the finance block counts (`POP_*` order), when
    /// the block holds a count that adds up to its total.
    pub finance_population: Option<[i64; TDT_POPULATION_CLASSES]>,
    pub warnings: Vec<String>,
}

/// One record of the party hall and theatre table (#1932): the floor records
/// of the venue's upper and lower halves, its logical unit id on each, its
/// film (`None` for a hall) and the days the film has shown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdtVenue {
    pub upper_floor: i64,
    pub lower_floor: i64,
    pub upper_slot: u8,
    pub lower_slot: u8,
    pub film: Option<u8>,
    pub days_shown: u8,
}

impl TdtVenue {
    /// Whether the theatre shows a classic film (#1932), whose draw never
    /// climbs past a fading film's. A hall shows none.
    pub fn shows_classic(&self) -> bool {
        self.film.is_some_and(super::venues::is_classic_film)
    }
}

/// The whole file, mirrored (`TdtTower`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TdtTower {
    pub header: TdtHeader,
    pub floors: Vec<TdtFloor>,
    pub tail: TdtTail,
}

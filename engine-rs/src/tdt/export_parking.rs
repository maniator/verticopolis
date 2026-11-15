//! The parking side of a `.TDT` export (#307): the stall table in the
//! routing tail, each stall record's index into it, the connected list and
//! the ramp column in the header.
//!
//! A run of the original on the owner's machine (2026-11-15) pinned the
//! layout: the game rebuilds its connected list from the stall table, so a
//! stall the table does not name is never connected. Record `i` of the table
//! is the stall's floor index and logical unit id, then four zero bytes; an
//! empty record is `FF` then five zeros. A stall's tenant record names its
//! table record in bytes 6 and 7, low byte first. The connected list holds
//! table record indexes, ascending, count first. Header bytes 36 and 37 hold
//! the x of the ramp on B1 (the parking column), or `FFFF` with none.

use super::byte_writer::ByteWriter;

/// Stall and ramp type ids in a tenant record (negative while built).
const STALL_TYPE: i64 = 11;
const RAMP_TYPE: i64 = 44;
/// The TDT floor index of B1, the floor whose ramp starts the column.
const B1_FLOOR_INDEX: usize = 9;
/// The header word holding the column's x.
pub const TDT_HEADER_PARKING_COLUMN_AT: usize = 0x24;
/// The header word's value with no ramp on B1.
const NO_PARKING_COLUMN: i64 = 0xffff;
/// Where the stall table starts in the routing tail written after the
/// stairs table.
pub const STALL_TABLE_IN_ROUTING_TAIL: usize = 4_012;
/// The stall table's records, and so the most stalls a file can name.
pub const TDT_STALL_SLOTS: usize = 512;
const STALL_RECORD_SIZE: usize = 6;
/// The floor byte of an empty stall record.
const EMPTY_STALL_RECORD: u8 = 0xff;
/// Where a stall's tenant record holds its table record index.
const TABLE_INDEX_IN_TENANT_RECORD: usize = 6;

/// One tenant on a floor as the encoder orders them: its clamped left and
/// right tiles and its type id.
pub type TenantSpan = (f64, f64, i64);

fn is_stall(type_id: i64) -> bool {
    type_id.abs() == STALL_TYPE
}

fn is_ramp(type_id: i64) -> bool {
    type_id.abs() == RAMP_TYPE
}

/// For each of a floor's tenants, in order of their left tile, whether it is
/// a stall chained to a ramp on its own floor: each piece touches the next,
/// outward from a ramp, in both directions.
pub fn linked_to_a_ramp(spans: &[TenantSpan]) -> Vec<bool> {
    let parking: Vec<usize> = (0..spans.len())
        .filter(|&i| is_stall(spans[i].2) || is_ramp(spans[i].2))
        .collect();
    let mut linked = vec![false; spans.len()];
    for &i in &parking {
        linked[i] = is_ramp(spans[i].2);
    }
    let touches = |a: usize, b: usize| spans[a].1 >= spans[b].0;
    for pair in parking.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        if !linked[b] && linked[a] && touches(a, b) {
            linked[b] = true;
        }
    }
    for pair in parking.windows(2).rev() {
        let (a, b) = (pair[0], pair[1]);
        if !linked[a] && linked[b] && touches(a, b) {
            linked[a] = true;
        }
    }
    for &i in &parking {
        linked[i] &= is_stall(spans[i].2);
    }
    linked
}

/// A stall as the encoder placed it, in the order it wrote them.
struct PlacedStall {
    floor: usize,
    id: usize,
    record_at: usize,
    connected: bool,
}

/// The stalls and the column the encoder met while writing the floors.
#[derive(Default)]
pub struct ParkingExport {
    stalls: Vec<PlacedStall>,
    column: Option<f64>,
}

impl ParkingExport {
    /// Note a tenant the encoder just wrote at `record_at` on TDT floor
    /// `floor`. A stall without a logical id stays out of the table.
    pub fn place(
        &mut self,
        floor: usize,
        span: TenantSpan,
        id: Option<usize>,
        record_at: usize,
        connected: bool,
    ) {
        let (left, _, type_id) = span;
        if is_ramp(type_id) && floor == B1_FLOOR_INDEX {
            // With two ramps on B1 the game names the rightmost.
            self.column = Some(self.column.map_or(left, |x| x.max(left)));
        }
        let Some(id) = id.filter(|_| is_stall(type_id)) else {
            return;
        };
        self.stalls.push(PlacedStall {
            floor,
            id,
            record_at,
            connected,
        });
    }

    /// The stalls the table holds, by record: the connected ones first, so
    /// a tower with more stalls than records keeps every connected stall it
    /// can (#307), then the rest, each group in the order written.
    fn table(&self) -> Vec<&PlacedStall> {
        let (connected, loose): (Vec<&PlacedStall>, Vec<&PlacedStall>) =
            self.stalls.iter().partition(|s| s.connected);
        connected
            .into_iter()
            .chain(loose)
            .take(TDT_STALL_SLOTS)
            .collect()
    }

    /// Header bytes 36 and 37: the column's x, or `FFFF` with no B1 ramp.
    pub fn header_column(&self) -> i64 {
        self.column.map_or(NO_PARKING_COLUMN, |x| x as i64)
    }

    /// The parking block: the connected stalls' table indexes, count first.
    /// The connected stalls lead the table, so the list is its first
    /// records in order.
    pub fn write_connected_list(&self, w: &mut ByteWriter) {
        let connected = self.table().iter().filter(|s| s.connected).count();
        w.u16(connected as i64);
        for slot in 0..TDT_STALL_SLOTS {
            w.u16(if slot < connected { slot as i64 } else { 0 });
        }
    }

    /// Fill the stall table of the routing tail starting at `tail_at`, and
    /// point each stall's tenant record at its record. A stall past the
    /// table's last record keeps the 0 the encoder wrote.
    pub fn write_stall_table(&self, w: &mut ByteWriter, tail_at: usize) {
        let table_at = tail_at + STALL_TABLE_IN_ROUTING_TAIL;
        let table = self.table();
        for slot in 0..TDT_STALL_SLOTS {
            let at = table_at + slot * STALL_RECORD_SIZE;
            let record: [u8; STALL_RECORD_SIZE] = match table.get(slot) {
                Some(s) => [s.floor as u8, s.id as u8, 0, 0, 0, 0],
                None => [EMPTY_STALL_RECORD, 0, 0, 0, 0, 0],
            };
            for (k, byte) in record.into_iter().enumerate() {
                w.set_u8(at + k, byte as i64);
            }
        }
        for (i, s) in table.iter().enumerate() {
            w.set_u16(s.record_at + TABLE_INDEX_IN_TENANT_RECORD, i as i64);
        }
    }
}

#[cfg(test)]
#[path = "export_parking_tests.rs"]
mod tests;

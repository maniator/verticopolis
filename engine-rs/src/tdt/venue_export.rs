//! The exporter's side of the party hall and theatre table (#1932): each
//! floor's logical unit ids and index map, the table's records, and the
//! table row each venue's tenant records name in their byte 6.
//!
//! Runs of the original pin what a venue record names (`venues.rs` has the
//! table's layout): its halves by floor and logical unit id, the id that
//! counts the floor's tenants and skips its plain floor tiles. Each half's
//! tenant record names, in its byte 6, the table row that holds the venue.

use super::byte_writer::ByteWriter;
use super::format::{
    TDT_FLOOR_INDEX_ENTRIES, TDT_PERSON_RECORD_SIZE, TDT_ROUTING_TAIL_SIZE, TDT_STAIR_RECORD_SIZE,
    TDT_STAIR_SLOTS,
};
use super::venues::{
    OutVenueHalf, EMPTY_RECORD, NO_FILM, TDT_VENUE_RECORD_SIZE, TDT_VENUE_SLOTS,
    TDT_VENUE_TABLE_FROM_STAIRS,
};

/// Where the table starts inside the routing tail the exporter writes after
/// the stairs table.
const TABLE_IN_ROUTING_TAIL: usize =
    TDT_VENUE_TABLE_FROM_STAIRS - TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE;
/// The film number the exporter writes for a theatre showing a new film: the
/// second new film, Dino Wars.
const EXPORTED_FILM: u8 = 7;
/// The film number the exporter writes for a theatre showing a classic: Big
/// Wave, the one classic a run of the original pinned.
const EXPORTED_CLASSIC_FILM: u8 = 3;
/// A theatre's audience per half for each step of its draw, as the original
/// resets bytes 4 and 5 at night.
const THEATRE_HALF_PER_DRAW: i64 = 20;
/// A hall's audience bytes as the original resets them at night.
const HALL_AUDIENCE_BYTES: [u8; 2] = [0, 50];

/// A half as the encoder placed it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlacedHalf {
    pub half: OutVenueHalf,
    /// Its TDT floor index.
    pub floor: usize,
    /// Its logical unit id on that floor, which the floor's index map turns
    /// into its record.
    pub id: usize,
    /// Where its tenant record starts in the file, so its byte 6 can name
    /// its table row once the table is laid out.
    pub record_at: usize,
}

impl PlacedHalf {
    /// The half on TDT floor `floor` with logical unit id `id`, whose tenant
    /// record starts at `record_at`.
    pub fn new(half: OutVenueHalf, floor: usize, id: usize, record_at: usize) -> Self {
        PlacedHalf {
            half,
            floor,
            id,
            record_at,
        }
    }
}

/// Byte 6 of a hall's or theatre's tenant record: the row of the venue
/// table that holds the venue, as runs of the original write it.
const TABLE_ROW_IN_TENANT_RECORD: usize = 6;

/// The tenant type of a plain floor tile.
pub const PLAIN_FLOOR_TYPE: i64 = 0;
/// Byte 12 of a record that has no logical unit id: a plain floor tile.
pub const NO_LOGICAL_ID: u8 = 0xFF;

/// Each record's logical unit id on one floor, in record order (#1932). The
/// original numbers its tenants and gives a plain floor tile none (`FF` in
/// the record's byte 12, and no entry in the index map), so a venue record
/// or a retail row names a tenant by that id. A tenant past the map's 94
/// ids gets none.
pub fn logical_ids(type_ids: &[i64]) -> Vec<Option<usize>> {
    let mut next = 0;
    type_ids
        .iter()
        .map(|&type_id| {
            let numbered = type_id != PLAIN_FLOOR_TYPE && next < TDT_FLOOR_INDEX_ENTRIES;
            numbered.then(|| {
                next += 1;
                next - 1
            })
        })
        .collect()
}

/// Bytes 7 to 14 of a tenant record as the exporter writes them: zero but
/// for the logical unit id in byte 12 ([`NO_LOGICAL_ID`] for none).
pub fn middle_bytes(id: Option<usize>) -> [u8; 8] {
    let mut bytes = [0u8; 8];
    bytes[LOGICAL_ID_IN_MIDDLE] = id.map_or(NO_LOGICAL_ID, |id| id as u8);
    bytes
}

/// Where byte 12 of a tenant record sits in [`middle_bytes`].
const LOGICAL_ID_IN_MIDDLE: usize = 12 - 7;

/// A floor's index map as the exporter writes it: logical unit id `n` names
/// the record [`logical_ids`] gave it, and the ids past the floor's tenants
/// are 0, as the game leaves them.
pub fn index_map(ids: &[Option<usize>]) -> Vec<u8> {
    let mut map = [0u16; TDT_FLOOR_INDEX_ENTRIES];
    for (record, id) in ids.iter().enumerate() {
        if let Some(id) = *id {
            map[id] = record as u16;
        }
    }
    map.iter().flat_map(|entry| entry.to_le_bytes()).collect()
}

/// One record of the venue table, with the places in `placed` of the lower
/// and upper half it names.
type TableRow = ([u8; TDT_VENUE_RECORD_SIZE], [usize; 2]);

/// The venue table's rows in order: the halls and theatres that have both
/// halves placed, theatres first and each kind in the order its lower
/// halves were placed, up to the table's 16 records.
fn table_rows(placed: &[PlacedHalf]) -> Vec<TableRow> {
    let mut table = vec![];
    for (lower_at, lower) in placed.iter().enumerate().filter(|(_, p)| !p.half.upper) {
        let half = lower.half;
        let upper_at = placed
            .iter()
            .position(|p| p.half.upper && p.half.room == half.room && p.floor == lower.floor + 1);
        let Some(upper_at) = upper_at else {
            continue;
        };
        let upper = placed[upper_at];
        // A half past the index map's 94 ids has no logical id to name, and
        // one bad record would make the reader drop the whole table.
        if lower.id >= TDT_FLOOR_INDEX_ENTRIES || upper.id >= TDT_FLOOR_INDEX_ENTRIES {
            continue;
        }
        let mut record = [0u8; TDT_VENUE_RECORD_SIZE];
        record[0] = upper.floor as u8;
        record[1] = lower.floor as u8;
        record[2] = upper.id as u8;
        record[3] = lower.id as u8;
        match half.film_days {
            Some(days) => {
                let left = (THEATRE_HALF_PER_DRAW * (half.draw() + 1)) as u8;
                record[4] = left;
                record[5] = left;
                record[7] = if half.film_classic {
                    EXPORTED_CLASSIC_FILM
                } else {
                    EXPORTED_FILM
                };
                record[9] = days.clamp(0, i64::from(u8::MAX)) as u8;
            }
            None => {
                record[4..6].copy_from_slice(&HALL_AUDIENCE_BYTES);
                record[7] = NO_FILM;
            }
        }
        table.push((record, [lower_at, upper_at]));
    }
    // Past 16 venues, theatres keep their records first: a hall's record
    // carries nothing the importer reads.
    table.sort_by_key(|(record, _)| record[7] == NO_FILM);
    table.truncate(TDT_VENUE_SLOTS);
    table
}

/// The routing tail after the stairs table, `FF` but for the venue table
/// ([`table_rows`]).
pub fn write_routing_tail(placed: &[PlacedHalf]) -> Vec<u8> {
    let mut tail = vec![0xff; TDT_ROUTING_TAIL_SIZE];
    let table = table_rows(placed);
    for slot in 0..TDT_VENUE_SLOTS {
        let at = TABLE_IN_ROUTING_TAIL + slot * TDT_VENUE_RECORD_SIZE;
        let mut empty = [0u8; TDT_VENUE_RECORD_SIZE];
        empty[..2].copy_from_slice(&[EMPTY_RECORD; 2]);
        let record = table.get(slot).map_or(&empty, |(record, _)| record);
        tail[at..at + TDT_VENUE_RECORD_SIZE].copy_from_slice(record);
    }
    tail
}

/// Write the routing tail after the stairs table, first giving each venue's
/// tenant records, already written, the table row that holds it. A venue
/// left out of the table keeps the 0 the encoder wrote.
pub fn write_venue_tail(w: &mut ByteWriter, placed: &[PlacedHalf]) {
    for (row, (_, halves)) in table_rows(placed).iter().enumerate() {
        for &at in halves {
            w.set_u8(
                placed[at].record_at + TABLE_ROW_IN_TENANT_RECORD,
                row as i64,
            );
        }
    }
    w.bytes(&write_routing_tail(placed));
}

/// The people the original keeps for each half of a party hall: 40 records
/// in a row in the people block, which the half's tenant record names by
/// its first index in bytes 8 and 9 (#1932). A hall without them crashes the
/// original a few seconds after the file loads.
pub const HALL_PEOPLE_PER_HALF: usize = 40;
/// The unit type the original writes in both halves' people records: the
/// hall's upper part.
const HALL_PERSON_TYPE: u8 = 29;
/// Bytes 8 and 9 of a tenant record: its first person in the people block.
const FIRST_PERSON_IN_TENANT_RECORD: usize = 8;

/// Write the people block: its count, the census's `census` blank records,
/// then each party hall half's 40 people (floor, logical unit id, person
/// number and type, the rest 0, which a run of the original loads and plays
/// on), first giving each half's tenant record, already written, the index
/// of its first person.
pub fn write_people(w: &mut ByteWriter, census: usize, placed: &[PlacedHalf]) {
    let halls: Vec<&PlacedHalf> = placed
        .iter()
        .filter(|p| p.half.film_days.is_none())
        .collect();
    for (n, hall) in halls.iter().enumerate() {
        let first = census + n * HALL_PEOPLE_PER_HALF;
        w.set_u16(hall.record_at + FIRST_PERSON_IN_TENANT_RECORD, first as i64);
    }
    w.i32((census + halls.len() * HALL_PEOPLE_PER_HALF) as i64);
    w.pad(census * TDT_PERSON_RECORD_SIZE);
    for hall in halls {
        for person in 0..HALL_PEOPLE_PER_HALF {
            let mut record = [0u8; TDT_PERSON_RECORD_SIZE];
            record[0] = hall.floor as u8;
            record[1] = hall.id as u8;
            record[2] = person as u8;
            record[4] = HALL_PERSON_TYPE;
            w.bytes(&record);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tdt::types::TdtVenue;
    use crate::tdt::venues::read_venue_table;

    /// Halves placed at `(half, floor, id)`, each record at 0.
    fn placed_at(halves: &[(OutVenueHalf, usize, usize)]) -> Vec<PlacedHalf> {
        halves
            .iter()
            .map(|&(half, floor, id)| PlacedHalf::new(half, floor, id, 0))
            .collect()
    }

    #[test]
    fn a_written_table_reads_back_with_its_floors_slots_film_and_days() {
        let theatre = |upper, film_days| OutVenueHalf {
            room: 3,
            upper,
            film_days,
            film_classic: false,
        };
        let hall = |upper| OutVenueHalf {
            room: 5,
            upper,
            film_days: None,
            film_classic: false,
        };
        let theatre_far = |upper| OutVenueHalf {
            room: 7,
            upper,
            film_days: Some(2),
            film_classic: false,
        };
        // A lone half (a room cut at the roof) writes no record.
        let stray = OutVenueHalf {
            room: 9,
            upper: false,
            film_days: Some(1),
            film_classic: false,
        };
        let placed = placed_at(&[
            (hall(false), 20, 6),
            (theatre(false, Some(7)), 20, 4),
            (stray, 30, 0),
            // A theatre whose lower half sits past the index map writes none.
            (theatre_far(false), 40, TDT_FLOOR_INDEX_ENTRIES),
            (theatre_far(true), 41, 0),
            (theatre(true, Some(7)), 21, 2),
            (hall(true), 21, 5),
        ]);
        let mut raw = vec![0; TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE];
        raw.extend(write_routing_tail(&placed));
        let read = read_venue_table(&raw, 0);
        assert_eq!(
            read,
            [
                TdtVenue {
                    upper_floor: 21,
                    lower_floor: 20,
                    upper_slot: 2,
                    lower_slot: 4,
                    film: Some(EXPORTED_FILM),
                    days_shown: 7,
                },
                TdtVenue {
                    upper_floor: 21,
                    lower_floor: 20,
                    upper_slot: 5,
                    lower_slot: 6,
                    film: None,
                    days_shown: 0,
                },
            ]
        );
        let at = TDT_VENUE_TABLE_FROM_STAIRS;
        // A seven-day-old film showed draw 1 last night: 40 per half.
        assert_eq!(&raw[at + 4..at + 6], &[40, 40]);
        assert_eq!(&raw[at + 16..at + 18], &HALL_AUDIENCE_BYTES);
        assert_eq!(&raw[at + 24..at + 26], &[EMPTY_RECORD; 2]);
        assert_eq!(
            raw.len(),
            TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE + TDT_ROUTING_TAIL_SIZE
        );
        assert_eq!(raw[raw.len() - 1], 0xff);
    }

    /// A floor of a plain tile, a hall, a plain tile and a theatre, as a
    /// run of the original numbers it (#1932): the tiles get no id, and the
    /// map lists the tenants alone.
    #[test]
    fn plain_floor_tiles_get_no_logical_id_and_the_map_lists_tenants_alone() {
        let ids = logical_ids(&[PLAIN_FLOOR_TYPE, 30, PLAIN_FLOOR_TYPE, 19]);
        assert_eq!(ids, vec![None, Some(0), None, Some(1)]);
        let map = index_map(&ids);
        assert_eq!(map.len(), TDT_FLOOR_INDEX_ENTRIES * 2);
        assert_eq!(&map[..4], &[1, 0, 3, 0]);
        assert!(map[4..].iter().all(|&b| b == 0));
    }

    #[test]
    fn a_classic_writes_and_reads_back_as_a_classic() {
        let half = |upper| OutVenueHalf {
            room: 3,
            upper,
            film_days: Some(2),
            film_classic: true,
        };
        let placed = placed_at(&[(half(false), 20, 4), (half(true), 21, 2)]);
        let mut raw = vec![0; TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE];
        raw.extend(write_routing_tail(&placed));
        let read = read_venue_table(&raw, 0);
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].film, Some(EXPORTED_CLASSIC_FILM));
        assert!(read[0].shows_classic());
        let at = TDT_VENUE_TABLE_FROM_STAIRS;
        assert_eq!(&raw[at + 4..at + 6], &[40, 40], "a classic's draw 1");
    }

    /// Each half's tenant record names its table row in byte 6 (#1932):
    /// the theatre takes row 0 and the hall row 1, though the hall was
    /// placed first, and a half with no partner keeps what the encoder wrote.
    #[test]
    fn each_venue_half_names_its_table_row() {
        const RECORD: usize = 18;
        let half = |room, upper, film_days| OutVenueHalf {
            room,
            upper,
            film_days,
            film_classic: false,
        };
        let halves = [
            (half(5, false, None), 20, 0),
            (half(3, false, Some(2)), 20, 1),
            (half(5, true, None), 21, 0),
            (half(3, true, Some(2)), 21, 1),
            (half(9, false, Some(2)), 30, 0),
        ];
        let placed: Vec<PlacedHalf> = halves
            .iter()
            .enumerate()
            .map(|(i, &(half, floor, id))| PlacedHalf::new(half, floor, id, i * RECORD))
            .collect();
        let mut w = ByteWriter::new();
        w.bytes(&[0xAA; 5 * RECORD]);
        write_venue_tail(&mut w, &placed);
        let bytes = w.to_bytes();
        let rows: Vec<u8> = (0..5)
            .map(|i| bytes[i * RECORD + TABLE_ROW_IN_TENANT_RECORD])
            .collect();
        assert_eq!(rows, [1, 0, 1, 0, 0xAA]);
        assert_eq!(&bytes[5 * RECORD..], &write_routing_tail(&placed)[..]);
    }

    /// Each hall half gets 40 people after the census's blank records, and
    /// its tenant record names the first (#1932); a theatre gets none.
    #[test]
    fn each_hall_half_gets_forty_people_after_the_census() {
        const RECORD: usize = 18;
        let half = |room, upper, film_days| OutVenueHalf {
            room,
            upper,
            film_days,
            film_classic: false,
        };
        let placed = [
            PlacedHalf::new(half(3, false, Some(2)), 11, 0, 0),
            PlacedHalf::new(half(5, false, None), 11, 1, RECORD),
            PlacedHalf::new(half(5, true, None), 12, 1, 2 * RECORD),
        ];
        let mut w = ByteWriter::new();
        w.pad(3 * RECORD);
        let census = 7;
        write_people(&mut w, census, &placed);
        let bytes = w.to_bytes();
        let first = |record: usize| {
            let at = record * RECORD + FIRST_PERSON_IN_TENANT_RECORD;
            u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize
        };
        assert_eq!([first(0), first(1), first(2)], [0, 7, 47]);
        let block = &bytes[3 * RECORD..];
        assert_eq!(&block[..4], &87u32.to_le_bytes());
        let person = |n: usize| &block[4 + n * TDT_PERSON_RECORD_SIZE..][..TDT_PERSON_RECORD_SIZE];
        assert!(
            person(6).iter().all(|&b| b == 0),
            "a census record is blank"
        );
        assert_eq!(&person(7)[..5], &[11, 1, 0, 0, HALL_PERSON_TYPE]);
        assert_eq!(&person(46)[..5], &[11, 1, 39, 0, HALL_PERSON_TYPE]);
        assert_eq!(&person(47)[..5], &[12, 1, 0, 0, HALL_PERSON_TYPE]);
        assert!(person(86)[5..].iter().all(|&b| b == 0));
        assert_eq!(block.len(), 4 + 87 * TDT_PERSON_RECORD_SIZE);
    }
}

//! The party hall and theatre table (#1932): sixteen 12-byte records in the
//! tail, 7,220 bytes after the end of the stairs table, one per hall or
//! theatre the tower holds, `FE FE` when empty. Runs of the original pin the
//! bytes this reads:
//!
//! | Byte | Meaning |
//! | --- | --- |
//! | 0, 1 | Floor records of the venue's upper and lower half |
//! | 2, 3 | The venue's logical unit id on each floor |
//! | 4, 5 | Audience left for the day, per half |
//! | 7 | Film number, `FF` for a hall |
//! | 9 | Days the film has shown (a hall counts days since it opened) |
//!
//! A misfit never fails the import: a table that does not read as one is
//! left out, and the theatres then start their films fresh.
//!
//! The exporter writes the table back (`write_routing_tail`) so a film's age
//! survives a trip through a `.TDT`. It writes the audience bytes as the
//! original leaves them each night (a theatre 20 per half for each step of
//! its draw, a hall 0 and 50), film 7 for every theatre (the engine does not
//! keep which film a theatre shows) and 0 days for a hall.

use super::format::{
    TDT_FLOOR_COUNT, TDT_FLOOR_INDEX_ENTRIES, TDT_ROUTING_TAIL_SIZE, TDT_STAIR_RECORD_SIZE,
    TDT_STAIR_SLOTS,
};
use super::types::TdtVenue;
use crate::economy::visitors::film_draw;

/// Where the table starts, counted from the start of the stairs table.
pub const TDT_VENUE_TABLE_FROM_STAIRS: usize = TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE + 7_220;
/// Records in the table.
pub const TDT_VENUE_SLOTS: usize = 16;
/// Bytes in one record.
pub const TDT_VENUE_RECORD_SIZE: usize = 12;
/// The first byte of an empty record.
const EMPTY_RECORD: u8 = 0xFE;
/// The film byte of a party hall's record.
const NO_FILM: u8 = 0xFF;
/// Where the table starts inside the routing tail the exporter writes after
/// the stairs table.
const TABLE_IN_ROUTING_TAIL: usize =
    TDT_VENUE_TABLE_FROM_STAIRS - TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE;
/// The film number the exporter writes for a theatre: the first new film.
const EXPORTED_FILM: u8 = 7;
/// A theatre's audience per half for each step of its draw, as the original
/// resets bytes 4 and 5 at night.
const THEATRE_HALF_PER_DRAW: i64 = 20;
/// A hall's audience bytes as the original resets them at night.
const HALL_AUDIENCE_BYTES: [u8; 2] = [0, 50];

/// One half of a party hall or theatre as the exporter gathers it: the
/// room's place in the save's room list, whether this is its upper half, and
/// a theatre's film age (`None` for a hall).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OutVenueHalf {
    pub room: usize,
    pub upper: bool,
    pub film_days: Option<i64>,
}

impl OutVenueHalf {
    /// Byte 15 of the half's tenant record: the draw the film had last
    /// night, the age before this morning's step (a theatre that has not
    /// seen a morning shows a new film's draw). A hall writes 0.
    pub fn draw(&self) -> i64 {
        self.film_days
            .map_or(0, |days| film_draw((days - 1).max(0)))
    }
}

/// A half as the encoder placed it: its TDT floor index and its tenant's
/// position on that floor, which the floor's index map gives as its logical
/// unit id.
pub type PlacedHalf = (OutVenueHalf, usize, usize);

/// A floor's index map as the exporter writes it: logical unit id `n` is the
/// floor's `n`th tenant record, and the ids past its records are 0, as the
/// game leaves them.
pub fn index_map(tenants: usize) -> Vec<u8> {
    (0..TDT_FLOOR_INDEX_ENTRIES)
        .flat_map(|id| (if id < tenants { id as u16 } else { 0 }).to_le_bytes())
        .collect()
}

/// The routing tail after the stairs table, `FF` but for the venue table
/// holding the halls and theatres that have both halves placed, theatres
/// first and each kind in the order its lower halves were placed, up to the
/// table's 16 records.
pub fn write_routing_tail(placed: &[PlacedHalf]) -> Vec<u8> {
    let mut tail = vec![0xff; TDT_ROUTING_TAIL_SIZE];
    let mut table = vec![];
    for &(half, floor, slot) in placed.iter().filter(|p| !p.0.upper) {
        let upper = placed
            .iter()
            .find(|p| p.0.upper && p.0.room == half.room && p.1 == floor + 1);
        let Some(&(_, upper_floor, upper_slot)) = upper else {
            continue;
        };
        let mut record = [0u8; TDT_VENUE_RECORD_SIZE];
        record[0] = upper_floor as u8;
        record[1] = floor as u8;
        record[2] = upper_slot as u8;
        record[3] = slot as u8;
        match half.film_days {
            Some(days) => {
                let left = (THEATRE_HALF_PER_DRAW * (half.draw() + 1)) as u8;
                record[4] = left;
                record[5] = left;
                record[7] = EXPORTED_FILM;
                record[9] = days.clamp(0, i64::from(u8::MAX)) as u8;
            }
            None => {
                record[4..6].copy_from_slice(&HALL_AUDIENCE_BYTES);
                record[7] = NO_FILM;
            }
        }
        table.push(record);
    }
    // Past 16 venues, theatres keep their records first: a hall's record
    // carries nothing the importer reads.
    table.sort_by_key(|record| record[7] == NO_FILM);
    for slot in 0..TDT_VENUE_SLOTS {
        let at = TABLE_IN_ROUTING_TAIL + slot * TDT_VENUE_RECORD_SIZE;
        let mut empty = [0u8; TDT_VENUE_RECORD_SIZE];
        empty[..2].copy_from_slice(&[EMPTY_RECORD; 2]);
        let record = table.get(slot).unwrap_or(&empty);
        tail[at..at + TDT_VENUE_RECORD_SIZE].copy_from_slice(record);
    }
    tail
}

/// The filled records of the table that goes with a stairs table starting at
/// `stairs_at`, or none when the bytes there do not read as the table.
pub fn read_venue_table(raw: &[u8], stairs_at: usize) -> Vec<TdtVenue> {
    let at = stairs_at + TDT_VENUE_TABLE_FROM_STAIRS;
    let Some(table) = raw.get(at..at + TDT_VENUE_SLOTS * TDT_VENUE_RECORD_SIZE) else {
        return vec![];
    };
    let mut venues = vec![];
    for record in table.chunks_exact(TDT_VENUE_RECORD_SIZE) {
        if record[0] == EMPTY_RECORD {
            continue;
        }
        match read_record(record) {
            Some(venue) => venues.push(venue),
            None => return vec![],
        }
    }
    venues
}

/// One filled record, or `None` when it is not a venue spanning two floors.
fn read_record(record: &[u8]) -> Option<TdtVenue> {
    let upper_floor = i64::from(record[0]);
    let lower_floor = i64::from(record[1]);
    let floor_ok = |f: i64| (0..TDT_FLOOR_COUNT).contains(&f);
    let slot_ok = |s: u8| usize::from(s) < TDT_FLOOR_INDEX_ENTRIES;
    let fits = floor_ok(upper_floor)
        && upper_floor == lower_floor + 1
        && slot_ok(record[2])
        && slot_ok(record[3]);
    fits.then(|| TdtVenue {
        upper_floor,
        lower_floor,
        upper_slot: record[2],
        lower_slot: record[3],
        film: (record[7] != NO_FILM).then_some(record[7]),
        days_shown: record[9],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A table of empty records with `filled` written from its first slot.
    fn table_with(filled: &[[u8; TDT_VENUE_RECORD_SIZE]]) -> Vec<u8> {
        let mut raw = vec![0; TDT_VENUE_TABLE_FROM_STAIRS];
        for slot in 0..TDT_VENUE_SLOTS {
            let mut record = [0u8; TDT_VENUE_RECORD_SIZE];
            record[0] = EMPTY_RECORD;
            record[1] = EMPTY_RECORD;
            raw.extend(filled.get(slot).unwrap_or(&record));
        }
        raw
    }

    const HALL: [u8; 12] = [0x0e, 0x0d, 9, 9, 0, 50, 0, 0xff, 0, 7, 0, 0];
    const THEATRE: [u8; 12] = [0x10, 0x0f, 9, 9, 40, 40, 0, 8, 0, 7, 0, 0];

    #[test]
    fn a_hall_and_a_theatre_read_with_their_floors_film_and_days() {
        let venues = read_venue_table(&table_with(&[HALL, THEATRE]), 0);
        assert_eq!(
            venues,
            [
                TdtVenue {
                    upper_floor: 14,
                    lower_floor: 13,
                    upper_slot: 9,
                    lower_slot: 9,
                    film: None,
                    days_shown: 7,
                },
                TdtVenue {
                    upper_floor: 16,
                    lower_floor: 15,
                    upper_slot: 9,
                    lower_slot: 9,
                    film: Some(8),
                    days_shown: 7,
                },
            ]
        );
    }

    #[test]
    fn a_table_with_a_record_that_is_not_a_venue_reads_as_none() {
        let mut stray = THEATRE;
        stray[1] = 0x0c; // the halves are not on neighboring floors
        assert_eq!(read_venue_table(&table_with(&[HALL, stray]), 0), []);
        // Our older exports fill the tail with FF.
        let ff = vec![0xff; TDT_VENUE_TABLE_FROM_STAIRS + TDT_VENUE_SLOTS * TDT_VENUE_RECORD_SIZE];
        assert_eq!(read_venue_table(&ff, 0), []);
    }

    #[test]
    fn a_written_table_reads_back_with_its_floors_slots_film_and_days() {
        let theatre = |upper, film_days| OutVenueHalf {
            room: 3,
            upper,
            film_days,
        };
        let hall = |upper| OutVenueHalf {
            room: 5,
            upper,
            film_days: None,
        };
        // A lone half (a room cut at the roof) writes no record.
        let stray = OutVenueHalf {
            room: 9,
            upper: false,
            film_days: Some(1),
        };
        let placed = [
            (hall(false), 20, 6),
            (theatre(false, Some(7)), 20, 4),
            (stray, 30, 0),
            (theatre(true, Some(7)), 21, 2),
            (hall(true), 21, 5),
        ];
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

    #[test]
    fn an_index_map_names_each_record_by_its_place_on_the_floor() {
        let map = index_map(3);
        assert_eq!(map.len(), TDT_FLOOR_INDEX_ENTRIES * 2);
        assert_eq!(&map[..8], &[0, 0, 1, 0, 2, 0, 0, 0]);
        assert!(map[6..].iter().all(|&b| b == 0));
    }

    #[test]
    fn a_theatre_writes_the_draw_its_film_had_last_night() {
        let draws: Vec<i64> = [None, Some(0), Some(1), Some(6), Some(7), Some(9), Some(10)]
            .into_iter()
            .map(|film_days| {
                OutVenueHalf {
                    room: 0,
                    upper: false,
                    film_days,
                }
                .draw()
            })
            .collect();
        assert_eq!(draws, [0, 2, 2, 2, 1, 1, 0]);
    }

    #[test]
    fn a_file_that_ends_before_the_table_reads_as_none() {
        let raw = table_with(&[THEATRE]);
        assert_eq!(read_venue_table(&raw[..raw.len() - 1], 0), []);
    }
}

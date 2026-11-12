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
//! | 7 | Film number, `FF` for a hall: a classic below 6, a new film from 6 |
//! | 9 | Days the film has shown (a hall counts days since it opened) |
//!
//! A misfit never fails the import: a table that does not read as one is
//! left out, and the theatres then start their films fresh.
//!
//! The exporter writes the table back (`venue_export.rs`) so a film's age
//! survives a trip through a `.TDT`. It writes the audience bytes as the
//! original leaves them each night (a theatre 20 per half for each step of
//! its draw, a hall 0 and 50), film 7 for a theatre showing a new film and 3
//! for a classic (the engine keeps whether a film is a classic, not which
//! title it is) and 0 days for a hall.
//!
//! Film numbers: runs of the original showed The Making of a Star as 8, Love
//! in N.Y. as 9, Waikiki Moon as 10 and My Man of War as 11, the third to
//! sixth of the seven new films in the game's order, so the new films are 6
//! to 12. The one classic seen, Big Wave, the first classic, was 3. A film
//! below 6 reads as a classic; the classics' other numbers are not pinned.

use super::format::{
    TDT_FLOOR_COUNT, TDT_FLOOR_INDEX_ENTRIES, TDT_STAIR_RECORD_SIZE, TDT_STAIR_SLOTS,
};
use super::types::TdtVenue;
use crate::economy::visitors::showing_draw;

/// Where the table starts, counted from the start of the stairs table.
pub const TDT_VENUE_TABLE_FROM_STAIRS: usize = TDT_STAIR_SLOTS * TDT_STAIR_RECORD_SIZE + 7_220;
/// Records in the table.
pub const TDT_VENUE_SLOTS: usize = 16;
/// Bytes in one record.
pub const TDT_VENUE_RECORD_SIZE: usize = 12;
/// The first byte of an empty record.
pub(super) const EMPTY_RECORD: u8 = 0xFE;
/// The film byte of a party hall's record.
pub(super) const NO_FILM: u8 = 0xFF;
/// The first new film's number; the classics' numbers sit below it.
const FIRST_NEW_FILM: u8 = 6;

/// One half of a party hall or theatre as the exporter gathers it: the
/// room's place in the save's room list, whether this is its upper half, and
/// a theatre's film age (`None` for a hall) and whether its film is a
/// classic.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OutVenueHalf {
    pub room: usize,
    pub upper: bool,
    pub film_days: Option<i64>,
    pub film_classic: bool,
}

impl OutVenueHalf {
    /// Byte 15 of the half's tenant record: the draw the film had last
    /// night, the age before this morning's step (a theatre that has not
    /// seen a morning shows a new film's draw). A hall writes 0.
    pub fn draw(&self) -> i64 {
        self.film_days
            .map_or(0, |days| showing_draw((days - 1).max(0), self.film_classic))
    }
}

/// Whether film number `film` is a classic: the classics sit below the
/// first new film.
pub fn is_classic_film(film: u8) -> bool {
    film < FIRST_NEW_FILM
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
    fn a_theatre_writes_the_draw_its_film_had_last_night() {
        let draws = |film_classic| -> Vec<i64> {
            [None, Some(0), Some(1), Some(6), Some(7), Some(9), Some(10)]
                .into_iter()
                .map(|film_days| {
                    OutVenueHalf {
                        room: 0,
                        upper: false,
                        film_days,
                        film_classic,
                    }
                    .draw()
                })
                .collect()
        };
        assert_eq!(draws(false), [0, 2, 2, 2, 1, 1, 0]);
        assert_eq!(
            draws(true),
            [0, 1, 1, 1, 1, 1, 0],
            "a classic tops out at 1"
        );
    }

    #[test]
    fn a_film_below_the_first_new_film_is_a_classic() {
        let classics: Vec<u8> = (0..=13).filter(|&f| is_classic_film(f)).collect();
        assert_eq!(classics, [0, 1, 2, 3, 4, 5]);
        let venue = |film| TdtVenue {
            upper_floor: 21,
            lower_floor: 20,
            upper_slot: 0,
            lower_slot: 0,
            film,
            days_shown: 0,
        };
        assert!(venue(Some(3)).shows_classic(), "Big Wave");
        assert!(!venue(Some(9)).shows_classic(), "Love in N.Y.");
        assert!(!venue(None).shows_classic(), "a hall");
    }

    #[test]
    fn a_file_that_ends_before_the_table_reads_as_none() {
        let raw = table_with(&[THEATRE]);
        assert_eq!(read_venue_table(&raw[..raw.len() - 1], 0), []);
    }
}

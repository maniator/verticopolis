//! The people the exporter writes for party halls and theatres, and the
//! split of a theatre floor into the two pieces the original keeps (#1932,
//! #2044): each hall half and theatre screen piece owns a run of records in
//! the people block, which its tenant record names by its first index.

use super::byte_writer::ByteWriter;
use super::export_tables::OutTenant;
use super::format::TDT_PERSON_RECORD_SIZE;
use super::venue_export::PlacedHalf;
use super::venues::OutVenueHalf;

/// The people the original keeps for each half of a party hall: 40 records
/// in a row in the people block, which the half's tenant record names by
/// its first index in bytes 8 and 9 (#1932). A hall without them crashes the
/// original a few seconds after the file loads.
pub const HALL_PEOPLE_PER_HALF: usize = 40;
/// The unit type the original writes in both halves' people records: the
/// hall's upper part.
const HALL_PERSON_TYPE: u8 = 29;
/// The people the original keeps for each screen piece of a theatre (types
/// 35 and 34), named the same way (#2044); its auditorium piece owns none.
pub const SCREEN_PEOPLE_PER_PIECE: usize = 56;
/// The unit type the original writes in a theatre's people records: the
/// auditorium's upper part.
const SCREEN_PERSON_TYPE: u8 = 18;
/// Bytes 8 and 9 of a tenant record: its first person in the people block.
const FIRST_PERSON_IN_TENANT_RECORD: usize = 8;
/// The original sizes its people pool in blocks of this many records.
const PEOPLE_POOL_BLOCK: usize = 256;
/// Free records the exporter leaves past the ones in use, so the player can
/// build after loading. With none, the original crashed placing a theatre
/// in a tower whose pool was full (#2044, PC run 2026-11-13); its own saves
/// round the pool up and keep a few hundred spare.
const PEOPLE_POOL_SPARE: usize = PEOPLE_POOL_BLOCK;

/// The people a venue piece owns and the unit type its records carry, or
/// `None` for a piece that owns none (an auditorium).
fn venue_people(half: &OutVenueHalf) -> Option<(usize, u8)> {
    match (half.auditorium, half.film_days) {
        (true, _) => None,
        (false, None) => Some((HALL_PEOPLE_PER_HALF, HALL_PERSON_TYPE)),
        (false, Some(_)) => Some((SCREEN_PEOPLE_PER_PIECE, SCREEN_PERSON_TYPE)),
    }
}

/// The people pool's size for `used` records: rounded up to the original's
/// block, with at least [`PEOPLE_POOL_SPARE`] free.
pub fn people_pool_size(used: usize) -> usize {
    (used + PEOPLE_POOL_SPARE).div_ceil(PEOPLE_POOL_BLOCK) * PEOPLE_POOL_BLOCK
}

/// Write the people block: its count, the census's `census` blank records,
/// then the people of each hall half and theatre screen piece (floor,
/// logical unit id, person number and type, the rest 0, which a run of the
/// original loads and plays on), then blank records up to
/// [`people_pool_size`]. Each owning piece's tenant record, already
/// written, gets the index of its first person.
pub fn write_people(w: &mut ByteWriter, census: usize, placed: &[PlacedHalf]) {
    let owners: Vec<(&PlacedHalf, usize, u8)> = placed
        .iter()
        .filter_map(|p| venue_people(&p.half).map(|(count, kind)| (p, count, kind)))
        .collect();
    let mut next = census;
    for &(piece, count, _) in &owners {
        w.set_u16(piece.record_at + FIRST_PERSON_IN_TENANT_RECORD, next as i64);
        next += count;
    }
    let pool = people_pool_size(next);
    w.i32(pool as i64);
    w.pad(census * TDT_PERSON_RECORD_SIZE);
    for (piece, count, kind) in owners {
        for person in 0..count {
            let mut record = [0u8; TDT_PERSON_RECORD_SIZE];
            record[0] = piece.floor as u8;
            record[1] = piece.id as u8;
            record[2] = person as u8;
            record[4] = kind;
            w.bytes(&record);
        }
    }
    w.pad((pool - next) * TDT_PERSON_RECORD_SIZE);
}

/// A theatre's width in tiles taken by its screen piece (types 35 and 34),
/// the left part of each floor; the auditorium (19 and 18) fills the rest.
const SCREEN_WIDTH: f64 = 7.0;
/// A theatre's auditorium part types, lower floor then upper.
const AUDITORIUM_PARTS: [i64; 2] = [19, 18];
/// The screen part type that stands beside each auditorium part.
const SCREEN_PARTS: [i64; 2] = [35, 34];

/// The records a gathered tenant writes: a theatre floor (types 19 and 18,
/// built or under construction) as the original writes it, its screen piece
/// on the left and its auditorium beside it (#2044), sharing the film draw
/// and the venue; every other tenant as it is.
pub fn split_theatre(t: OutTenant) -> Vec<OutTenant> {
    let part = AUDITORIUM_PARTS.iter().position(|&p| p == t.type_id.abs());
    let Some(part) = part.filter(|_| t.right - t.left > SCREEN_WIDTH) else {
        return vec![t];
    };
    let screen = OutTenant {
        right: t.left + SCREEN_WIDTH,
        type_id: SCREEN_PARTS[part] * t.type_id.signum(),
        ..t
    };
    let auditorium = OutTenant {
        left: t.left + SCREEN_WIDTH,
        venue: t.venue.map(|v| OutVenueHalf {
            auditorium: true,
            ..v
        }),
        ..t
    };
    vec![screen, auditorium]
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECORD: usize = 18;

    fn half(room: usize, upper: bool, film_days: Option<i64>, auditorium: bool) -> OutVenueHalf {
        OutVenueHalf {
            room,
            upper,
            film_days,
            film_classic: false,
            auditorium,
        }
    }

    /// After the census's blank records, each theatre screen piece gets 56
    /// people and each hall half 40, its tenant record naming the first; an
    /// auditorium gets none and its record is left alone (#1932, #2044).
    #[test]
    fn screen_pieces_and_hall_halves_get_their_people_after_the_census() {
        let placed = [
            PlacedHalf::new(half(3, false, Some(2), false), 11, 0, 0),
            PlacedHalf::new(half(3, false, Some(2), true), 11, 1, RECORD),
            PlacedHalf::new(half(5, false, None, false), 11, 2, 2 * RECORD),
            PlacedHalf::new(half(5, true, None, false), 12, 1, 3 * RECORD),
        ];
        let mut w = ByteWriter::new();
        w.bytes(&[0xAA; 4 * RECORD]);
        let census = 7;
        write_people(&mut w, census, &placed);
        let bytes = w.to_bytes();
        let first = |record: usize| {
            let at = record * RECORD + FIRST_PERSON_IN_TENANT_RECORD;
            u16::from_le_bytes([bytes[at], bytes[at + 1]]) as usize
        };
        assert_eq!([first(0), first(2), first(3)], [7, 63, 103]);
        assert_eq!(first(1), 0xAAAA, "an auditorium owns no people");
        let used = 143;
        let pool = people_pool_size(used);
        let block = &bytes[4 * RECORD..];
        assert_eq!(&block[..4], &(pool as u32).to_le_bytes());
        assert_eq!(block.len(), 4 + pool * TDT_PERSON_RECORD_SIZE);
        let person = |n: usize| &block[4 + n * TDT_PERSON_RECORD_SIZE..][..TDT_PERSON_RECORD_SIZE];
        assert!(
            person(6).iter().all(|&b| b == 0),
            "a census record is blank"
        );
        assert_eq!(&person(7)[..5], &[11, 0, 0, 0, SCREEN_PERSON_TYPE]);
        assert_eq!(&person(62)[..5], &[11, 0, 55, 0, SCREEN_PERSON_TYPE]);
        assert_eq!(&person(63)[..5], &[11, 2, 0, 0, HALL_PERSON_TYPE]);
        assert_eq!(&person(102)[..5], &[11, 2, 39, 0, HALL_PERSON_TYPE]);
        assert_eq!(&person(103)[..5], &[12, 1, 0, 0, HALL_PERSON_TYPE]);
        assert!(person(142)[5..].iter().all(|&b| b == 0));
        assert!(
            (used..pool).all(|n| person(n).iter().all(|&b| b == 0)),
            "the spare records are blank"
        );
    }

    /// The pool rounds up to whole blocks of 256 and always keeps at least
    /// a block free for the player to build after loading.
    #[test]
    fn the_people_pool_rounds_up_and_keeps_a_block_spare() {
        assert_eq!(people_pool_size(0), 256);
        assert_eq!(people_pool_size(1), 512);
        assert_eq!(people_pool_size(256), 512);
        assert_eq!(people_pool_size(257), 768);
        for used in [0, 1, 143, 255, 256, 999] {
            let pool = people_pool_size(used);
            assert_eq!(pool % PEOPLE_POOL_BLOCK, 0);
            assert!(pool - used >= PEOPLE_POOL_SPARE);
        }
    }

    fn tenant(left: f64, right: f64, type_id: i64, venue: Option<OutVenueHalf>) -> OutTenant {
        OutTenant {
            left,
            right,
            type_id,
            status: 1,
            rent_class: 0,
            retail_row: None,
            draw: 2,
            venue,
        }
    }

    /// A theatre floor splits into its 7-tile screen piece on the left and
    /// its auditorium beside it, both sharing the draw and the venue; one
    /// under construction keeps its sign (#2044).
    #[test]
    fn a_theatre_floor_splits_into_its_screen_and_auditorium() {
        let lower = half(3, false, Some(2), false);
        let got = split_theatre(tenant(100.0, 131.0, 19, Some(lower)));
        assert_eq!(
            got,
            vec![
                tenant(100.0, 107.0, 35, Some(lower)),
                tenant(107.0, 131.0, 19, Some(half(3, false, Some(2), true))),
            ]
        );
        let upper = half(3, true, Some(2), false);
        let building = split_theatre(tenant(100.0, 131.0, -18, Some(upper)));
        assert_eq!(
            building.iter().map(|t| t.type_id).collect::<Vec<_>>(),
            [-34, -18]
        );
    }

    /// Every other tenant, a party hall included, is written as it is.
    #[test]
    fn other_tenants_are_not_split() {
        let hall = tenant(10.0, 34.0, 29, Some(half(5, false, None, false)));
        assert_eq!(split_theatre(hall.clone()), vec![hall]);
        let office = tenant(10.0, 19.0, 7, None);
        assert_eq!(split_theatre(office.clone()), vec![office]);
    }
}

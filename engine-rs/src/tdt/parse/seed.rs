//! Load-time people: how many rooms of a kind hold the people the file counts.

use std::collections::HashMap;

use super::OutUnit;
use crate::facilities::Kind;
use crate::tdt::format::{
    POP_CONDO, POP_HOTEL_SINGLE, POP_HOTEL_SUITE, POP_HOTEL_TWIN, POP_OFFICE,
    TDT_POPULATION_CLASSES,
};
use crate::tdt::import_report::ImportCounts;

/// The classes whose people the finance block counts and the load seeds: the
/// kind, its slot in the block and the state a room with people in it takes.
/// Shops, restaurants, fast food and theatres are left out: their customers are
/// runtime state and arrive as the tower runs.
const SEEDED_CLASSES: [(Kind, usize, &str); 5] = [
    (Kind::Office, POP_OFFICE, "occupied"),
    (Kind::Condo, POP_CONDO, "occupied"),
    (Kind::HotelSingle, POP_HOTEL_SINGLE, "asleep"),
    (Kind::HotelDouble, POP_HOTEL_TWIN, "asleep"),
    (Kind::HotelSuite, POP_HOTEL_SUITE, "asleep"),
];

fn count_in_state(units: &[OutUnit], of_kind: fn(Kind) -> bool, state: &str) -> i64 {
    units
        .iter()
        .filter(|u| of_kind(u.kind) && u.state == state)
        .count() as i64
}

/// Place the people the finance block counts for each seeded class and tally
/// them into the import report's counts.
pub(super) fn seed_from_finance(
    mut units: Vec<OutUnit>,
    pops: &[i64; TDT_POPULATION_CLASSES],
    counts: &mut ImportCounts,
) -> Vec<OutUnit> {
    let mut seeded = 0;
    for (kind, class, lived_in) in SEEDED_CLASSES {
        let rooms;
        (units, rooms) = seed_residents(units, kind, pops[class], lived_in);
        seeded += rooms * kind.facility().population.max(1);
        match kind {
            Kind::Office => counts.occupied_offices = rooms,
            Kind::Condo => counts.sold_condos = rooms,
            _ => {}
        }
    }
    counts.residents_seeded = seeded;
    counts.hotel_asleep = count_in_state(&units, Kind::is_hotel, "asleep");
    counts.hotel_dirty = count_in_state(&units, Kind::is_hotel, "dirty");
    units
}

/// Set how many rooms of `kind` hold people from the count the file gives for
/// the class, since a room's status byte is an activity state and reads some
/// occupied rooms as empty and the reverse. Rooms already in the `lived_in`
/// state stay in it first, then rooms the file shows were lived in. Returns the
/// rooms and how many now hold people.
fn seed_residents(
    units: Vec<OutUnit>,
    kind: Kind,
    people: i64,
    lived_in: &'static str,
) -> (Vec<OutUnit>, i64) {
    let per_room = kind.facility().population.max(1);
    let mut ranked: Vec<usize> = (0..units.len())
        .filter(|&i| units[i].kind == kind && units[i].state != "construction")
        .collect();
    ranked.sort_by_key(|&i| (units[i].state != lived_in, !units[i].ever_occupied));
    let target = (people / per_room).min(ranked.len() as i64);
    let held_now = ranked
        .iter()
        .filter(|&&i| units[i].state == lived_in)
        .count() as i64;
    if target == held_now {
        return (units, target);
    }
    let rank_of: HashMap<usize, usize> = ranked.iter().enumerate().map(|(r, &i)| (i, r)).collect();
    let seeded = units
        .into_iter()
        .enumerate()
        .map(|(i, unit)| match rank_of.get(&i) {
            Some(&rank) if (rank as i64) < target => OutUnit {
                state: lived_in,
                occupants: per_room,
                ever_occupied: true,
                ..unit
            },
            // A room the file's status marked as holding people but whose people
            // the finance block does not count goes back to never having been
            // lived in, which is all an exported vacant room can say.
            Some(_) => OutUnit {
                state: "empty",
                occupants: 0,
                ever_occupied: unit.ever_occupied && unit.state != lived_in,
                ..unit
            },
            None => unit,
        })
        .collect();
    (seeded, target)
}

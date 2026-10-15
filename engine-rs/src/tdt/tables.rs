//! Shared semantic tables and placement helpers for the `.TDT` codec
//! (`tdtTables.ts`): the one source the reader and the writer both use.

use crate::econ::{classic_ladder, rent_config};
use crate::facilities::{Kind, MAX_FLOOR};

/// Single-story tenant type ID to our kind (`TENANT_KIND`).
pub fn tenant_kind(type_id: i64) -> Option<Kind> {
    Some(match type_id {
        3 => Kind::HotelSingle,
        4 => Kind::HotelDouble,
        5 => Kind::HotelSuite,
        6 => Kind::Restaurant,
        7 => Kind::Office,
        9 => Kind::Condo,
        10 => Kind::Shop,
        11 => Kind::Parking,
        12 => Kind::FastFood,
        13 => Kind::Medical,
        14 => Kind::Security,
        15 => Kind::Housekeeping,
        17 => Kind::Security,
        44 => Kind::ParkingRamp,
        _ => return None,
    })
}

/// The ids of `TENANT_KIND` in ascending order, for the writer's inversion.
pub const TENANT_IDS: [i64; 14] = [3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 17, 44];

/// Multi-story part ID to its family kind (`PART_FAMILY`).
pub fn part_family(type_id: i64) -> Option<Kind> {
    Some(match type_id {
        18 | 19 | 34 | 35 => Kind::Cinema,
        20 | 21 => Kind::Recycling,
        29 | 30 => Kind::PartyHall,
        31..=33 => Kind::Metro,
        36..=40 => Kind::WeddingHall,
        _ => return None,
    })
}

/// How many stories each part family stacks (`FAMILY_STORIES`).
pub fn family_stories(kind: Kind) -> i64 {
    match kind {
        Kind::Cinema | Kind::Recycling | Kind::PartyHall => 2,
        Kind::Metro => 3,
        Kind::WeddingHall => 5,
        _ => 1,
    }
}

/// The theatre's screen halves (`SCREEN_PARTS`).
pub fn is_screen_part(type_id: i64) -> bool {
    type_id == 34 || type_id == 35
}

/// Elevator table `type` byte to our kind (`ELEVATOR_KINDS`).
pub const ELEVATOR_KINDS: [Kind; 3] = [
    Kind::ElevatorExpress,
    Kind::ElevatorStandard,
    Kind::ElevatorService,
];

pub fn elevator_kind(type_id: i64) -> Option<Kind> {
    ELEVATOR_KINDS.get(usize::try_from(type_id).ok()?).copied()
}

/// `ELEVATOR_KINDS.indexOf(kind)`.
pub fn elevator_type(kind: Kind) -> Option<i64> {
    ELEVATOR_KINDS
        .iter()
        .position(|&k| k == kind)
        .map(|i| i as i64)
}

pub const TDT_METRO_TUNNEL: i64 = 45;
pub const TDT_FLOOR: i64 = 0;
pub const TDT_LOBBY: i64 = 24;
pub const TDT_BURNED: i64 = 48;
/// Ceiling on the header's signed day counter.
pub const MAX_IMPORT_DAY: i64 = 360_000;
/// Hotel status-byte flags.
pub const HOTEL_OCCUPANT_MASK: i64 = 0x03;
pub const HOTEL_ASLEEP_FLAG: i64 = 16;
pub const HOTEL_DIRTY_FLAG: i64 = 32;
pub const HOTEL_INFESTED_FLAG: i64 = 64;

/// `misplacedOnFloor`: the placement rules a hostile file can break.
pub fn misplaced_on_floor(kind: Kind, floor: i64) -> bool {
    let hgt = kind.floors();
    if kind.facility().basement && floor + hgt > 1 {
        return true;
    }
    if floor <= 1 && floor + hgt > 1 {
        return true;
    }
    if floor < 1 && (kind == Kind::Office || kind == Kind::Condo || kind.is_hotel()) {
        return true;
    }
    if kind == Kind::WeddingHall && floor != MAX_FLOOR {
        return true;
    }
    false
}

/// `rentFromClass`: the Classic rung dollars for rent classes 0..3 of a
/// ladder-priced kind; `None` for No Rate, a garbage class or an unpriced
/// kind.
pub fn rent_from_class(kind: Kind, rent_class: i64) -> Option<f64> {
    let rungs = classic_ladder(kind)?;
    if (0..=3).contains(&rent_class) {
        return Some(rungs[rent_class as usize]);
    }
    None
}

/// `rentConfig(kind) !== null`.
pub fn is_priced(kind: Kind) -> bool {
    rent_config(kind).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rent_classes_map_onto_the_classic_ladder() {
        assert_eq!(rent_from_class(Kind::Office, 0), Some(2_000.0));
        assert_eq!(rent_from_class(Kind::Office, 3), Some(15_000.0));
        assert_eq!(rent_from_class(Kind::Office, 4), None);
        assert_eq!(rent_from_class(Kind::Shop, 3), None);
        assert_eq!(rent_from_class(Kind::HotelSuite, 3), Some(9_000.0));
    }

    #[test]
    fn tenant_ids_match_the_table() {
        for id in TENANT_IDS {
            assert!(tenant_kind(id).is_some(), "{id}");
        }
        assert_eq!(tenant_kind(50), None);
        assert_eq!(elevator_type(Kind::ElevatorService), Some(2));
        assert_eq!(elevator_kind(3), None);
    }
}

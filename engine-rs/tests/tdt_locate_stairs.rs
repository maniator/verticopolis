//! `locate_stairs` finds the stairs table by its 64-record signature, not by a
//! fixed offset.

use verticopolis_engine::tdt::tail::locate_stairs;
use verticopolis_engine::tdt::types::TdtStair;

const RECORD: usize = 10;

/// A raw 64-slot stairs table: (slot, type, x, floor) per flight.
fn table(flights: &[(usize, u8, u16, u16)]) -> Vec<u8> {
    let mut buf = vec![0u8; 64 * RECORD];
    for &(slot, kind, x, floor) in flights {
        let o = slot * RECORD;
        buf[o] = 1;
        buf[o + 1] = kind;
        buf[o + 2..o + 4].copy_from_slice(&x.to_le_bytes());
        buf[o + 4..o + 6].copy_from_slice(&floor.to_le_bytes());
    }
    buf
}

fn stair(type_id: i64, x: i64, floor: i64) -> TdtStair {
    TdtStair { type_id, x, floor }
}

#[test]
fn flights_packed_into_the_high_slots_are_recovered() {
    let mut bytes = vec![0u8; 200];
    bytes.extend(table(&[
        (58, 1, 195, 9),
        (60, 0, 168, 11),
        (63, 1, 221, 14),
    ]));
    assert_eq!(
        locate_stairs(&bytes, 0),
        vec![stair(1, 195, 9), stair(0, 168, 11), stair(1, 221, 14)]
    );
}

#[test]
fn a_flight_anchored_at_tdt_floor_zero_is_valid() {
    let mut bytes = vec![0u8; 60];
    bytes.extend(table(&[(5, 1, 100, 0)]));
    assert_eq!(locate_stairs(&bytes, 0), vec![stair(1, 100, 0)]);
}

#[test]
fn the_real_table_beats_a_smaller_coincidental_cluster() {
    let mut bytes = table(&[(2, 1, 10, 3), (4, 1, 20, 4)]);
    bytes.extend(vec![0u8; 300]);
    bytes.extend(table(&[
        (40, 1, 150, 8),
        (42, 1, 160, 9),
        (44, 1, 170, 10),
        (46, 0, 180, 11),
    ]));
    let xs: Vec<i64> = locate_stairs(&bytes, 0).iter().map(|s| s.x).collect();
    assert_eq!(xs, vec![150, 160, 170, 180]);
}

#[test]
fn a_tower_without_stairs_gives_an_empty_list() {
    assert!(locate_stairs(&vec![0u8; 2000], 0).is_empty());
}

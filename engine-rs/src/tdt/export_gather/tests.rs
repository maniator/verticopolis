use super::{
    gather_tower, js_finite, js_num, js_num_raw_site, kind_tenant, GatheredTower, Kind, OutTenant,
    HOTEL_ASLEEP_FLAG,
};
use serde_json::json;

#[test]
fn js_finite_accepts_only_finite_numbers() {
    assert_eq!(js_finite(Some(&json!(2.5))), Some(2.5));
    assert_eq!(js_finite(Some(&json!(-0.0))), Some(0.0));
    assert_eq!(js_finite(Some(&json!(0))), Some(0.0));
    for v in [
        json!(null),
        json!(true),
        json!(false),
        json!("3"),
        json!(""),
        json!([]),
        json!([7]),
        json!({}),
    ] {
        assert_eq!(js_finite(Some(&v)), None, "{v}");
    }
    assert_eq!(js_finite(None), None);
}

#[test]
fn js_num_still_coerces_where_js_finite_refuses() {
    assert_eq!(js_num(Some(&json!(null))), 0.0);
    assert_eq!(js_num(Some(&json!("3"))), 3.0);
    assert_eq!(js_num(Some(&json!(true))), 1.0);
    assert_eq!(js_finite(Some(&json!(null))), None);
    assert_eq!(js_finite(Some(&json!("3"))), None);
    assert_eq!(js_finite(Some(&json!(true))), None);
}

/// `Number()` on the strings and arrays a forged save can carry, pinned
/// with Node (the round-3 Edge Case Hunter's divergent inputs).
#[test]
fn js_num_reads_strings_and_arrays_the_way_number_does() {
    assert_eq!(js_num(Some(&json!("0x7D0"))), 2000.0);
    assert_eq!(js_num(Some(&json!("0x2"))), 2.0);
    assert_eq!(js_num(Some(&json!("0o7"))), 7.0);
    assert_eq!(js_num(Some(&json!("0b1"))), 1.0);
    assert!(js_num(Some(&json!("INF"))).is_nan());
    assert!(js_num(Some(&json!("inf"))).is_nan());
    assert_eq!(js_num(Some(&json!("Infinity"))), f64::INFINITY);
    assert_eq!(js_num(Some(&json!("\u{feff}2"))), 2.0);
    assert!(js_num(Some(&json!("\u{85}2"))).is_nan());
    assert!(js_num(Some(&json!([true]))).is_nan());
    assert_eq!(js_num(Some(&json!([5]))), 5.0);
    assert_eq!(js_num(Some(&json!([]))), 0.0);
    assert_eq!(js_num(Some(&json!(["0x10"]))), 16.0);
    assert!(js_num(Some(&json!([1, 2]))).is_nan());
    assert!(js_num(Some(&json!("-0x10"))).is_nan());
    assert_eq!(js_num(Some(&json!(null))), 0.0);
    assert!(js_num(None).is_nan());
}

/// The raw-site reader's outputs pinned as they are (the pre-round-3
/// reading kept on purpose; #884), contrasted with `js_num` on the same
/// inputs. This pins the reader; the `gather_*` tests below pin which
/// reader each call site uses.
#[test]
fn js_num_raw_site_outputs_are_pinned() {
    let raw = |v: serde_json::Value| js_num_raw_site(Some(&v));
    assert!(raw(json!("0x10")).is_nan());
    assert_eq!(js_num(Some(&json!("0x10"))), 16.0);
    assert_eq!(raw(json!("inf")), f64::INFINITY);
    assert_eq!(raw(json!("infinity")), f64::INFINITY);
    assert_eq!(raw(json!("\u{85}2")), 2.0);
    assert!(raw(json!("\u{feff}2")).is_nan());
    assert_eq!(raw(json!([true])), 1.0);
    assert_eq!(raw(json!([5])), 5.0);
    assert_eq!(raw(json!([])), 0.0);
    assert_eq!(raw(json!(null)), 0.0);
    assert_eq!(raw(json!(true)), 1.0);
    assert!(js_num_raw_site(None).is_nan());
    assert_eq!(raw(json!("5")), 5.0);
    assert!(raw(json!("12abc")).is_nan());
    assert_eq!(raw(json!("")), 0.0);
    assert_eq!(raw(json!("  ")), 0.0);
    assert_eq!(js_num(Some(&json!(""))), 0.0);
    assert!(raw(json!("\u{feff}")).is_nan());
    assert_eq!(js_num(Some(&json!("\u{feff}"))), 0.0);
    assert_eq!(raw(json!("\u{85}")), 0.0);
    assert!(js_num(Some(&json!("\u{85}"))).is_nan());
}

// The call sites. Each test forges one field with a radix string, which
// `js_num_raw_site` reads as NaN and `js_num` reads as a number, and
// checks what `gather_tower` makes of it, so moving any of the six sites
// to the other reader fails a test here.

fn gather(units: serde_json::Value) -> GatheredTower {
    match gather_tower(&json!({ "units": units })) {
        Ok(g) => g,
        Err(e) => panic!("gather refused the save: {}", e.0),
    }
}

/// Every non-paving record the gather wrote, in floor order.
fn records(g: &GatheredTower, kind: Kind) -> Vec<OutTenant> {
    let id = kind_tenant(kind).expect("kind writes a record");
    g.tenants_by_tdt
        .values()
        .flatten()
        .filter(|t| t.type_id == id)
        .cloned()
        .collect()
}

/// A unit's `floor` is a raw site: `"0x10"` reads NaN, so the office is
/// out of range (with `js_num` it would read 16 and write a record).
#[test]
fn gather_reads_a_unit_floor_at_the_raw_site() {
    let g = gather(json!([{ "kind": "office", "floor": "0x10", "x": 10 }]));
    assert!(g.rooms[0].floor.is_nan());
    assert_eq!(g.counts.out_of_range, 1);
    assert_eq!(g.counts.rooms, 0);
    assert!(records(&g, Kind::Office).is_empty());
}

/// A unit's `x` is a raw site: `"0x10"` reads NaN, so the record's left
/// edge is NaN (with `js_num` it would be 16).
#[test]
fn gather_reads_a_unit_x_at_the_raw_site() {
    let g = gather(json!([{ "kind": "office", "floor": 2, "x": "0x10" }]));
    assert!(g.rooms[0].x.is_nan());
    let recs = records(&g, Kind::Office);
    assert_eq!(recs.len(), 1);
    assert!(recs[0].left.is_nan());
}

/// A unit's `width` is a raw site: `"0x10"` reads NaN, so the record's
/// right edge is NaN (with `js_num` it would be x + 16).
#[test]
fn gather_reads_a_unit_width_at_the_raw_site() {
    let g = gather(json!([{ "kind": "office", "floor": 2, "x": 10, "width": "0x10" }]));
    assert!(g.rooms[0].width.is_nan());
    let recs = records(&g, Kind::Office);
    assert_eq!(recs.len(), 1);
    assert_eq!(recs[0].left, 10.0);
    assert!(recs[0].right.is_nan());
}

/// A unit's `occupants` coerces like `Number()`: `"0x2"` reads 2, so an
/// asleep hotel room writes two guests (the raw-site reader's NaN would
/// write none).
#[test]
fn gather_coerces_occupants_like_number() {
    let g = gather(json!([{
        "kind": "hotelSingle", "floor": 2, "x": 10,
        "state": "asleep", "occupants": "0x2"
    }]));
    assert_eq!(g.rooms[0].occupants, 2.0);
    let recs = records(&g, Kind::HotelSingle);
    assert_eq!(recs.len(), 1);
    assert_eq!(recs[0].status, HOTEL_ASLEEP_FLAG | 2);
}

/// A unit's `rent` coerces like `Number()` at both of its sites:
/// `"0x3A98"` is 15,000, the office's class-3 rung, so the record takes
/// class 3 and nothing snaps. Reading it raw at the class site lands on
/// class 2 and snaps; reading it raw at the snap check compares the rung
/// with NaN and snaps.
#[test]
fn gather_coerces_rent_like_number_at_both_sites() {
    let g = gather(json!([{ "kind": "office", "floor": 2, "x": 10, "rent": "0x3A98" }]));
    let recs = records(&g, Kind::Office);
    assert_eq!(recs.len(), 1);
    assert_eq!(recs[0].rent_class, 3);
    assert_eq!(g.counts.rents_snapped, 0);
}

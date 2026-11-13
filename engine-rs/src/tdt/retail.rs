//! Shops, fast food and restaurants and their rows in the retail table
//! (#2044). The game's own saves link the two both ways: a room's tenant
//! record names its row in byte 6, and the row names the room by its floor
//! and logical unit id in bytes 0 and 1 and holds its style in byte 11.

use super::byte_writer::{to_int32, ByteWriter};
use super::format::{
    RETAIL_CONSTANT_BYTE, RETAIL_ROW_CONSTANT, RETAIL_STYLE_BYTE, TDT_RETAIL_RECORD_SIZE,
    TDT_RETAIL_SLOTS,
};
use super::types::{TdtFloor, TdtRetailRow, TdtTenant, TdtTower};
use crate::facilities::Kind;

/// Byte 0 of an empty retail row.
const EMPTY_ROW: u8 = 0xFF;
/// Byte 1 of a row: the room's logical unit id on its floor.
const UNIT_BYTE: usize = 1;
/// The rows one byte of a room's record can name; the table holds twice as
/// many.
const ROWS_PER_BYTE: usize = 256;

/// A room record's bytes 7 to 14 with byte 7 set to the high byte of its
/// retail `row`: a room past the 256th names its row in bytes 6 and 7, low
/// byte first. The game's own saves hold fewer rooms and keep byte 7 at 0
/// (#2044).
pub fn with_row_high(mut middle: [u8; 8], row: i64) -> [u8; 8] {
    middle[0] = (row as usize / ROWS_PER_BYTE) as u8;
    middle
}

/// Write the retail table: each of `rows` (floor index, style) with the
/// logical unit id `ids` gives the room at the same place, then empty rows.
pub fn write_retail_table(w: &mut ByteWriter, rows: &[(f64, i64)], ids: &[usize]) {
    for slot in 0..TDT_RETAIL_SLOTS {
        let mut record = [0u8; TDT_RETAIL_RECORD_SIZE];
        match rows.get(slot) {
            None => record[0] = EMPTY_ROW,
            Some(&(floor, style)) => {
                record[0] = to_int32(floor) as u8;
                record[UNIT_BYTE] = ids[slot] as u8;
                record[RETAIL_STYLE_BYTE] = style as u8;
                record[RETAIL_CONSTANT_BYTE] = RETAIL_ROW_CONSTANT;
            }
        }
        w.bytes(&record);
    }
}

/// The style index of the shop, fast food or restaurant `t`, the record at
/// `at` on `floor`: byte 11 of the retail row its byte 6 names, when that
/// row names this room back. Otherwise byte 6 itself, which is where our
/// exports before #2044 kept the style.
fn retail_style(tower: &TdtTower, floor: &TdtFloor, at: usize, t: &TdtTenant) -> i64 {
    let rows = &tower.tail.retail;
    let names_this_room = |r: &TdtRetailRow| {
        i64::from(r.floor) == floor.index
            && floor
                .index_map
                .get(usize::from(r.slot))
                .map(|&i| usize::from(i))
                == Some(at)
    };
    let row_at = |row: usize| {
        rows.binary_search_by_key(&row, |r| r.row)
            .ok()
            .map(|i| rows[i])
    };
    // Bytes 6 and 7 name the row; a file whose byte 7 is 0 for a room past
    // the 256th (our exports from #2077 until this fix) names it by byte 6
    // alone, so the rows 256 apart are tried too, each only if it names this
    // room back.
    let low = usize::try_from(t.variant).unwrap_or(usize::MAX);
    let high = usize::try_from(t.row_high).unwrap_or(0);
    let named = std::iter::once(low.saturating_add(high * ROWS_PER_BYTE))
        .chain((0..TDT_RETAIL_SLOTS / ROWS_PER_BYTE).map(|k| low.saturating_add(k * ROWS_PER_BYTE)))
        .filter_map(row_at)
        .find(|r| names_this_room(r));
    named.and_then(|r| r.style).map_or(t.variant, i64::from)
}

/// The style a shop, fast food or restaurant imports with; `None` for every
/// other kind. A style past the list takes the first, which is what the
/// exporter writes for a room with none, so a file imports the same before
/// and after one trip through export.
pub fn retail_subtype(
    tower: &TdtTower,
    floor: &TdtFloor,
    at: usize,
    t: &TdtTenant,
    kind: Kind,
) -> Option<&'static str> {
    if !matches!(kind, Kind::Shop | Kind::FastFood | Kind::Restaurant) {
        return None;
    }
    let list = kind.subtype_list()?;
    let style = usize::try_from(retail_style(tower, floor, at, t)).ok();
    style
        .and_then(|i| list.get(i))
        .or_else(|| list.first())
        .copied()
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::clock::GameMode;
    use crate::sim::Simulation;
    use crate::tdt::export::build_tdt;
    use crate::tdt::format::{parse_tdt_binary, TDT_FLOOR_OFFSET};
    use crate::tdt::parse::parse_tdt;

    /// A floor tile, then a shop, a restaurant and a second shop on floor 2,
    /// each in a style past the first.
    fn retail_save() -> Value {
        let mut save = Simulation::new_game(7, GameMode::Classic).serialize();
        let room = |id: i64, kind: &str, x: i64, width: i64, subtype: &str| {
            json!({"id": id, "kind": kind, "floor": 2, "x": x, "width": width,
                "state": "occupied", "satisfaction": 1, "occupants": 0, "everOccupied": true,
                "pendingIncome": 0, "label": kind, "subtype": subtype})
        };
        save["units"] = json!([
            {"id": 1, "kind": "floor", "floor": 2, "x": 100, "width": 1, "state": "empty",
                "satisfaction": 1, "occupants": 0, "everOccupied": false, "pendingIncome": 0,
                "label": "Floor"},
            room(2, "shop", 101, 12, "Pet Store"),
            room(3, "restaurant", 113, 24, "Sushi Bar"),
            room(4, "shop", 137, 12, "Bank"),
        ]);
        save["nextId"] = json!(5);
        save["star"] = json!(3);
        save
    }

    /// Each room's byte 6 names its row, the row names the room back by its
    /// logical unit id (the floor tile has none) and holds its style.
    #[test]
    fn each_room_and_its_row_name_each_other() {
        let built = build_tdt(&retail_save()).expect("exports");
        let tower = parse_tdt_binary(&built.bytes).expect("reads");
        let floor = tower
            .floors
            .iter()
            .find(|f| f.index == 2 + TDT_FLOOR_OFFSET)
            .unwrap();
        let mut seen = vec![];
        for (at, t) in floor.tenants.iter().enumerate() {
            let Some(list) = [(10, Kind::Shop), (6, Kind::Restaurant)]
                .iter()
                .find(|(id, _)| *id == t.type_id)
                .and_then(|(_, k)| k.subtype_list())
            else {
                continue;
            };
            let row = tower.tail.retail[t.variant as usize];
            assert_eq!(row.row as i64, t.variant);
            assert_eq!(i64::from(row.floor), floor.index);
            assert_eq!(usize::from(floor.index_map[usize::from(row.slot)]), at);
            seen.push((row.slot, list[usize::from(row.style.unwrap())]));
        }
        assert_eq!(
            seen,
            [(0, "Pet Store"), (1, "Sushi Bar"), (2, "Bank")],
            "ids skip the floor tile"
        );
    }

    #[test]
    fn retail_styles_survive_a_trip_through_export_and_import() {
        let built = build_tdt(&retail_save()).expect("exports");
        let back = parse_tdt(&built.bytes, "SHOPS.TDT").expect("imports");
        let styles: Vec<(i64, &str)> = back.save["units"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|u| Some((u["x"].as_i64()?, u["subtype"].as_str()?)))
            .collect();
        assert_eq!(
            styles,
            [(101, "Pet Store"), (113, "Sushi Bar"), (137, "Bank")]
        );
    }

    fn tenant(variant: i64) -> TdtTenant {
        TdtTenant {
            left: 0,
            right: 12,
            type_id: 10,
            status: 0,
            status_at: 0,
            variant,
            row_high: 0,
            draw: 0,
            rent_rate: 0,
            subtype: 0,
        }
    }

    /// Our exports before #2044 kept the style in byte 6 and wrote rows with
    /// no 255 in byte 13 and unit 0: that byte 6 is still read as the style,
    /// even when the row it happens to name sits on the room's floor.
    #[test]
    fn an_older_export_keeps_reading_its_style_from_byte_6() {
        let built = build_tdt(&retail_save()).expect("exports");
        let mut tower = parse_tdt_binary(&built.bytes).expect("reads");
        let floor = tower.floors[(2 + TDT_FLOOR_OFFSET) as usize].clone();
        let at = usize::from(floor.index_map[0]);
        for row in &mut tower.tail.retail {
            row.style = None;
        }
        assert_eq!(retail_style(&tower, &floor, at, &tenant(0)), 0);
        assert_eq!(retail_style(&tower, &floor, at, &tenant(7)), 7);
        // With the game's rows, the same byte 6 reads the row's style.
        tower.tail.retail[0].style = Some(4);
        assert_eq!(retail_style(&tower, &floor, at, &tenant(0)), 4);
        // A row that names another room is not this room's.
        assert_eq!(retail_style(&tower, &floor, at + 1, &tenant(0)), 0);
    }

    /// Shops filling floors 2 and up, 31 to a floor, room `i` in shop style
    /// `i % 11`.
    fn many_shops(count: usize) -> Value {
        let mut save = Simulation::new_game(7, GameMode::Classic).serialize();
        let styles = Kind::Shop.subtype_list().unwrap();
        let units: Vec<Value> = (0..count)
            .map(|i| {
                json!({"id": i + 1, "kind": "shop", "floor": 2 + i / 31, "x": (i % 31) * 12,
                    "width": 12, "state": "occupied", "satisfaction": 1, "occupants": 0,
                    "everOccupied": true, "pendingIncome": 0, "label": "Shop",
                    "subtype": styles[i % styles.len()]})
            })
            .collect();
        save["units"] = Value::Array(units);
        save["nextId"] = json!(count + 1);
        save["star"] = json!(3);
        save
    }

    /// Rooms past the 256th name their row in bytes 6 and 7, so rooms 255,
    /// 256, 257 and 512 keep their own rows and styles through export and
    /// import; a 513th has no row, which the export counts as dropped.
    #[test]
    fn rooms_past_the_256th_name_their_rows_in_two_bytes() {
        let built = build_tdt(&many_shops(513)).expect("exports");
        assert_eq!(built.counts.retail_rows_dropped, 1);
        let tower = parse_tdt_binary(&built.bytes).expect("reads");
        let mut rows_named = vec![];
        for floor in &tower.floors {
            for (at, t) in floor.tenants.iter().enumerate() {
                if t.type_id != 10 {
                    continue;
                }
                let row = (t.variant + 256 * t.row_high) as usize;
                let r = tower.tail.retail.get(row);
                if r.is_some_and(|r| {
                    i64::from(r.floor) == floor.index
                        && usize::from(floor.index_map[usize::from(r.slot)]) == at
                }) {
                    rows_named.push(row);
                }
            }
        }
        assert_eq!(rows_named, (0..512).collect::<Vec<_>>());

        let back = parse_tdt(&built.bytes, "SHOPS.TDT").expect("imports");
        let styles = Kind::Shop.subtype_list().unwrap();
        let units = back.save["units"].as_array().unwrap();
        let style_of = |i: usize| {
            units
                .iter()
                .find(|u| {
                    u["floor"].as_i64() == Some(2 + (i / 31) as i64)
                        && u["x"].as_i64() == Some(((i % 31) * 12) as i64)
                })
                .and_then(|u| u["subtype"].as_str())
                .unwrap()
        };
        for i in [254, 255, 256, 511] {
            assert_eq!(style_of(i), styles[i % styles.len()], "room {}", i + 1);
        }
        assert_eq!(
            style_of(512),
            styles[0],
            "the room past the table opens in the first style"
        );
    }

    /// A file that named a room past the 256th by byte 6 alone, as our
    /// exports did before rows took two bytes, still finds the room's row.
    #[test]
    fn a_row_named_by_its_low_byte_alone_is_still_found() {
        let built = build_tdt(&many_shops(300)).expect("exports");
        let tower = parse_tdt_binary(&built.bytes).expect("reads");
        let row = 290;
        let floor = &tower.floors[(2 + row / 31) + TDT_FLOOR_OFFSET as usize];
        let at = floor
            .tenants
            .iter()
            .position(|t| t.left == ((row % 31) * 12) as i64)
            .unwrap();
        let mut t = floor.tenants[at].clone();
        assert_eq!((t.variant, t.row_high), ((row % 256) as i64, 1));
        let style = tower.tail.retail[row].style.map(i64::from);
        assert_eq!(Some(retail_style(&tower, floor, at, &t)), style);
        t.row_high = 0;
        assert_eq!(Some(retail_style(&tower, floor, at, &t)), style);
    }
}

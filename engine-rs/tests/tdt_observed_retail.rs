//! The retail table in the 1997 game's own saves (#2044): each shop, fast
//! food and restaurant names its row in byte 6 of its tenant record, the row
//! names the room back by floor and logical unit id, and the row's byte 11
//! is the room's style. The files are `conformance/fixtures/tdt-observed/`.

use std::collections::BTreeSet;
use std::path::PathBuf;

use verticopolis_engine::facilities::Kind;
use verticopolis_engine::tdt::format::parse_tdt_binary;
use verticopolis_engine::tdt::parse::parse_tdt;

const SAVES: [&str; 7] = [
    "T5O01.TDT",
    "T5O35.TDT",
    "T7O01.TDT",
    "T7O76.TDT",
    "FRESH0.TDT",
    "FRESH3A.TDT",
    "FRESH9A.TDT",
];
/// Shop, restaurant and fast food type ids.
const RETAIL_TYPES: [i64; 3] = [10, 6, 12];

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../conformance/fixtures/tdt-observed")
        .join(name);
    std::fs::read(path).expect("fixture")
}

#[test]
fn every_retail_room_names_a_row_that_names_it_back() {
    for name in SAVES {
        let tower = parse_tdt_binary(&fixture(name)).expect("reads");
        let mut rooms = 0;
        for floor in &tower.floors {
            for (at, t) in floor.tenants.iter().enumerate() {
                if !RETAIL_TYPES.contains(&t.type_id.abs()) {
                    continue;
                }
                rooms += 1;
                let row = tower
                    .tail
                    .retail
                    .iter()
                    .find(|r| r.row as i64 == t.variant)
                    .unwrap_or_else(|| panic!("{name}: byte 6 names no row"));
                assert_eq!(i64::from(row.floor), floor.index, "{name}: the row's floor");
                assert_eq!(
                    floor.index_map[usize::from(row.slot)] as usize,
                    at,
                    "{name}: the row's logical unit id"
                );
                assert!(
                    row.style.is_some(),
                    "{name}: the row carries the game's 255"
                );
            }
        }
        assert_eq!(rooms, tower.tail.retail.len(), "{name}: one row per room");
    }
}

#[test]
fn a_played_tower_imports_its_shops_in_their_own_styles() {
    // Reading byte 6 as the style gave TOWER7's 75 rooms 54 Men's Clothing
    // shops; byte 11 of their rows spreads them over every shop style.
    let back = parse_tdt(&fixture("T7O01.TDT"), "T7O01.TDT").expect("imports");
    let shop_styles: BTreeSet<&str> = back.save["units"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|u| u["kind"] == "shop")
        .filter_map(|u| u["subtype"].as_str())
        .collect();
    let all = Kind::Shop.subtype_list().unwrap().len();
    assert_eq!(shop_styles.len(), all);
}

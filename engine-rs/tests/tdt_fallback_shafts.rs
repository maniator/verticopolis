//! When a save's elevator table cannot be read, the importer rebuilds working
//! shafts from the floors (#920, claim 9). The rebuilt shafts must not stand
//! on rooms the same file brought over.

use std::path::PathBuf;

use serde_json::Value;
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::tdt::format::{
    TDT_FLOOR_INDEX_ENTRIES, TDT_HEADER_SIZE, TDT_TENANT_RECORD_SIZE,
};
use verticopolis_engine::tdt::parse::parse_tdt;

const SAVES: [&str; 8] = [
    "TOWER1.TDT",
    "TOWER2.TDT",
    "TOWER3.TDT",
    "TOWER4.TDT",
    "TOWER5.TDT",
    "TOWER6.TDT",
    "TOWER7.TDT",
    "MYTOWER.TDT",
];

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("conformance")
        .join("fixtures")
        .join("tdt-reddit")
        .join(name);
    std::fs::read(path).expect("fixture")
}

/// The file cut right after its floor map: no people, retail, elevator or
/// stairs data follows, so the importer has to rebuild the shafts.
fn without_tail(bytes: &[u8], name: &str) -> Vec<u8> {
    let whole = parse_tdt(bytes, name).expect("imports");
    let map: usize = whole
        .tower
        .floors
        .iter()
        .map(|f| 6 + TDT_TENANT_RECORD_SIZE * f.tenants.len() + TDT_FLOOR_INDEX_ENTRIES * 2)
        .sum();
    bytes[..TDT_HEADER_SIZE + map].to_vec()
}

fn rect(v: &Value) -> (i64, i64, i64, i64) {
    let x = v["x"].as_i64().expect("x");
    (x, x + v["width"].as_i64().expect("width"), 0, 0)
}

#[test]
fn rebuilt_shafts_stand_clear_of_the_rooms_the_file_brought_over() {
    for name in SAVES {
        let cut = without_tail(&fixture(name), name);
        let parsed = parse_tdt(&cut, name).expect("imports without its tail");
        let transports = parsed.save["transports"].as_array().expect("transports");
        assert!(!transports.is_empty(), "{name}: a layout was rebuilt");
        let rooms: Vec<&Value> = parsed.save["units"]
            .as_array()
            .expect("units")
            .iter()
            .filter(|u| !matches!(u["kind"].as_str(), Some("floor" | "lobby")))
            .collect();
        for t in transports {
            let (left, right, _, _) = rect(t);
            let (bottom, top) = (t["bottom"].as_i64().unwrap(), t["top"].as_i64().unwrap());
            for room in &rooms {
                let kind = Kind::parse(room["kind"].as_str().unwrap()).expect("kind");
                let floor = room["floor"].as_i64().unwrap();
                let (rl, rr, _, _) = rect(room);
                let shares_a_floor = floor <= top && bottom < floor + kind.floors();
                assert!(
                    !(shares_a_floor && left < rr && rl < right),
                    "{name}: shaft at x={left} over floors {bottom}..{top} stands on {} at floor {floor}, x={rl}",
                    room["kind"]
                );
            }
        }
    }
}

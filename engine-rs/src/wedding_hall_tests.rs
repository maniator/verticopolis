//! The wedding hall: 28 wide and five stories tall, with its
//! bottom story on floor 100 and the other four above it.
use crate::clock::GameMode;
use crate::facilities::{Kind, MAX_FLOOR, WEDDING_HALL_TOP_FLOOR};
use crate::load::deserialize;
use crate::sim::Simulation;

const HALL_X: i64 = 150;
const HALL_WIDTH: i64 = 28;

/// A tower with floor slabs from floor 2 to 100 under `HALL_X` to `HALL_X + width`.
fn crowned_site(width: i64) -> Simulation {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    for x in HALL_X..HALL_X + width {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=MAX_FLOOR {
        for x in HALL_X..HALL_X + width {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok, "{floor} {x}");
        }
    }
    sim.star = 5;
    sim.money = 10_000_000.0;
    sim
}

#[test]
fn the_catalog_entry_is_the_wedding_hall_footprint() {
    let hall = Kind::WeddingHall;
    assert_eq!(hall.facility().width, HALL_WIDTH);
    assert_eq!(hall.floors(), 5);
    assert_eq!(hall.highest_story(), WEDDING_HALL_TOP_FLOOR);
    assert_eq!(hall.highest_base_floor(), MAX_FLOOR);
    assert_eq!(Kind::PartyHall.highest_base_floor(), MAX_FLOOR - 1);
}

#[test]
fn the_wedding_hall_stands_on_floor_100_and_rises_four_stories() {
    let mut sim = crowned_site(HALL_WIDTH);
    sim.mode = GameMode::Modern; // Classic never sells it, and the sale below frees every story
    let built = sim.build(Kind::WeddingHall, MAX_FLOOR, HALL_X);
    assert!(built.ok, "{:?}", built.reason);
    let id = *sim.tower.rooms.get(&(MAX_FLOOR, HALL_X)).unwrap();
    for floor in MAX_FLOOR..=WEDDING_HALL_TOP_FLOOR {
        assert_eq!(sim.tower.rooms.get(&(floor, HALL_X)), Some(&id), "{floor}");
        let last = HALL_X + HALL_WIDTH - 1;
        assert_eq!(sim.tower.rooms.get(&(floor, last)), Some(&id), "{floor}");
    }
    assert_eq!(
        sim.tower.rooms.get(&(WEDDING_HALL_TOP_FLOOR + 1, HALL_X)),
        None
    );
    // No floor slab is laid above the last floor.
    assert!(!sim.tower.structure.contains_key(&(MAX_FLOOR + 1, HALL_X)));
    // Selling it frees every story.
    assert!(
        sim.remove_facility(id, crate::gameplay::RemovalMethod::Sell)
            .ok
    );
    assert!(!sim
        .tower
        .rooms
        .contains_key(&(WEDDING_HALL_TOP_FLOOR, HALL_X)));
}

#[test]
fn the_wedding_hall_refuses_every_floor_but_100() {
    let mut sim = crowned_site(HALL_WIDTH);
    for floor in [2, 96, 99] {
        let refused = sim.build(Kind::WeddingHall, floor, HALL_X);
        assert!(!refused.ok, "floor {floor}");
    }
}

#[test]
fn the_wedding_hall_needs_a_full_width_floor_slab_under_it() {
    let mut sim = crowned_site(HALL_WIDTH - 1);
    sim.auto_bridge = false;
    assert!(!sim.build(Kind::WeddingHall, MAX_FLOOR, HALL_X).ok);
}

/// A save of `crowned_site` carrying a 16 wide wedding hall, as saves written
/// before the wedding hall grew do, with an office on floor 100 at each `neighbors` x.
fn legacy_save(neighbors: &[i64]) -> serde_json::Value {
    let mut sim = crowned_site(HALL_WIDTH + 12);
    let hall = sim.build(Kind::WeddingHall, MAX_FLOOR, HALL_X + 6);
    assert!(hall.ok, "{:?}", hall.reason);
    let mut save = sim.serialize();
    let units = save["units"].as_array_mut().unwrap();
    for u in units.iter_mut().filter(|u| u["kind"] == "weddingHall") {
        u["width"] = serde_json::json!(16);
        u["x"] = serde_json::json!(HALL_X + 12);
    }
    for (i, x) in neighbors.iter().enumerate() {
        units.push(serde_json::json!({
            "id": 900_000 + i, "kind": "office", "floor": MAX_FLOOR, "x": x, "width": 9,
            "state": "empty", "occupants": 0, "satisfaction": 1
        }));
    }
    save
}

fn hall_span(save: &serde_json::Value) -> (i64, i64) {
    let sim = deserialize(save).expect("the save loads");
    let id = *sim
        .tower
        .rooms
        .get(&(MAX_FLOOR, HALL_X + 12))
        .expect("a hall stands");
    let hall = sim.tower.units.iter().find(|u| u.id == id).unwrap();
    assert_eq!(hall.kind, Kind::WeddingHall);
    (hall.x, hall.width)
}

#[test]
fn an_old_sixteen_wide_hall_widens_around_where_it_stood() {
    let (x, width) = hall_span(&legacy_save(&[]));
    assert_eq!(width, HALL_WIDTH);
    // Centered on the old hall (HALL_X + 12 to + 28), then pushed inside the slab.
    assert!((HALL_X..=HALL_X + 12).contains(&x), "{x}");
}

#[test]
fn an_old_hall_with_no_room_to_grow_stays_as_it_was() {
    // Offices either side leave only 21 free tiles around the old hall.
    let (x, width) = hall_span(&legacy_save(&[HALL_X, HALL_X + 30]));
    assert_eq!((x, width), (HALL_X + 12, 16));
}

#[test]
fn a_full_width_hall_loads_untouched() {
    let mut sim = crowned_site(HALL_WIDTH);
    assert!(sim.build(Kind::WeddingHall, MAX_FLOOR, HALL_X).ok);
    let loaded = deserialize(&sim.serialize()).expect("the save loads");
    let id = *loaded.tower.rooms.get(&(MAX_FLOOR, HALL_X)).unwrap();
    let hall = loaded.tower.units.iter().find(|u| u.id == id).unwrap();
    assert_eq!((hall.x, hall.width), (HALL_X, HALL_WIDTH));
    assert_eq!(
        loaded.tower.rooms.get(&(WEDDING_HALL_TOP_FLOOR, HALL_X)),
        Some(&id)
    );
}

#[test]
fn classic_never_removes_the_wedding_hall() {
    let mut sim = crowned_site(HALL_WIDTH);
    assert!(sim.build(Kind::WeddingHall, MAX_FLOOR, HALL_X).ok);
    let id = *sim.tower.rooms.get(&(MAX_FLOOR, HALL_X)).unwrap();
    let sold = sim.remove_facility(id, crate::gameplay::RemovalMethod::Sell);
    assert!(!sold.ok);
    assert_eq!(
        sold.reason.as_deref(),
        Some(crate::charges::CLASSIC_WEDDING_HALL_KEPT)
    );
    assert!(!sim.sell_at(MAX_FLOOR, HALL_X));
    assert!(sim.tower.rooms.contains_key(&(MAX_FLOOR, HALL_X)));
}

#[test]
fn modern_can_still_sell_the_wedding_hall() {
    let mut sim = crowned_site(HALL_WIDTH);
    sim.mode = GameMode::Modern;
    assert!(sim.build(Kind::WeddingHall, MAX_FLOOR, HALL_X).ok);
    let id = *sim.tower.rooms.get(&(MAX_FLOOR, HALL_X)).unwrap();
    assert!(
        sim.remove_facility(id, crate::gameplay::RemovalMethod::Sell)
            .ok
    );
}

#[test]
fn classic_keeps_floor_100_for_the_wedding_hall_alone() {
    let mut sim = crowned_site(HALL_WIDTH);
    sim.star = 5;
    let office = sim.can_build(Kind::Office, MAX_FLOOR, HALL_X);
    assert!(!office.ok);
    assert_eq!(
        office.reason.as_deref(),
        Some(crate::build::CLASSIC_TOP_FLOOR_REASON)
    );
    // A two story room whose upper story reaches floor 100 is refused too.
    assert!(!sim.can_build(Kind::PartyHall, MAX_FLOOR - 1, HALL_X).ok);
    // Floor 99 stays open, and so does floor 100 in Modern.
    assert!(sim.can_build(Kind::Office, MAX_FLOOR - 1, HALL_X).ok);
    sim.mode = GameMode::Modern;
    assert!(sim.can_build(Kind::Office, MAX_FLOOR, HALL_X).ok);
}

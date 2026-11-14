//! No home goes underground: condos, Modern's studios and apartments, hotel
//! rooms and offices are all refused below floor 1, and a save that already
//! holds a basement home still loads with it.

use serde_json::Value;

use crate::clock::GameMode;
use crate::facilities::{no_basement, Kind, FACILITIES};
use crate::load_stream::load_save_text;
use crate::sim::Simulation;

/// The kinds kept above ground, named one by one so a kind that drops out
/// of the rule (or one that joins it) fails here.
const ABOVE_GROUND_ONLY: [Kind; 8] = [
    Kind::Office,
    Kind::Condo,
    Kind::RentalStudio,
    Kind::RentalApartment,
    Kind::HotelSingle,
    Kind::HotelDouble,
    Kind::HotelSuite,
    Kind::Housekeeping,
];

#[test]
fn every_home_hotel_room_and_office_is_kept_above_ground() {
    for kind in FACILITIES.iter().map(|f| f.kind) {
        assert_eq!(
            no_basement(kind),
            ABOVE_GROUND_ONLY.contains(&kind),
            "{kind:?}"
        );
    }
}

/// A Modern game with a lobby on floor 1 and floor tiles on floors 0 and 2
/// over the same span, so a room can be tried just below and just above
/// the ground floor.
fn modern_tower_with_a_basement() -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Modern);
    sim.money = 1e9;
    // Every home is unlocked, so only the site can refuse one.
    sim.star = 5;
    for x in 100..160 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
        assert!(sim.tower.place(Kind::Floor, 0, x).ok);
    }
    sim
}

#[test]
fn no_home_can_be_built_in_the_basement() {
    let sim = modern_tower_with_a_basement();
    for kind in [Kind::Condo, Kind::RentalStudio, Kind::RentalApartment] {
        let below = sim.can_build(kind, 0, 110);
        assert!(!below.ok, "{kind:?} was allowed in the basement");
        let reason = below.reason.expect("the refusal names its reason");
        assert!(
            reason.contains("can't be built in the basement"),
            "{reason}"
        );
        // The same spot one story above ground takes it, so the refusal is
        // the basement rule and nothing else about the site.
        assert!(sim.can_build(kind, 2, 110).ok, "{kind:?} on floor 2");
    }
}

/// A save written before the rule (a studio and an apartment on floor 0)
/// still loads, keeps both homes where they stood, and plays on.
#[test]
fn a_save_with_basement_homes_still_loads() {
    let mut sim = modern_tower_with_a_basement();
    assert!(sim.tower.place(Kind::RentalStudio, 2, 110).ok);
    assert!(sim.tower.place(Kind::RentalApartment, 2, 130).ok);
    let mut save = sim.serialize();
    let mut moved = 0;
    for unit in save["units"].as_array_mut().expect("units") {
        if matches!(
            unit["kind"].as_str(),
            Some("rentalStudio" | "rentalApartment")
        ) {
            unit["floor"] = Value::from(0);
            moved += 1;
        }
    }
    assert_eq!(moved, 2);
    let mut loaded = load_save_text(save.to_string().as_bytes()).expect("the save loads");
    for kind in [Kind::RentalStudio, Kind::RentalApartment] {
        let homes: Vec<_> = loaded
            .tower
            .units
            .iter()
            .filter(|u| u.kind == kind)
            .collect();
        assert_eq!(homes.len(), 1, "{kind:?}");
        assert_eq!(homes[0].floor, 0, "{kind:?} left the basement");
    }
    for _ in 0..30 {
        loaded.tick(2.0);
    }
    let kept = loaded
        .tower
        .units
        .iter()
        .filter(|u| u.kind.is_rental() && u.floor == 0)
        .count();
    assert_eq!(kept, 2, "play removed a basement home");
}

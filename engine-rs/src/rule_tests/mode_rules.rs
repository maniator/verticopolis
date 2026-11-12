//! The named Classic/Modern rules that replaced direct mode checks
//! (#1976): each rule's answer per mode, and the state a new game takes
//! from them.

use super::*;

const MODES: [GameMode; 2] = [GameMode::Classic, GameMode::Modern];

#[test]
fn each_named_rule_answers_per_mode() {
    for mode in MODES {
        let classic = mode == GameMode::Classic;
        assert_eq!(mode.reserves_top_floor_for_wedding_hall(), classic);
        assert_eq!(mode.keeps_preserved_basement_stops(), classic);
        assert_eq!(mode.lets_player_choose_calendar(), !classic);
        assert_eq!(mode.escalators_on_office_floors(), !classic);
        assert_eq!(mode.housekeeping_sends_nearest_crew(), !classic);
        assert_eq!(mode.advises_on_retail_demand(), !classic);
    }
}

#[test]
fn a_new_game_takes_its_mode_rules() {
    for mode in MODES {
        let sim = Simulation::new(1, mode, CalendarKind::Canon, true);
        assert_eq!(
            sim.tower.allows_escalator_on_office_floors,
            mode.escalators_on_office_floors()
        );
        // Classic always bridges and stores no calendar choice; Modern keeps
        // the player's choice of both.
        assert_eq!(sim.auto_bridge, !mode.bridging_toggleable());
        let expected_calendar = if mode.lets_player_choose_calendar() {
            CalendarKind::Canon
        } else {
            CalendarKind::RealWorld
        };
        assert_eq!(sim.modern_calendar, expected_calendar);
    }
}

#[test]
fn each_mode_prices_a_room_by_one_rent_model() {
    use crate::econ::{classic_ladder, rent_config};
    use crate::rules::RentModel;
    for kind in [
        Kind::Office,
        Kind::Condo,
        Kind::HotelSingle,
        Kind::HotelDouble,
        Kind::HotelSuite,
        Kind::FitnessClub,
        Kind::Clinic,
        Kind::RentalStudio,
        Kind::RentalApartment,
        Kind::Lobby,
    ] {
        // Classic prices on the canon ladder and nothing else: a kind with no
        // canon rungs has no price there.
        match GameMode::Classic.rent_model(kind) {
            Some(RentModel::Ladder(rungs)) => assert_eq!(Some(rungs), classic_ladder(kind)),
            Some(RentModel::Band(_)) => panic!("Classic offered a band for {kind:?}"),
            None => assert!(classic_ladder(kind).is_none(), "{kind:?}"),
        }
        // Modern prices every tuned kind on its band.
        match GameMode::Modern.rent_model(kind) {
            Some(RentModel::Band(band)) => {
                let tuned = rent_config(kind).expect("a band comes from the tuned table");
                assert_eq!(
                    (band.default, band.min, band.max),
                    (tuned.default, tuned.min, tuned.max)
                );
            }
            Some(RentModel::Ladder(_)) => panic!("Modern offered a ladder for {kind:?}"),
            None => assert!(rent_config(kind).is_none(), "{kind:?}"),
        }
    }
    assert!(GameMode::Classic.prices_on_ladder());
    assert!(!GameMode::Modern.prices_on_ladder());
    // Move-out repricing expects every mode to price a condo.
    for mode in MODES {
        assert!(mode.rent_model(Kind::Condo).is_some(), "{mode:?}");
    }
}

#[test]
fn only_modern_film_rules_list_ticket_prices() {
    assert!(GameMode::Classic.ticket_prices().is_empty());
    assert_eq!(GameMode::Classic.ticket_price_default(), None);
    let keys: Vec<_> = GameMode::Modern
        .ticket_prices()
        .iter()
        .map(|p| p.key)
        .collect();
    assert_eq!(keys, ["low", "normal", "high", "premium"]);
    assert_eq!(GameMode::Modern.ticket_price_default(), Some("normal"));
}

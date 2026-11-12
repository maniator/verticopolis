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

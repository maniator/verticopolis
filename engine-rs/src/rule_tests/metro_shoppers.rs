//! The metro brings shoppers into the basement, so its platform counts as a
//! place shoppers arrive, like a lobby, for the "too far from a lobby" rule
//! that halves a shop's trade. The wiki puts SimTower's station on B8 to B10
//! and names B7 to B9 the best basement floors for retail, while B5 and B6
//! get no help from the metro. The reported case: a cinema on B7, right over
//! the station, said it was too far from a lobby and lost half its trade.
//! Classic counts the platform only while its floor has transport, as the
//! metro's other help to business does (`metro_help_needs_service`).
use crate::clock::{Clock, GameMode};
use crate::demand::compute_demand_map;
use crate::facilities::{Kind, MIN_FLOOR};
use crate::sim::Simulation;
use crate::sim_loop::Weather;
use crate::tower::UnitState;

use super::stocked_services::lay_basement;
use super::{lay_row, put, MID};

/// SimTower's B10, the metro's tunnel row. The platform is the story above.
const STATION: i64 = MIN_FLOOR;
const PLATFORM: i64 = STATION + 1;

/// Basement floor `n` (B1 is floor 0).
pub(super) const fn b(n: i64) -> i64 {
    1 - n
}

/// A tower with a ground lobby, floor 2, a basement down to B10 and a metro
/// station on B8 to B10. One elevator runs from B7 to floor 2. With
/// `platform_served`, a second runs from the platform to the lobby.
pub(super) fn metro_tower(mode: GameMode, platform_served: bool) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e12;
    sim.star = 5;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    lay_basement(&mut sim, STATION);
    put(&mut sim, Kind::Metro, STATION, 0);
    assert_eq!(PLATFORM, b(9));
    assert!(sim.build_transport(Kind::ElevatorStandard, MID, b(7), 2).ok);
    if platform_served {
        assert!(
            sim.build_transport(Kind::ElevatorStandard, MID + 60, PLATFORM, 1)
                .ok
        );
    }
    sim
}

/// The card's "too far from a lobby" fact, as the frontend reads it.
fn lobby_far(sim: &mut Simulation, id: i64) -> Option<bool> {
    let facts = serde_json::to_value(sim.service_diagnostic_facts(id).unwrap()).unwrap();
    facts["commercial"]["lobbyFar"].as_bool()
}

#[test]
fn the_wiki_basement_bands_follow_the_metro_platform() {
    let mut sim = metro_tower(GameMode::Classic, true);
    assert_eq!(sim.shopper_metro_platform(), Some(PLATFORM));
    let near_ground = put(&mut sim, Kind::Shop, b(2), 40);
    let b3 = put(&mut sim, Kind::Shop, b(3), 40);
    let b5 = put(&mut sim, Kind::Shop, b(5), 40);
    let b6 = put(&mut sim, Kind::Restaurant, b(6), 40);
    let cinema = put(&mut sim, Kind::Cinema, b(7), 120);
    let b8 = put(&mut sim, Kind::Shop, b(8), 40);
    let b9 = put(&mut sim, Kind::FastFood, b(9), 40);
    assert_eq!(
        lobby_far(&mut sim, near_ground),
        Some(false),
        "B2 by the lobby"
    );
    assert_eq!(lobby_far(&mut sim, b3), Some(true), "B3");
    assert_eq!(lobby_far(&mut sim, b5), Some(true), "B5");
    assert_eq!(lobby_far(&mut sim, b6), Some(true), "B6");
    assert_eq!(lobby_far(&mut sim, cinema), Some(false), "the B7 cinema");
    assert_eq!(lobby_far(&mut sim, b8), Some(false), "B8");
    assert_eq!(lobby_far(&mut sim, b9), Some(false), "B9, the platform");
}

#[test]
fn a_classic_metro_without_transport_brings_no_shoppers_and_modern_needs_none() {
    let mut classic = metro_tower(GameMode::Classic, false);
    assert_eq!(classic.shopper_metro_platform(), None);
    let shop = put(&mut classic, Kind::Shop, b(7), 40);
    assert_eq!(lobby_far(&mut classic, shop), Some(true));

    let mut modern = metro_tower(GameMode::Modern, false);
    assert_eq!(modern.shopper_metro_platform(), Some(PLATFORM));
    let shop = put(&mut modern, Kind::Shop, b(7), 40);
    assert_eq!(lobby_far(&mut modern, shop), Some(false));
}

#[test]
fn a_shop_by_a_working_platform_takes_its_full_trade() {
    // The same B7 shop, an hour of trade with the platform served and
    // without, read as its shoppers. The metro's tower-wide demand bonus moves the shop's demand
    // fraction too, so each take is read per unit of demand. The traffic
    // factor draws from the same seed in both towers.
    let take_per_demand = |platform_served: bool| {
        let mut sim = metro_tower(GameMode::Classic, platform_served);
        for x in [10, 30, 50] {
            let id = put(&mut sim, Kind::Office, 2, x);
            sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
        }
        let shop = put(&mut sim, Kind::Shop, b(7), MID + 10);
        sim.tower.get_unit_mut(shop).unwrap().state = UnitState::Occupied;
        sim.weather = Weather::Clear;
        sim.clock = Clock::new(12.0 * 60.0, sim.clock.calendar);
        let frac = compute_demand_map(&mut sim).fraction_by_unit[&shop];
        assert!(frac > 0.0, "the offices reach the shop");
        sim.collect_traffic_income();
        // The hour's takings, paid out and still pending: the shoppers
        // come in person now, so the takings carry the trade's multipliers.
        let u = sim.tower.get_unit(shop).unwrap();
        (u.extras().profit_today.unwrap_or(0.0) + u.pending_income) / frac
    };
    let full = take_per_demand(true);
    let halved = take_per_demand(false);
    assert!(halved > 0.0);
    assert!((full / halved - 2.0).abs() < 1e-9, "{full} / {halved}");
}

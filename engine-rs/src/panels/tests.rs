//! Native tests for the panel getters on scripted towers: each getter's
//! refusals and edge cases. The differential test against the TypeScript
//! functions (`src/tests/integration/panelGettersWasm.integration.test.ts`)
//! covers the conformance corpus. The overlay, household and read-only tests
//! are in `tests_overlays.rs`.

use serde_json::{json, Value};

use super::heatmap::HeatmapMode;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A funded tower with a lobby strip and floors up to `top`, ready for rooms.
pub(super) fn founded(mode: GameMode, top: i64) -> Simulation {
    let mut sim = Simulation::new_game(7, mode);
    sim.money = 1.0e9;
    sim.star = 5;
    for x in 150..230 {
        put(&mut sim, Kind::Lobby, 1, x);
    }
    for fl in 2..=top {
        for x in 151..229 {
            put(&mut sim, Kind::Floor, fl, x);
        }
    }
    sim
}

pub(super) fn put(sim: &mut Simulation, kind: Kind, floor: i64, x: i64) {
    let r = sim.build(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor},{x}: {:?}", r.reason);
}

pub(super) fn shaft(sim: &mut Simulation, kind: Kind, x: i64, bottom: i64, top: i64) {
    let r = sim.build_transport(kind, x, bottom, top);
    assert!(r.ok, "{kind:?} {bottom}-{top} at {x}: {:?}", r.reason);
}

pub(super) fn id_at(sim: &Simulation, floor: i64, x: i64) -> i64 {
    sim.tower.unit_at(floor, x).expect("a unit there").id
}

/// The heat cells as JSON, the way the binding hands them out.
pub(super) fn heat(sim: &Simulation, mode: HeatmapMode) -> Value {
    serde_json::from_str(&sim.floor_heatmap_json(mode)).expect("heat cells are JSON")
}

pub(super) fn settle(sim: &mut Simulation, hours: i64) {
    for _ in 0..hours {
        sim.tick(60.0);
    }
}

#[test]
fn a_new_tower_reads_empty_everywhere() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = Simulation::new_game(3, mode);
        let stats = sim.tower_stats();
        assert_eq!(stats["population"], 0);
        assert_eq!(stats["offices"], 0);
        assert_eq!(stats["floors"], 1);
        assert_eq!(stats["basements"], 0);
        assert_eq!(stats["elevators"], 0);
        assert_eq!(sim.unit_detail(1), None);
        assert_eq!(sim.transport_detail(1), None);
        assert_eq!(sim.elevator_stats(), json!([]));
        assert_eq!(
            sim.peak_congestion_hotspot(),
            json!({ "ratio": 0.0, "floor": null })
        );
        for overlay in [
            HeatmapMode::Congestion,
            HeatmapMode::Occupancy,
            HeatmapMode::Satisfaction,
            HeatmapMode::Cleanliness,
        ] {
            assert_eq!(heat(&sim, overlay), json!([]));
        }
        assert_eq!(
            sim.onboarding_facts(),
            json!({ "lobby": false, "floor": false, "office": false, "connect": false, "play": false })
        );
        let report = sim.stats_report();
        assert_eq!(report["strandedFloors"], json!([]));
        assert_eq!(report["income"]["hasData"], false);
        assert_eq!(report["housekeepingReport"], Value::Null);
        assert_eq!(report["households"]["households"], 0);
    }
}

#[test]
fn the_onboarding_facts_follow_the_five_steps() {
    let mut sim = Simulation::new_game(3, GameMode::Classic);
    let facts = |sim: &Simulation| sim.onboarding_facts();
    for x in 150..230 {
        put(&mut sim, Kind::Lobby, 1, x);
    }
    assert_eq!(facts(&sim)["lobby"], true);
    assert_eq!(facts(&sim)["floor"], false);
    for x in 151..229 {
        put(&mut sim, Kind::Floor, 2, x);
    }
    assert_eq!(facts(&sim)["floor"], true);
    put(&mut sim, Kind::Office, 2, 160);
    assert_eq!(facts(&sim)["office"], true);
    assert_eq!(facts(&sim)["connect"], false, "no transport yet");
    shaft(&mut sim, Kind::ElevatorStandard, 151, 1, 2);
    assert_eq!(facts(&sim)["connect"], true);
    assert_eq!(facts(&sim)["play"], false);
    let id = id_at(&sim, 2, 160);
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    assert_eq!(facts(&sim)["play"], true);
}

#[test]
fn tower_stats_count_each_family() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    put(&mut sim, Kind::Office, 2, 170);
    put(&mut sim, Kind::Condo, 2, 210);
    put(&mut sim, Kind::HotelSingle, 3, 160);
    put(&mut sim, Kind::Shop, 3, 170);
    shaft(&mut sim, Kind::ElevatorStandard, 152, 1, 3);
    shaft(&mut sim, Kind::Stairs, 158, 1, 2);
    settle(&mut sim, 3 * 24);
    let a = id_at(&sim, 2, 160);
    let b = id_at(&sim, 2, 170);
    let hotel = id_at(&sim, 3, 160);
    sim.tower.get_unit_mut(a).unwrap().state = UnitState::Occupied;
    sim.tower.get_unit_mut(b).unwrap().state = UnitState::Empty;
    sim.tower.get_unit_mut(b).unwrap().no_rate = true;
    sim.tower.get_unit_mut(hotel).unwrap().state = UnitState::Dirty;
    let s = sim.tower_stats();
    assert_eq!(s["offices"], 2);
    assert_eq!(s["occupiedOffices"], 1);
    assert_eq!(s["vacant"], 1);
    assert_eq!(s["vacantNoRate"], 1);
    assert_eq!(s["condos"], 1);
    assert_eq!(s["hotelRooms"], 1);
    assert_eq!(s["dirty"], 1);
    assert_eq!(s["occupiedHotel"], 0);
    assert_eq!(s["shops"], 1);
    assert_eq!(s["elevators"], 1);
    assert_eq!(s["transports"], 2);
    assert_eq!(s["floors"], 3);
}

#[test]
fn a_basement_only_extent_counts_the_basements() {
    let mut sim = founded(GameMode::Classic, 2);
    // Floors below the lobby: the deepest unit sets the basement count.
    for x in 151..160 {
        put(&mut sim, Kind::Floor, 0, x);
    }
    for x in 151..160 {
        put(&mut sim, Kind::Floor, -1, x);
    }
    let s = sim.tower_stats();
    assert_eq!(s["basements"], 2, "floors 0 and -1 are two basements");
}

#[test]
fn a_lobby_with_only_basements_below_reads_its_depth_and_nothing_above() {
    let mut sim = Simulation::new_game(9, GameMode::Classic);
    sim.money = 1.0e9;
    for x in 150..230 {
        put(&mut sim, Kind::Lobby, 1, x);
    }
    for fl in [0, -1, -2] {
        for x in 151..160 {
            let r = sim.build(Kind::Floor, fl, x);
            assert!(r.ok, "floor {fl} at {x}: {:?}", r.reason);
        }
    }
    let s = sim.tower_stats();
    assert_eq!(s["basements"], 3);
    assert_eq!(s["floors"], 1, "nothing above the lobby");
    assert_eq!(s["offices"], 0);
    let facts = sim.onboarding_facts();
    assert_eq!(facts["lobby"], true);
    assert_eq!(facts["floor"], false, "no floor at 2 or above");
    let cells = heat(&sim, HeatmapMode::Congestion);
    assert_eq!(
        cells.as_array().unwrap().len(),
        4,
        "the lobby and three basement floors"
    );
}

#[test]
fn the_income_breakdown_averages_the_running_day_before_a_day_ends() {
    let mut sim = Simulation::new_game(5, GameMode::Modern);
    assert_eq!(sim.income_breakdown()["hasData"], false);
    sim.ledger.record("offices", 300.0);
    sim.ledger.record("upkeep", -100.0);
    let b = sim.income_breakdown();
    assert_eq!(b["hasData"], true);
    assert_eq!(b["averages"]["offices"], 300.0);
    assert_eq!(b["averages"]["upkeep"], -100.0);
    assert_eq!(b["averages"]["food"], 0.0);
    sim.ledger.end_day();
    sim.ledger.record("offices", 100.0);
    sim.ledger.end_day();
    let b = sim.income_breakdown();
    assert_eq!(b["averages"]["offices"], 200.0, "two finished days average");
    assert_eq!(b["averages"]["upkeep"], -50.0);
}

#[test]
fn star_progress_reports_gate_ids_and_the_tower_rung() {
    let mut sim = founded(GameMode::Modern, 3);
    sim.star = 3;
    let next = sim.next_star_requirements();
    assert_eq!(next["star"], 4);
    assert_eq!(next["isTower"], false);
    assert_eq!(next["popNeed"], 5000);
    assert_eq!(next["popMet"], false);
    let ids: Vec<&str> = next["gates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["security", "medical", "recycling", "suites", "vip"]);
    assert_eq!(next["allMet"], false);
    assert_eq!(sim.next_star_threshold(), Some(5000));

    sim.star = 5;
    let tower = sim.next_star_requirements();
    assert_eq!(tower["star"], 6);
    assert_eq!(tower["isTower"], true);
    assert_eq!(tower["popNeed"], 15000);
    let ids: Vec<&str> = tower["gates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["weddingHall", "metro"]);
    assert_eq!(sim.next_star_threshold(), None);

    sim.star = 6;
    assert_eq!(sim.next_star_requirements(), Value::Null);
    assert_eq!(sim.next_star_threshold(), None);

    sim.star = 1;
    let early = sim.next_star_requirements();
    assert_eq!(early["star"], 2);
    assert_eq!(early["gates"], json!([]), "2 stars is population only");
}

#[test]
fn milestones_report_the_saved_set_in_table_order() {
    let mut sim = Simulation::new_game(2, GameMode::Classic);
    let p = sim.milestone_progress();
    assert_eq!(p["total"], 11);
    assert_eq!(p["achieved"], 0);
    assert_eq!(p["list"][0]["id"], "pop-500");
    sim.milestones.push("metro".to_string());
    let p = sim.milestone_progress();
    assert_eq!(p["achieved"], 1);
    let metro = p["list"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "metro")
        .unwrap();
    assert_eq!(metro["done"], true);
}

#[test]
fn housekeeping_coverage_counts_reach_dirt_and_infestation() {
    let mut sim = founded(GameMode::Modern, 4);
    put(&mut sim, Kind::HotelSingle, 3, 160);
    put(&mut sim, Kind::HotelSingle, 3, 170);
    put(&mut sim, Kind::HotelSingle, 4, 160);
    put(&mut sim, Kind::Housekeeping, 3, 180);
    shaft(&mut sim, Kind::ElevatorStandard, 152, 1, 4);
    settle(&mut sim, 4 * 24);
    let room = id_at(&sim, 3, 160);
    let far = id_at(&sim, 4, 160);
    let quiet = id_at(&sim, 3, 170);
    sim.tower.get_unit_mut(room).unwrap().state = UnitState::Dirty;
    sim.tower.get_unit_mut(far).unwrap().state = UnitState::Infested;
    sim.tower.get_unit_mut(quiet).unwrap().state = UnitState::Empty;
    let cov = sim.housekeeping_coverage();
    assert_eq!(cov.crews, 1);
    assert_eq!(cov.maids, 6);
    assert_eq!(cov.daily_capacity, 6 * 19);
    assert_eq!(cov.rooms, 3);
    assert_eq!(cov.dirty, 1);
    assert_eq!(cov.infested, 1);
    // Floor 4 has no crew and no service-elevator link to floor 3.
    assert_eq!(cov.out_of_reach, 1);
    assert_eq!(cov.to_json()["outOfReach"], 1);

    let cells = heat(&sim, HeatmapMode::Cleanliness);
    let cells = cells.as_array().unwrap();
    let tint_of = |floor: i64| {
        cells
            .iter()
            .find(|c| c["floor"] == floor)
            .map(|c| (c["severity"].clone(), c["tint"].clone()))
    };
    assert_eq!(tint_of(4), Some((json!(0.85), json!("infested"))));
    assert_eq!(
        tint_of(3),
        Some((json!(0.6), Value::Null)),
        "a reachable dirty room is amber"
    );
}

#[test]
fn a_floor_only_a_long_stair_climb_reaches_is_stranded() {
    let mut sim = founded(GameMode::Classic, 12);
    put(&mut sim, Kind::Office, 12, 160);
    let id = id_at(&sim, 12, 160);
    sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    // A chain of two-floor stair flights, a column apart each, up to floor 12.
    for (i, bottom) in (1..12).enumerate() {
        shaft(
            &mut sim,
            Kind::Stairs,
            if i % 2 == 0 { 152 } else { 162 },
            bottom,
            bottom + 1,
        );
    }
    assert!(
        sim.tower.is_floor_served(12),
        "the stairs connect it to the lobby"
    );
    assert!(
        !sim.floor_reachable(12),
        "eleven flights is past the walk budget"
    );
    let report = sim.stats_report();
    assert_eq!(report["strandedFloors"], json!([12]));
    let d = sim.unit_detail(id).unwrap();
    assert_eq!(d["served"], true);
    assert_eq!(d["reachable"], false);
}

#[test]
fn unit_detail_reports_the_card_and_refuses_a_missing_id() {
    let mut sim = founded(GameMode::Modern, 3);
    put(&mut sim, Kind::Office, 2, 160);
    put(&mut sim, Kind::Cinema, 3, 160);
    shaft(&mut sim, Kind::ElevatorStandard, 152, 1, 3);
    settle(&mut sim, 24);
    let office = id_at(&sim, 2, 160);
    let cinema = id_at(&sim, 3, 160);
    let d = sim.unit_detail(office).unwrap();
    assert_eq!(d["kind"], "office");
    assert_eq!(d["floor"], 2);
    assert_eq!(d["served"], true);
    assert_eq!(d["reachable"], true);
    assert_eq!(d["price"], 10_000.0);
    assert_eq!(d["rent"], Value::Null);
    assert_eq!(d["blockbuster"], Value::Null, "only a cinema has a film");
    sim.tower.get_unit_mut(office).unwrap().no_rate = true;
    assert_eq!(
        sim.unit_detail(office).unwrap()["price"],
        0.0,
        "No Rate charges nothing"
    );
    sim.tower.get_unit_mut(office).unwrap().no_rate = false;
    sim.tower.get_unit_mut(office).unwrap().rent = Some(12_000.0);
    assert_eq!(sim.unit_detail(office).unwrap()["price"], 12_000.0);
    assert_eq!(sim.unit_detail(cinema).unwrap()["blockbuster"], false);
    sim.blockbusters.push(cinema as f64);
    assert_eq!(sim.unit_detail(cinema).unwrap()["blockbuster"], true);
    assert_eq!(sim.unit_detail(999_999), None);
    assert_eq!(sim.unit_detail(-1), None);
}

#[test]
fn a_classic_unset_condo_reads_the_catalog_default_not_the_economy_default() {
    let mut sim = founded(GameMode::Classic, 3);
    put(&mut sim, Kind::Condo, 2, 160);
    let id = id_at(&sim, 2, 160);
    {
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.rent = None;
        u.no_rate = false;
    }
    assert_eq!(
        sim.unit_detail(id).unwrap()["price"],
        150_000.0,
        "the Average rung, as the card's catalog shows"
    );
}

#[test]
fn the_catalog_default_matches_the_catalog_the_engine_publishes() {
    use crate::catalog::{catalog, Rent};
    for mode in [GameMode::Classic, GameMode::Modern] {
        let cat = catalog(mode);
        for f in &cat.facilities {
            let kind = Kind::parse(f.key).expect("a catalog kind");
            let want = match f.rent.as_ref() {
                Some(Rent::Ladder { default, .. }) | Some(Rent::Band { default, .. }) => {
                    Some(*default)
                }
                None => None,
            };
            assert_eq!(
                super::unit_detail::catalog_rent_default(mode, kind),
                want,
                "{kind:?} in {mode:?}"
            );
        }
    }
}

#[test]
fn transport_detail_lists_stops_and_the_telemetry_slice() {
    let mut sim = founded(GameMode::Modern, 4);
    put(&mut sim, Kind::Office, 3, 160);
    shaft(&mut sim, Kind::ElevatorStandard, 152, 1, 4);
    shaft(&mut sim, Kind::Stairs, 158, 1, 2);
    let shaft = sim.tower.transports[0].id;
    let stairs = sim.tower.transports[1].id;
    sim.tower.set_stop(shaft, 2, false);
    let d = sim.transport_detail(shaft).unwrap();
    assert_eq!(d["kind"], "elevatorStandard");
    assert_eq!(d["bottom"], 1);
    assert_eq!(d["top"], 4);
    assert_eq!(d["utilization"], Value::Null, "not sampled yet");
    assert_eq!(d["hourly"], Value::Null);
    let stops = d["stops"].as_array().unwrap();
    assert_eq!(stops.len(), 4);
    assert_eq!(stops[0]["floor"], 4, "top first");
    assert_eq!(stops[0]["endpoint"], true);
    let skipped = stops.iter().find(|s| s["floor"] == 2).unwrap();
    assert_eq!(skipped["served"], false);
    let ground = stops.iter().find(|s| s["floor"] == 1).unwrap();
    assert_eq!(ground["lobby"], true);
    settle(&mut sim, 3);
    let d = sim.transport_detail(shaft).unwrap();
    assert!(d["utilization"].is_number());
    assert_eq!(d["hourly"]["weekday"].as_array().unwrap().len(), 24);
    assert_eq!(d["origins"]["weekend"].as_array().unwrap().len(), 24);
    let s = sim.transport_detail(stairs).unwrap();
    assert_eq!(s["stops"], json!([]), "only elevators list stops");
    assert_eq!(s["utilization"], Value::Null);
    assert_eq!(s["capacity"], 8.0);
    let list = sim.elevator_stats();
    assert_eq!(
        list.as_array().unwrap().len(),
        1,
        "the stairs are not an elevator"
    );
    assert_eq!(list[0]["capacity"], 21.0);
}

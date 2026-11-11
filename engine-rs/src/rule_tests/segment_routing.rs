//! Walking only along an unbroken run of a floor (#647), from the retired
//! `segmentRouting.integration.test.ts`: a run with no path to the lobby
//! routes nowhere, a stair on the other run of a split floor cannot be
//! boarded, a gap-free floor routes as before, and on the
//! `split-tower.vctower` fixture the stranded tenant reads its own
//! no-transportation gripe, nothing above the split floor is reachable and
//! no person ever stands in the gap. The gripe's player text is
//! `satisfaction::tests::vacate_reason_text_matches_the_typescript_table`,
//! and the fixture's segments against the reference searches are
//! `crowd::graph::tests::the_fixture_towers_answer_as_the_searches_do`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::{decode_vctower, deserialize};
use crate::satisfaction::StepResult;
use crate::sim::Simulation;

use super::{shaft, strip_tower};

/// A 50-wide lobby with floor 2 split into a left run (0 to 19) and a right
/// run (30 to 49), floor 3 over the left run only, a stair from the lobby to
/// the right run and an elevator joining the left runs of floors 2 and 3.
fn split_floor_tower() -> Simulation {
    let mut sim = strip_tower(1, GameMode::Classic, 50, 1);
    for x in (0..20).chain(30..50) {
        assert!(sim.tower.place(Kind::Floor, 2, x).ok);
    }
    for x in 0..20 {
        assert!(sim.tower.place(Kind::Floor, 3, x).ok);
    }
    shaft(&mut sim, Kind::Stairs, 40, 1, 2);
    shaft(&mut sim, Kind::ElevatorStandard, 4, 2, 3);
    sim
}

#[test]
fn a_run_with_no_path_to_the_lobby_routes_nowhere() {
    let mut sim = split_floor_tower();
    let (crowd, tower) = (&mut sim.crowd, &sim.tower);
    assert!(crowd.position_reachable(tower, 2, 40));
    assert!(crowd.route(tower, 2, 1, Some(40.0), Some(25.0)).is_some());
    assert!(!crowd.position_reachable(tower, 2, 4));
    assert!(!crowd.position_reachable(tower, 3, 4));
    assert!(crowd.route(tower, 2, 1, Some(4.0), Some(25.0)).is_none());
    assert!(crowd.route(tower, 1, 3, Some(25.0), Some(4.0)).is_none());
    assert!(crowd.segment_connected(tower, 2, 40));
    assert!(!crowd.segment_connected(tower, 2, 4));
    assert!(!crowd.segment_connected(tower, 3, 4));
}

#[test]
fn a_stair_on_the_far_run_cannot_be_boarded() {
    let mut sim = split_floor_tower();
    let (crowd, tower) = (&mut sim.crowd, &sim.tower);
    assert!(crowd.reachable(tower, 1, 2, Some(25.0), Some(40.0)));
    assert!(!crowd.reachable(tower, 1, 2, Some(25.0), Some(4.0)));
    assert!(
        crowd.floor_reachable(tower, 2),
        "some run of floor 2 reaches the lobby"
    );
    assert!(!crowd.floor_reachable(tower, 3));
}

#[test]
fn a_gap_free_floor_routes_from_any_column() {
    let mut sim = strip_tower(1, GameMode::Classic, 50, 2);
    shaft(&mut sim, Kind::Stairs, 10, 1, 2);
    let (crowd, tower) = (&mut sim.crowd, &sim.tower);
    assert!(crowd.route(tower, 1, 2, Some(5.0), Some(45.0)).is_some());
    assert!(crowd.position_reachable(tower, 2, 5));
    assert!(crowd.position_reachable(tower, 2, 45));
    assert!(crowd.segment_connected(tower, 2, 45));
    let walk = crowd.route(tower, 2, 2, Some(5.0), Some(5.0)).unwrap();
    assert_eq!((walk.floors, walk.shafts), (vec![2], vec![]));
}

/// The fixture's floor 10 and the columns of its two runs' tenants: the
/// left office is stranded, the right condo is served. Its floors 2 to 50
/// are split, with the gap at columns 185 to 192.
const FIXTURE_FLOOR: i64 = 10;
const LEFT_OFFICE_X: i64 = 167;
const RIGHT_CONDO_X: i64 = 193;
const GAP: std::ops::RangeInclusive<i64> = 185..=192;

/// The fixture, compiled in from the conformance suite.
const SPLIT_TOWER: &str = include_str!("../../../conformance/fixtures/split-tower.vctower");

fn split_tower_fixture() -> Simulation {
    deserialize(&decode_vctower(SPLIT_TOWER).unwrap()).unwrap()
}

fn tenant(sim: &Simulation, kind: Kind, x: i64) -> crate::tower::Unit {
    sim.tower
        .units
        .iter()
        .find(|u| u.kind == kind && u.floor == FIXTURE_FLOOR && u.x == x)
        .unwrap_or_else(|| panic!("the fixture's {kind:?} at {x}"))
        .clone()
}

#[test]
fn the_left_tenant_of_a_served_floor_is_stranded_with_its_own_gripe() {
    let mut sim = split_tower_fixture();
    let office = tenant(&sim, Kind::Office, LEFT_OFFICE_X);
    let condo = tenant(&sim, Kind::Condo, RIGHT_CONDO_X);
    assert!(sim.tower.is_floor_served(FIXTURE_FLOOR));
    assert!(sim.position_reachable(FIXTURE_FLOOR, condo.x));
    assert!(!sim.position_reachable(FIXTURE_FLOOR, office.x));
    assert!(sim.reaches_lobby(&condo));
    assert!(!sim.reaches_lobby(&office));
    let stranded = StepResult {
        next: 0.0,
        served: false,
        cong: 0.0,
        far_walk: false,
        noisy: false,
        lobby_far: false,
        unmet_demand: false,
        unmet_cov: None,
    };
    assert_eq!(sim.dominant_gripe(&office, &stranded), Some("noTransport"));
    let mut dead = office.clone();
    dead.floor = 60;
    assert_eq!(
        sim.dominant_gripe(&dead, &stranded),
        Some("access"),
        "an unserved floor"
    );
}

#[test]
fn nothing_above_the_split_floor_is_reachable() {
    let mut sim = split_tower_fixture();
    assert!(!sim.floor_reachable(20));
    assert!(sim.crowd.route(&sim.tower, 1, 20, None, None).is_none());
}

#[test]
fn no_person_ever_stands_in_the_gap() {
    let mut sim = split_tower_fixture();
    let mut upstairs = 0;
    for _ in 0..6 * 4 {
        sim.tick(15.0);
        for p in sim.crowd.people.iter().filter(|p| p.floor >= 2) {
            upstairs += 1;
            let column = p.x.round() as i64;
            assert!(
                !GAP.contains(&column),
                "person {} on {} at x {}",
                p.id,
                p.floor,
                p.x
            );
        }
    }
    assert!(upstairs > 0, "the crowd went upstairs");
}

//! Native tests for the kept staff routes: a kept route is the one the
//! search finds, and a change to the tower drops the kept ones.

use super::*;
use crate::clock::GameMode;
use crate::crowd::routing::{bfs_route, staff_adjacency};
use crate::facilities::Kind;
use crate::sim::Simulation;

/// A lobby, floors 2 to 6 with floor 5 split in two runs, and a service
/// elevator from 2 to 5 that reaches only the left run of floor 5.
fn split_tower() -> Simulation {
    let mut sim = Simulation::new_game(5, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 5;
    for x in 150..230 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for fl in 2..=5 {
        for x in 151..229 {
            assert!(sim.build(Kind::Floor, fl, x).ok, "floor {fl} at {x}");
        }
    }
    for x in 196..229 {
        assert!(sim.build(Kind::Floor, 6, x).ok, "floor 6 at {x}");
    }
    for x in 190..196 {
        let id = sim.tower.unit_at(5, x).expect("a floor tile").id;
        assert!(sim.tower.remove_unit(id).is_some());
    }
    assert!(sim.build_transport(Kind::ElevatorService, 152, 2, 5).ok);
    sim
}

fn floors(r: &Option<Route>) -> Option<(Vec<i64>, Vec<i64>)> {
    r.as_ref().map(|r| (r.floors.clone(), r.shafts.clone()))
}

/// Each pair of segments the tower has, asked twice: both answers match the
/// search run on its own.
fn kept_routes_match_the_search(sim: &mut Simulation) {
    let Simulation {
        ref mut crowd,
        ref tower,
        ..
    } = *sim;
    let segs: Vec<i64> = (2..=6)
        .flat_map(|fl| [170.0, 210.0].map(|x| tower.seg_at(fl, Some(x))))
        .collect();
    for &a in &segs {
        for &b in &segs {
            let searched = bfs_route(staff_adjacency(crowd, tower).0, a, b);
            let first = staff_search(crowd, tower, a, b);
            let kept = staff_search(crowd, tower, a, b);
            // Parts answer a split pair without a search, as they did before.
            let expect = if parts_split(staff_adjacency(crowd, tower).1, a, b) {
                None
            } else {
                floors(&searched)
            };
            assert_eq!(floors(&first), expect, "{a} -> {b}");
            assert_eq!(floors(&kept), expect, "{a} -> {b}, kept");
        }
    }
}

#[test]
fn a_kept_staff_route_is_the_one_the_search_finds() {
    let mut sim = split_tower();
    kept_routes_match_the_search(&mut sim);
    let kept = &sim.crowd.staff_routes;
    assert_eq!(kept.revision, Some(sim.tower.revision));
    assert!(!kept.routes.is_empty(), "the routes asked are kept");
}

#[test]
fn a_change_to_the_tower_drops_the_kept_staff_routes() {
    let mut sim = split_tower();
    let (left, right) = (
        sim.tower.seg_at(5, Some(170.0)),
        sim.tower.seg_at(5, Some(210.0)),
    );
    let low = sim.tower.seg_at(2, Some(170.0));
    {
        let Simulation {
            ref mut crowd,
            ref tower,
            ..
        } = sim;
        assert!(staff_search(crowd, tower, low, left).is_some());
        assert!(
            staff_search(crowd, tower, low, right).is_none(),
            "not joined yet"
        );
    }
    // Mid-day, a second service elevator joins the right run of floor 5 to
    // floor 6, and a third joins floor 6 back down to floor 2.
    let before = sim.tower.revision;
    assert!(sim.build_transport(Kind::ElevatorService, 220, 5, 6).ok);
    assert!(sim.build_transport(Kind::ElevatorService, 200, 2, 6).ok);
    assert_ne!(sim.tower.revision, before, "a build moves the revision");
    {
        let Simulation {
            ref mut crowd,
            ref tower,
            ..
        } = sim;
        assert!(
            staff_search(crowd, tower, low, right).is_some(),
            "the kept 'no route' went with the old revision"
        );
    }
    kept_routes_match_the_search(&mut sim);
}

#[test]
fn the_kept_staff_routes_stay_under_their_cap() {
    let mut sim = split_tower();
    let Simulation {
        ref mut crowd,
        ref tower,
        ..
    } = sim;
    // Pairs the tower does not have still cost an entry each.
    for a in 0..(MOST_ROUTES as i64 + 10) {
        staff_search(crowd, tower, -a - 100, -a - 200);
    }
    assert!(crowd.staff_routes.routes.len() <= MOST_ROUTES);
}

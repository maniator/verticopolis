//! What the Modern router keeps for the step (`expected_costs`) is what it
//! would work out again: each line's cost, and each route.

use super::super::tests::tower;
use super::super::{fastest_path, join_line, Router};
use super::{cost_of, line_cost};
use crate::clock::GameMode;
use crate::crowd::line_count::Line;
use crate::crowd::routing::plan;
use crate::crowd::Route;
use crate::facilities::Kind;
use crate::rule_tests::shaft;
use crate::sim::Simulation;

/// A Modern tower with an express at column 4 and a local at column 20
/// from the lobby to floor 15, its router built for the step.
fn two_ways_up() -> (Simulation, i64, i64) {
    let mut sim = tower(GameMode::Modern, 15);
    let express = shaft(&mut sim, Kind::ElevatorExpress, 4, 1, 15);
    let local = shaft(&mut sim, Kind::ElevatorStandard, 20, 1, 15);
    sim.crowd.begin_step();
    let lobby = sim.tower.seg_at(1, Some(30.0));
    let top = sim.tower.seg_at(15, Some(30.0));
    fastest_path(&mut sim.crowd, &sim.tower, lobby, None, top).expect("a route");
    (sim, express, local)
}

fn router(sim: &mut Simulation) -> &mut Router {
    sim.crowd.router.as_mut().expect("built")
}

/// The route from the lobby to floor 15, without joining its line.
fn up(sim: &mut Simulation) -> Route {
    plan(
        &mut sim.crowd,
        &sim.tower,
        (1, Some(30.0)),
        (15, Some(30.0)),
    )
    .expect("a route")
    .0
}

/// Every link costs what its line says now, worked out fresh or kept.
fn every_link_costs_what_its_line_says(router: &mut Router) {
    for p in 0..router.links.len() {
        for i in 0..router.links[p].len() {
            let l = router.links[p][i];
            let fresh = cost_of(router, &l);
            assert_eq!(line_cost(router, &l), fresh, "worked out");
            assert_eq!(line_cost(router, &l), fresh, "kept");
        }
    }
}

#[test]
fn a_kept_line_cost_is_the_cost_its_line_gives() {
    let (mut sim, express, local) = two_ways_up();
    let r = router(&mut sim);
    let long = Line {
        riders: 60,
        oldest: 90.0,
    };
    r.waiting.insert((express, 1), long);
    r.waiting.insert((local, 1), Line::default());
    // The step's count coming in changes every line at once.
    r.step_costs.all_changed();
    every_link_costs_what_its_line_says(r);
    // A rider joining the local's line prices it again.
    for _ in 0..40 {
        let joins = Route {
            floors: vec![1, 15],
            shafts: vec![local],
        };
        join_line(&mut sim.crowd, &joins);
        every_link_costs_what_its_line_says(router(&mut sim));
    }
}

#[test]
fn a_rider_joining_a_line_forgets_the_kept_routes() {
    let (mut sim, express, local) = two_ways_up();
    // With no lines, the express is quicker, asked once or again.
    assert_eq!(up(&mut sim).shafts, vec![express]);
    assert_eq!(up(&mut sim).shafts, vec![express]);
    // Riders join the express's line until the local wins: a route kept
    // from before they joined would still say the express.
    let mut picked_local = false;
    for _ in 0..400 {
        let r = up(&mut sim);
        picked_local |= r.shafts == vec![local];
        let fresh = {
            router(&mut sim).step_costs.all_changed();
            up(&mut sim)
        };
        assert_eq!(
            (r.floors.clone(), r.shafts.clone()),
            (fresh.floors, fresh.shafts)
        );
        join_line(&mut sim.crowd, &r);
    }
    assert!(picked_local, "the line never sent anyone to the local");
}

#[test]
fn a_route_asked_again_is_the_route_a_search_finds() {
    let (mut sim, express, local) = two_ways_up();
    let r = router(&mut sim);
    r.waiting.insert(
        (express, 1),
        Line {
            riders: 25,
            oldest: 40.0,
        },
    );
    r.waiting.insert(
        (local, 8),
        Line {
            riders: 10,
            oldest: 70.0,
        },
    );
    r.step_costs.all_changed();
    let trips: Vec<(i64, i64)> = (1..=15)
        .flat_map(|a| (1..=15).map(move |b| (a, b)))
        .filter(|(a, b)| a != b)
        .collect();
    let ask = |sim: &mut Simulation| -> Vec<Option<Route>> {
        trips
            .iter()
            .map(|&(a, b)| {
                plan(&mut sim.crowd, &sim.tower, (a, Some(30.0)), (b, Some(30.0))).map(|r| r.0)
            })
            .collect()
    };
    let first = ask(&mut sim);
    let kept = ask(&mut sim);
    router(&mut sim).step_costs.all_changed();
    let searched = ask(&mut sim);
    let shape = |rs: &[Option<Route>]| -> Vec<Option<(Vec<i64>, Vec<i64>)>> {
        rs.iter()
            .map(|r| r.as_ref().map(|r| (r.floors.clone(), r.shafts.clone())))
            .collect()
    };
    assert_eq!(shape(&first), shape(&kept));
    assert_eq!(shape(&first), shape(&searched));
    assert!(
        first.iter().all(Option::is_some),
        "every floor reaches every other"
    );
}

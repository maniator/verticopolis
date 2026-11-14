//! Tests for `window.rs`: which people a windowed frame carries.
use super::super::layout::{header, person, HEADER, PERSON_RECORD};
use super::super::session_tests::at;
use super::super::ViewReader;
use super::*;
use crate::crowd::PState;
use crate::sim::Simulation;
use crate::snapshot::state_view;

/// A tower half a day into play, so it has people and shafts.
fn busy() -> Simulation {
    at("events-classic", "fire")
}

/// The ids a frame carries, in its order.
fn ids(frame: &[f64]) -> Vec<i64> {
    let n = frame[header::PEOPLE] as usize;
    (0..n)
        .map(|i| frame[HEADER + i * PERSON_RECORD + person::ID] as i64)
        .collect()
}

/// Puts every person of `sim` at (`x`, `fy`) in turn from `spots`, so a test
/// knows where each one stands. Returns their ids in crowd order.
fn place(sim: &mut Simulation, spots: &[(f64, f64)]) -> Vec<i64> {
    let template = sim.crowd.people[0].clone();
    sim.crowd.people = spots
        .iter()
        .enumerate()
        .map(|(i, &(x, fy))| {
            let mut p = template.clone();
            p.id = 9_000 + i as i64;
            p.x = x;
            p.fy = fy;
            p.floor = fy.round() as i64;
            p
        })
        .collect();
    sim.crowd.people.iter().map(|p| p.id).collect()
}

#[test]
fn a_window_with_a_bad_number_or_an_empty_range_is_no_window() {
    assert!(PeopleWindow::new(1.0, 5.0, 10.0, 40.0).is_some());
    assert!(PeopleWindow::new(f64::NAN, 5.0, 10.0, 40.0).is_none());
    assert!(PeopleWindow::new(1.0, f64::INFINITY, 10.0, 40.0).is_none());
    assert!(PeopleWindow::new(5.0, 1.0, 10.0, 40.0).is_none());
    assert!(PeopleWindow::new(1.0, 5.0, 40.0, 10.0).is_none());
}

#[test]
fn the_pads_are_one_floor_and_half_the_widest_shaft_plus_a_tile() {
    let sim = busy();
    let widest = sim.tower.transports.iter().map(|t| t.width).max().unwrap();
    assert!(widest > 0, "the fixture has shafts");
    let w = PeopleWindow::new(10.0, 20.0, 100.0, 200.0).unwrap();
    let p = w.padded(&sim.tower.transports);
    let x_pad = widest as f64 / 2.0 + 1.0;
    assert_eq!(p.floor_lo, 10.0 - FLOOR_PAD);
    assert_eq!(p.floor_hi, 20.0 + FLOOR_PAD);
    assert_eq!(p.x_lo, 100.0 - x_pad);
    assert_eq!(p.x_hi, 200.0 + x_pad);
    // A tower without shafts pads one tile.
    assert_eq!(w.padded(&[]).x_lo, 99.0);
}

/// The frame carries the people inside the padded window, in crowd order,
/// and its people count says how many; clearing the window sends all.
#[test]
fn a_windowed_frame_carries_only_the_people_in_the_window() {
    let mut sim = busy();
    let widest = sim.tower.transports.iter().map(|t| t.width).max().unwrap() as f64;
    let edge = 200.0 + widest / 2.0 + 1.0;
    let all = place(
        &mut sim,
        &[
            (150.0, 15.0),        // inside
            (edge, 15.0),         // on the padded right edge: in
            (edge + 0.5, 15.0),   // past it: out
            (150.0, 21.0),        // one floor above the top: in
            (150.0, 21.5),        // past the floor pad: out
            (99.0 - widest, 9.0), // left of the padded left edge: out
            (150.0, 9.5),         // between floors, below: in
        ],
    );
    let mut reader = ViewReader::new();
    reader.set_people_window(PeopleWindow::new(10.0, 20.0, 100.0, 200.0));
    let frame = reader.frame(&sim, false);
    assert_eq!(ids(&frame), vec![all[0], all[1], all[3], all[6]]);
    reader.set_people_window(None);
    assert_eq!(ids(&reader.frame(&sim, false)), all);
}

/// Every rider of a car whose edge is on screen comes along: a rider
/// stands at the shaft's middle, which can lie outside the window by half
/// the shaft's width.
#[test]
fn every_rider_of_a_car_at_the_window_edge_is_in_the_frame() {
    let mut sim = busy();
    let t = sim
        .tower
        .transports
        .iter()
        .max_by_key(|t| t.width)
        .unwrap()
        .clone();
    let middle = t.x as f64 + t.width as f64 / 2.0;
    let floor = t.bottom as f64;
    let riders = place(&mut sim, &[(middle, floor), (middle, floor + 0.5)]);
    for p in &mut sim.crowd.people {
        p.state = PState::Riding;
    }
    // The window's right edge is the shaft's left edge: one tile of the car
    // shows, and its middle is outside by half the width.
    let mut reader = ViewReader::new();
    reader.set_people_window(PeopleWindow::new(
        floor,
        floor,
        t.x as f64 - 50.0,
        t.x as f64,
    ));
    assert_eq!(ids(&reader.frame(&sim, false)), riders);
}

/// The window belongs to the camera: the tower's own reader keeps it
/// between frames, and stepping is the same with or without it.
#[test]
fn the_tower_reader_keeps_the_window_and_the_game_ignores_it() {
    let mut a = busy();
    let mut b = busy();
    crate::view::set_people_window(&a, PeopleWindow::new(0.0, 0.0, 0.0, 0.0));
    let first = crate::view::view_frame(&a, false);
    let second = crate::view::view_frame(&a, false);
    let all = a.crowd.people.len();
    assert!(all > 0, "the fixture has people");
    assert!((first[header::PEOPLE] as usize) < all);
    assert_eq!(first[header::PEOPLE], second[header::PEOPLE]);
    a.tick(30.0);
    b.tick(30.0);
    assert_eq!(state_view(&a), state_view(&b));
    assert_eq!(a.crowd.view(), b.crowd.view());
}

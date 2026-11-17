//! Tests for `floor_index.rs`: the bands people sit in, and the index the
//! step and a newcomer keep against a fresh build.
use super::*;
use crate::clock::GameMode;
use crate::crowd::motion::finish;
use crate::crowd::spawn::make_person;
use crate::crowd::Route;
use crate::sim::Simulation;

/// A new crowd with one person standing at each floor position in `fys`,
/// each added the way the spawn adds them.
fn crowd_at(fys: &[f64]) -> Crowd {
    let sim = Simulation::new_game(3, GameMode::Classic);
    let mut crowd = Crowd::new(5);
    crowd.by_floor.keep_from(0);
    for &fy in fys {
        let route = Route {
            floors: vec![1],
            shafts: vec![],
        };
        let i = make_person(&mut crowd, &sim.tower, route, 10.0, None);
        crowd.people[i].fy = fy;
    }
    // They moved outside a step, so the index is built again by hand.
    let people = crowd.people.clone();
    crowd.by_floor.rebuild(&people);
    crowd
}

/// Adds one person on the lobby, as the spawn does.
fn arrive(crowd: &mut Crowd) -> usize {
    let tower = Simulation::new_game(3, GameMode::Classic).tower;
    let route = Route {
        floors: vec![1],
        shafts: vec![],
    };
    make_person(crowd, &tower, route, 10.0, None)
}

/// The index built fresh from the crowd as it stands.
fn fresh(crowd: &Crowd) -> FloorIndex {
    let mut index = FloorIndex::default();
    index.keep_from(0);
    index.rebuild(&crowd.people);
    index
}

/// Every band's indices, from `lo` to `hi`.
fn bands(index: &FloorIndex, lo: i64, hi: i64) -> Vec<(i64, Vec<u32>)> {
    (lo..=hi)
        .map(|b| (b, index.in_band(b).to_vec()))
        .filter(|(_, v)| !v.is_empty())
        .collect()
}

#[test]
fn a_band_is_the_floor_at_or_below_and_the_edges_hold_the_rest() {
    assert_eq!(band(3.0), 3);
    assert_eq!(band(3.99), 3);
    assert_eq!(band(-0.5), -1);
    assert_eq!(band(-9.0), -9);
    assert_eq!(band(1e9), HIGHEST_BAND);
    assert_eq!(band(-1e9), LOWEST_BAND);
}

#[test]
fn a_newcomer_waits_outside_the_bands_until_the_next_settle() {
    let mut crowd = crowd_at(&[5.0, 2.0, 5.5]);
    assert_eq!((arrive(&mut crowd), arrive(&mut crowd)), (3, 4));
    assert_eq!(crowd.people[3].fy, 1.0);
    assert!(crowd.by_floor.agrees(&crowd.people));
    assert_eq!(crowd.by_floor.newcomers(), 3..5);
    assert_eq!(
        bands(&crowd.by_floor, -10, 10),
        vec![(2, vec![1]), (5, vec![0, 2])]
    );
    settle(&mut crowd);
    assert!(crowd.by_floor.newcomers().is_empty());
    assert_eq!(
        bands(&crowd.by_floor, -10, 10),
        vec![(1, vec![3, 4]), (2, vec![1]), (5, vec![0, 2])]
    );
    assert_eq!(
        bands(&crowd.by_floor, -10, 10),
        bands(&fresh(&crowd), -10, 10)
    );
    // An empty crowd's first newcomer fits it too.
    let mut crowd = Crowd::new(5);
    crowd.by_floor.keep_from(0);
    settle(&mut crowd);
    arrive(&mut crowd);
    assert!(crowd.by_floor.agrees(&crowd.people));
    assert_eq!(crowd.by_floor.newcomers(), 0..1);
}

#[test]
fn a_band_is_found_without_a_call_to_floor_for_any_position() {
    for k in -700..=2700 {
        let fy = k as f64 / 8.0 + 0.03;
        let want = (fy.floor() as i64).clamp(LOWEST_BAND, HIGHEST_BAND);
        assert_eq!(band(fy), want, "{fy}");
        assert_eq!(band(fy.floor()), want, "{}", fy.floor());
    }
    assert_eq!(band(f64::NAN), 0);
    assert_eq!(band(-0.0), 0);
}

#[test]
fn settling_drops_the_finished_and_rebands_everyone_in_crowd_order() {
    let mut tower = Simulation::new_game(3, GameMode::Classic).tower;
    let mut crowd = crowd_at(&[5.0, 2.0, 5.5, 9.0, -3.0]);
    finish(&mut crowd, 1, &mut tower);
    crowd.people[2].fy = -3.5;
    crowd.people[3].fy = 5.2;
    settle(&mut crowd);
    let fys: Vec<f64> = crowd.people.iter().map(|p| p.fy).collect();
    assert_eq!(fys, vec![5.0, -3.5, 5.2, -3.0]);
    assert!(crowd.by_floor.agrees(&crowd.people));
    assert_eq!(
        bands(&crowd.by_floor, -10, 10),
        vec![(-4, vec![1]), (-3, vec![3]), (5, vec![0, 2])]
    );
    // Nobody left: every band is empty, and the index still fits.
    for i in 0..crowd.people.len() {
        finish(&mut crowd, i, &mut tower);
    }
    settle(&mut crowd);
    assert!(crowd.by_floor.fits(&crowd.people));
    assert!(bands(&crowd.by_floor, LOWEST_BAND, HIGHEST_BAND).is_empty());
}

#[test]
fn an_index_a_host_went_around_does_not_fit_until_the_next_settle() {
    let mut crowd = crowd_at(&[4.0, 6.0]);
    let extra = crowd.people[0].clone();
    crowd.people.push(extra);
    assert!(!crowd.by_floor.fits(&crowd.people));
    // A newcomer after that leaves it out of step rather than guessing.
    arrive(&mut crowd);
    assert!(!crowd.by_floor.fits(&crowd.people));
    settle(&mut crowd);
    assert!(crowd.by_floor.agrees(&crowd.people));
}

#[test]
fn a_band_nobody_reached_is_empty() {
    let crowd = crowd_at(&[4.0]);
    assert!(crowd.by_floor.in_band(3).is_empty());
    assert!(crowd.by_floor.in_band(LOWEST_BAND).is_empty());
    assert!(crowd.by_floor.in_band(i64::MIN / 2).is_empty());
    assert_eq!(crowd.by_floor.in_band(4), &[0]);
}

#[test]
fn a_run_of_bands_is_one_slice_of_their_people_band_by_band() {
    let crowd = crowd_at(&[5.0, 2.0, 5.5, 9.0, -3.0, 2.5]);
    let index = &crowd.by_floor;
    assert_eq!(index.in_bands(2, 5), &[1, 5, 0, 2]);
    assert_eq!(index.in_bands(-100, 100), &[4, 1, 5, 0, 2, 3]);
    assert_eq!(index.in_bands(6, 8), &[] as &[u32]);
    assert_eq!(index.in_bands(10, 400), &[] as &[u32]);
    assert_eq!(index.in_bands(-400, -4), &[] as &[u32]);
    assert_eq!(index.in_bands(5, 2), &[] as &[u32]);
    assert_eq!(index.in_bands(i64::MIN / 2, i64::MAX / 2).len(), 6);
    assert_eq!(FloorIndex::default().in_bands(0, 10), &[] as &[u32]);
}

#[test]
fn a_crowd_under_the_indexed_size_keeps_no_index() {
    let mut crowd = Crowd::new(5);
    for _ in 0..INDEXED_FROM - 1 {
        arrive(&mut crowd);
    }
    settle(&mut crowd);
    assert!(!crowd.by_floor.fits(&crowd.people));
    // One more, and the next settle keeps it; a load builds it the same way.
    arrive(&mut crowd);
    assert!(!crowd.by_floor.fits(&crowd.people));
    settle(&mut crowd);
    assert!(crowd.by_floor.agrees(&crowd.people));
    assert_eq!(crowd.by_floor.in_band(1).len(), INDEXED_FROM);
    let people = crowd.people.clone();
    crowd.by_floor.rebuild(&people[..INDEXED_FROM - 1]);
    assert!(!crowd.by_floor.fits(&people[..INDEXED_FROM - 1]));
    crowd.by_floor.rebuild(&people);
    assert!(crowd.by_floor.agrees(&people));
}

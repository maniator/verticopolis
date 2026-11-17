//! The walk along the floor a route starts on, which the Modern router
//! (`expected_time`) prices: from where the rider stands to the first shaft,
//! stair or escalator they take. The transit graph keeps a floor's run as
//! one node, so without it a rider at one end of a long lobby took a shaft at
//! the far end as readily as the one beside them, and the oldest of two like
//! shafts won every tie (owner, 2026-11-17).
//!
//! The walk is laid on the start's links for one search and taken off after
//! (`search_from`), so the search's loop reads nothing more. It only ever
//! adds to a link's cost, so the A* bound, which counts no walk, stays one
//! the search never overtakes, and the search still finds the cheapest
//! route. The walks between legs and at the far end stay free: pricing the
//! far end opened a third more of the graph per search (5.7% more work on a
//! 7,000-person tower), and between legs the graph does not know which shaft
//! a rider stepped off.

use super::super::Route;
use super::{search, tenths, Link, Move, Node, Router};
use crate::crowd::fasthash::FastMap;
use crate::crowd::WALK_SPEED;
use crate::tower::Tower;

/// How much of the walk's time a rider counts against a wait. At the whole
/// walk, riders crowded the shaft nearest them and its full cars passed the
/// floors below; at half, waits were shortest on both of the owner's split
/// towers (a game day each: the mean wait 11% and 31% under main's, a
/// quarter and over half fewer riders waiting past half an hour, and the
/// longest wait no longer). A quarter and three quarters both did worse.
const WALK_WEIGHT: f64 = 0.5;

/// Where each passenger shaft stands, and the walks laid for the search
/// under way.
pub(super) struct Walks {
    /// Each passenger shaft, stair and escalator by id: the middle of its
    /// width, where a rider walks to board it.
    spots: FastMap<i64, f64>,
    /// By place, each start's boarding and climbing links with the spot
    /// each walks to, read once per tower revision so a search looks up no
    /// shaft (HP-3).
    starts: Vec<Option<Box<[(u32, f64)]>>>,
    /// (place, link index, tenths) for each walk laid, to take off again.
    laid: Vec<(u32, u32, i64)>,
}

impl Walks {
    pub(super) fn new(tower: &Tower) -> Self {
        let mut spots = FastMap::default();
        let passengers = tower.transports.iter();
        for t in passengers.filter(|t| !t.kind.is_staff_only_transport()) {
            spots.insert(t.id, t.x as f64 + t.width as f64 / 2.0);
        }
        Walks {
            spots,
            starts: Vec::new(),
            laid: Vec::new(),
        }
    }
}

/// The key a kept route is filed under: its start and goal places and the
/// tile the rider stands on along the start's floor, since the same two
/// places from another spot may take another way. The walk is priced from
/// that tile too (`lay`), so riders on one tile share a kept route: keyed by
/// the exact spot, almost no search was ever kept (5 of 1,295 kept searches
/// on a reference Modern tower).
pub(super) fn route_key(start: u32, goal: u32, x: Option<f64>) -> (u32, u32, u64) {
    (start, goal, x.map_or(u64::MAX, |x| x.floor().to_bits()))
}

/// Searches from place `start`, standing at `x` on its floor, to `goal`,
/// with the walk to each first shaft laid on for this search only.
pub(super) fn search_from(router: &mut Router, start: u32, x: Option<f64>, goal: u32) -> bool {
    lay(router, start, x);
    let found = search(router, start, goal);
    lift(router);
    found
}

/// Lays the walk from `x` onto each link boarding or climbing from the node
/// at place `start`, keeping each to take off again.
fn lay(router: &mut Router, start: u32, x: Option<f64>) {
    let Some(x) = x.map(f64::floor) else {
        return;
    };
    let s = start as usize;
    let Router { links, walks, .. } = router;
    let Walks {
        spots,
        starts,
        laid,
    } = walks;
    if starts.len() <= s {
        starts.resize_with(s + 1, || None);
    }
    let boards = starts[s].get_or_insert_with(|| boards_from(&links[s], spots));
    for &(i, spot) in boards.iter() {
        let walk = tenths(WALK_WEIGHT * (x - spot).abs() / WALK_SPEED);
        links[s][i as usize].tenths += walk;
        laid.push((start, i, walk));
    }
}

/// The links out of a start that board or climb a passenger transport, by
/// index, with the spot along the floor each walks to.
fn boards_from(links: &[Link], spots: &FastMap<i64, f64>) -> Box<[(u32, f64)]> {
    let spot = |l: &Link| match l.how {
        Move::Board { shaft, .. } | Move::Flight { shaft } => spots.get(&shaft).copied(),
        _ => None,
    };
    let found = links.iter().enumerate();
    found
        .filter_map(|(i, l)| Some((i as u32, spot(l)?)))
        .collect()
}

/// Takes the walks `lay` laid off the graph again.
fn lift(router: &mut Router) {
    for (from, i, walk) in router.walks.laid.drain(..) {
        router.links[from as usize][i as usize].tenths -= walk;
    }
}

/// The segment id of the node at `place`. Only a segment's place is asked:
/// a route starts and ends on one, and a rider boards and climbs from one.
pub(super) fn segment(router: &Router, place: u32) -> i64 {
    match router.nodes[place as usize] {
        Node::Segment(s) => s,
        Node::Car(..) => unreachable!("a car node read as a segment"),
    }
}

/// The route as segments and the shaft of each leg, from the search's trail.
pub(super) fn walk_back(router: &Router, start: u32, goal: u32) -> Route {
    let seg = |p: u32| segment(router, p);
    // Counts the legs first, so each list is allocated once at its size.
    let (mut legs, mut cur) = (0, goal);
    while cur != start {
        let (back, how) = router.prev[cur as usize];
        legs += usize::from(matches!(how, Move::Flight { .. } | Move::Alight { .. }));
        cur = back;
    }
    let mut floors = Vec::with_capacity(legs + 1);
    floors.push(seg(goal));
    let mut shafts = Vec::with_capacity(legs);
    let mut cur = goal;
    while cur != start {
        let (back, how) = router.prev[cur as usize];
        match how {
            Move::Flight { shaft } => {
                shafts.push(shaft);
                floors.push(seg(back));
            }
            Move::Alight { shaft } => shafts.push(shaft),
            Move::Board { .. } => floors.push(seg(back)),
            Move::Ride | Move::Street => {}
        }
        cur = back;
    }
    floors.reverse();
    shafts.reverse();
    Route { floors, shafts }
}

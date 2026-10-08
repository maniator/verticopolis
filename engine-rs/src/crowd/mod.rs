//! Port of `src/engine/Crowd.ts` and `crowd/person.ts`: the drawn people,
//! which saves never carry. The conformance suite hashes them separately.

pub mod banks;
pub mod graph;
pub mod landing;
pub mod meals;
pub mod motion;
pub mod routines;
pub mod routing;
pub mod spawn;
pub mod visits;
pub mod walk;

use std::collections::{HashMap, HashSet};

use serde_json::{json, Map, Value};

use crate::facilities::Kind;
use crate::rng::Rng;
use crate::tower::Tower;

pub const CROWD_SECONDS_PER_MINUTE: f64 = 2.0;
pub const WALK_SPEED: f64 = 6.0;
pub const CAR_CAPACITY: i64 = 12;
pub const MAX_PEOPLE: usize = 140;
pub const EAT_SECONDS_MIN: i64 = 30 * 2;
pub const EAT_SECONDS_MAX: i64 = 60 * 2;
pub const METRO_DWELL_MIN: i64 = 8;
pub const METRO_DWELL_MAX: i64 = 24;
pub const STRESS_WAIT: f64 = 25.0;
pub const COMMUTE_STRESS_ALPHA: f64 = 0.15;
pub const GIVE_UP: f64 = 120.0;
pub const STAFF_GIVE_UP: f64 = GIVE_UP * 3.0;
/// `CROWD_SECONDS_PER_MINUTE / CAR_FLOORS_PER_MINUTE`.
pub const RIDE_SECONDS_PER_FLOOR: f64 = 2.0 / 0.8;

/// `dwellSecondsRange`.
pub fn dwell_seconds_range(kind: Option<Kind>) -> (i64, i64) {
    let m = match kind {
        Some(Kind::Cinema) => Some((90, 120)),
        Some(Kind::PartyHall) => Some((60, 120)),
        Some(Kind::WeddingHall) => Some((120, 180)),
        Some(Kind::AquaticCenter) => Some((60, 120)),
        _ => None,
    };
    match m {
        None => (EAT_SECONDS_MIN, EAT_SECONDS_MAX),
        Some((a, b)) => (a * 2, b * 2),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PState {
    ToShaft,
    Waiting,
    Riding,
    Climbing,
    ToDest,
    Dwelling,
    Done,
}

impl PState {
    pub fn as_str(self) -> &'static str {
        match self {
            PState::ToShaft => "toShaft",
            PState::Waiting => "waiting",
            PState::Riding => "riding",
            PState::Climbing => "climbing",
            PState::ToDest => "toDest",
            PState::Dwelling => "dwelling",
            PState::Done => "done",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Person {
    pub id: i64,
    pub seed: i32,
    pub state: PState,
    pub floor: i64,
    pub fy: f64,
    pub x: f64,
    pub floors: Vec<i64>,
    pub origin_floor: i64,
    pub shafts: Vec<i64>,
    pub leg: usize,
    pub shaft_id: Option<i64>,
    pub car_index: Option<i64>,
    pub dest_x: f64,
    pub wait: f64,
    pub trip_wait: f64,
    pub age: f64,
    pub linger: f64,
    pub staff: bool,
    pub clean_unit_id: Option<i64>,
    pub meal_venue_id: Option<i64>,
    pub venue_unit_id: Option<i64>,
    pub counted_hotel_guest: bool,
    pub origin_unit_id: Option<i64>,
    pub dwell_seconds_left: Option<f64>,
    pub returning: bool,
    pub routine: Option<&'static str>,
    pub linger_for: Option<f64>,
}

impl Person {
    /// The `Person` shape with only the fields that are set.
    pub fn to_json(&self) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("seed".into(), json!(self.seed));
        m.insert("state".into(), json!(self.state.as_str()));
        m.insert("floor".into(), json!(self.floor));
        m.insert("fy".into(), json!(self.fy));
        m.insert("x".into(), json!(self.x));
        m.insert("floors".into(), json!(self.floors));
        m.insert("originFloor".into(), json!(self.origin_floor));
        m.insert("shafts".into(), json!(self.shafts));
        m.insert("leg".into(), json!(self.leg));
        m.insert("shaftId".into(), json!(self.shaft_id));
        m.insert("carIndex".into(), json!(self.car_index));
        m.insert("destX".into(), json!(self.dest_x));
        m.insert("wait".into(), json!(self.wait));
        m.insert("tripWait".into(), json!(self.trip_wait));
        m.insert("age".into(), json!(self.age));
        m.insert("linger".into(), json!(self.linger));
        if self.staff {
            m.insert("staff".into(), json!(true));
        }
        if let Some(v) = self.clean_unit_id {
            m.insert("cleanUnitId".into(), json!(v));
        }
        if let Some(v) = self.meal_venue_id {
            m.insert("mealVenueId".into(), json!(v));
        }
        if let Some(v) = self.venue_unit_id {
            m.insert("venueUnitId".into(), json!(v));
        }
        if self.counted_hotel_guest {
            m.insert("countedHotelGuest".into(), json!(true));
        }
        if let Some(v) = self.origin_unit_id {
            m.insert("originUnitId".into(), json!(v));
        }
        if let Some(v) = self.dwell_seconds_left {
            m.insert("dwellSecondsLeft".into(), json!(v));
        }
        if self.returning {
            m.insert("returning".into(), json!(true));
        }
        if let Some(v) = self.routine {
            m.insert("routine".into(), json!(v));
        }
        if let Some(v) = self.linger_for {
            m.insert("lingerFor".into(), json!(v));
        }
        Value::Object(m)
    }
}

#[derive(Clone, Debug)]
pub struct Route {
    pub floors: Vec<i64>,
    pub shafts: Vec<i64>,
}

#[derive(Clone, Copy, Debug)]
pub struct Edge {
    pub f: i64,
    pub shaft: i64,
    pub walk_kind: Option<Kind>,
}

pub type AdjGraph = HashMap<i64, Vec<Edge>>;

/// `ElevatorCalls`: hall (shaft -> floor -> count) and cab (shaft -> car -> floors).
#[derive(Default)]
pub struct ElevatorCalls {
    pub hall: HashMap<i64, HashMap<i64, f64>>,
    pub cab: HashMap<i64, HashMap<i64, HashSet<i64>>>,
}

pub struct StaffResult {
    pub unit_id: i64,
    pub ok: bool,
}

pub struct Crowd {
    pub people: Vec<Person>,
    pub rng: Rng,
    pub next_id: i64,
    pub spawn_acc: f64,
    /// Riders aboard each car, keyed (shaft, car).
    pub car_riders: HashMap<(i64, i64), i64>,
    pub frustration: f64,
    pub commute_wait_by_floor: HashMap<i64, f64>,
    pub adj: Option<(i64, AdjGraph)>,
    pub staff_adj: Option<(i64, AdjGraph)>,
    pub shaft_banks: Option<(i64, HashMap<(Kind, Vec<i64>, Vec<i64>), Vec<i64>>)>,
    pub seg_served: Option<(i64, HashSet<i64>)>,
    pub blockbusters: HashSet<i64>,
    pub staff_done: Vec<StaffResult>,
    pub staff_count: i64,
    pub step: i64,
}

impl Crowd {
    pub fn new(seed: u32) -> Crowd {
        Crowd {
            people: Vec::new(),
            rng: Rng::new(seed),
            next_id: 1,
            spawn_acc: 0.0,
            car_riders: HashMap::new(),
            frustration: 0.0,
            commute_wait_by_floor: HashMap::new(),
            adj: None,
            staff_adj: None,
            shaft_banks: None,
            seg_served: None,
            blockbusters: HashSet::new(),
            staff_done: Vec::new(),
            staff_count: 0,
            step: 0,
        }
    }

    /// The conformance suite's crowd channel.
    pub fn view(&self) -> Value {
        json!({
            "nextId": self.next_id,
            "rng": self.rng.seed(),
            "people": self.people.iter().map(Person::to_json).collect::<Vec<_>>(),
        })
    }

    pub fn record_commute(&mut self, origin_floor: i64, wait_seconds: f64) {
        let prev = self
            .commute_wait_by_floor
            .get(&origin_floor)
            .copied()
            .unwrap_or(wait_seconds);
        self.commute_wait_by_floor.insert(
            origin_floor,
            prev + (wait_seconds - prev) * COMMUTE_STRESS_ALPHA,
        );
    }

    pub fn begin_step(&mut self) {
        self.step += 1;
    }

    pub fn take_staff_results(&mut self) -> Vec<StaffResult> {
        std::mem::take(&mut self.staff_done)
    }

    /// `route(tower, from, to, fromX, toX)`.
    pub fn route(
        &mut self,
        tower: &Tower,
        from: i64,
        to: i64,
        from_x: Option<f64>,
        to_x: Option<f64>,
    ) -> Option<Route> {
        routing::route(self, tower, from, from_x, to, to_x)
    }

    pub fn staff_route(
        &mut self,
        tower: &Tower,
        from: i64,
        to: i64,
        from_x: Option<f64>,
        to_x: Option<f64>,
    ) -> Option<Route> {
        routing::staff_route(self, tower, from, from_x, to, to_x)
    }

    pub fn reachable(
        &mut self,
        tower: &Tower,
        from: i64,
        to: i64,
        from_x: Option<f64>,
        to_x: Option<f64>,
    ) -> bool {
        routing::reachable(self, tower, from, from_x, to, to_x)
    }

    pub fn floor_reachable(&mut self, tower: &Tower, floor: i64) -> bool {
        graph::floor_reachable_from_lobby(self, tower, floor)
    }

    pub fn position_reachable(&mut self, tower: &Tower, floor: i64, x: i64) -> bool {
        graph::position_reachable(self, tower, floor, x)
    }

    pub fn segment_connected(&mut self, tower: &Tower, floor: i64, x: i64) -> bool {
        graph::segment_connected(self, tower, floor, x)
    }

    pub fn elevator_calls(&self, tower: &Tower) -> ElevatorCalls {
        routing::elevator_calls(self, tower)
    }
}

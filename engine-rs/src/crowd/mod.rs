//! Port of the retired TypeScript `src/engine/Crowd.ts` and
//! `src/engine/crowd/person.ts`: the people in the
//! tower. A save carries them (`save`); the conformance suite hashes them as
//! their own channel.

pub(crate) mod adopt;
pub mod banks;
mod commute_stress;
pub mod commuters;
pub(crate) mod commuters_save;
pub mod doors;
pub mod expected_time;
pub(crate) mod fasthash;
pub(crate) mod floor_index;
pub mod graph;
mod hall_call;
pub mod landing;
pub mod line_count;
pub mod meals;
pub mod metro_train;
pub mod motion;
pub mod routines;
pub mod routing;
pub(crate) mod save;
pub(crate) mod seg_set;
pub mod spawn;
pub mod spawn_floors;
pub(crate) mod staff_routes;
pub mod staff_shift;
pub mod street;
pub mod trip;
pub mod visits;
pub mod walk;
pub mod walk_ins;
pub mod workplace;

pub use hall_call::HallCall;
use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::{json, Map, Value};

use crate::facilities::Kind;
use crate::rng::Rng;
use crate::tower::Tower;

pub const CROWD_SECONDS_PER_MINUTE: f64 = 2.0;
pub const WALK_SPEED: f64 = 6.0;
/// The crowd's old car size. A car now holds as many riders as its kind
/// ([`Kind::car_capacity`]); this stays for code that named it.
#[deprecated(note = "a car holds its kind's `Kind::car_capacity`")]
pub const CAR_CAPACITY: i64 = 12;
pub const MAX_PEOPLE: usize = 140;
pub const EAT_SECONDS_MIN: i64 = 30 * 2;
pub const EAT_SECONDS_MAX: i64 = 60 * 2;
pub const METRO_DWELL_MIN: i64 = 8;
pub const METRO_DWELL_MAX: i64 = 24;
pub const STRESS_WAIT: f64 = 25.0;
pub const COMMUTE_STRESS_ALPHA: f64 = 0.15;
/// The average a floor's first finished trip moves from: no wait, the value
/// a floor no trip has named already reads as (#2435). Seeding the average
/// with the first trip's own wait instead let one rider who gave up (twice
/// the mode's limit, #2019) make a quiet floor read jammed for as long as
/// the average lasts, which on a floor of shops alone is the whole hour
/// (#2433). From no wait, one trip moves the average by
/// [`COMMUTE_STRESS_ALPHA`] of its wait, so a floor needs several long waits
/// in a row before it reads backed up.
pub(crate) const COMMUTE_STRESS_PRIOR: f64 = 0.0;
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
    /// The time this trip has spent waiting for a car, the clock its
    /// patience runs on (#2386).
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
    /// Whether the trip began on a Metro platform, so its wait belongs to
    /// the tenant floor it heads for (#1971). Engine-internal.
    pub from_metro: bool,
    /// Whether this trip ran out of patience waiting to set out and turned
    /// back (`motion::advance`), so its wait counts as over the mode's limit
    /// (#2019). A trip cut short by an edit (a shaft or car removed) is not
    /// one. Engine-internal.
    pub gave_up: bool,
    /// The housekeeping room a housekeeper works from, and where they are in
    /// their working day (`staff_shift`). Engine-internal: not in the
    /// `Person` shape.
    pub crew_id: Option<i64>,
    pub staff_trip: Option<staff_shift::StaffTrip>,
    /// A customer who came in from outside (`walk_ins`), counted in
    /// `Crowd::walk_in_count` instead of the 140-person sample. Engine-internal.
    pub walk_in: bool,
    /// An office worker on their way in or out (`commuters`), counted in
    /// `Crowd::commuter_count` instead of the 140-person sample, and the
    /// office and direction while the desk still owes for the trip
    /// (engine-internal, like the rest below).
    pub commuter: bool,
    pub commute: Option<commuters::Commute>,
    /// Why a plain commute set out (the floor-list trips of `spawn_trips`),
    /// for the person card (`trip`). Stamped at spawn, draws nothing, and
    /// saved with the person.
    pub errand: Option<trip::Errand>,
    /// The tile the person first stood on, so the card can name the room a
    /// plain commute left, and so one who gives up before boarding walks back
    /// there and leaves the way they came (`motion::turn_back`).
    pub start_x: f64,
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
        // `shaftId` and `carIndex` are `number | null` in the TypeScript, so
        // an absent value is a literal null; every other optional is omitted.
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

/// Looked up by segment, never walked in its hash order.
pub type AdjGraph = fasthash::FastMap<i64, Vec<Edge>>;

/// The part of the staff graph each segment lies in (`graph_parts` in
/// `routing.rs`), only looked up.
pub type StaffParts = fasthash::FastMap<i64, i64>;

/// `ElevatorCalls`: hall (shaft -> floor -> callers) and cab (shaft -> car ->
/// floors, ordered, so dispatch reads them in floor order).
#[derive(Default)]
pub struct ElevatorCalls {
    pub hall: fasthash::FastMap<i64, fasthash::FastMap<i64, HallCall>>,
    pub cab: fasthash::FastMap<i64, fasthash::FastMap<i64, BTreeSet<i64>>>,
    /// The cars (shaft, car) a Modern crowd fills, ascending (`full_cars`).
    pub full: Vec<(i64, i64)>,
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
    pub car_riders: fasthash::FastMap<(i64, i64), i64>,
    /// The Modern cars their riders fill, ascending, which pass hall calls.
    pub full_cars: Vec<(i64, i64)>,
    pub frustration: f64,
    pub commute_wait_by_floor: fasthash::FastMap<i64, f64>,
    pub commute_revision: u32,
    pub adj: Option<(i64, AdjGraph)>,
    /// The staff graph and the part of it each segment lies in, keyed on
    /// the tower revision (`staff_adjacency`). Never saved.
    pub staff_adj: Option<(i64, AdjGraph, StaffParts)>,
    pub shaft_banks: Option<(i64, banks::Banks)>,
    /// The part of the passenger graph each segment lies in, keyed like
    /// `adj` on the tower revision (`routing::passenger_parts`).
    pub passenger_parts: Option<(i64, StaffParts)>,
    pub seg_served: Option<(i64, fasthash::FastSet<i64>)>,
    /// The segments the Classic walk-budget search reaches from a lobby
    /// segment (`graph.rs`), keyed like `adj`; never saved.
    pub lobby_reach: Option<(i64, fasthash::FastSet<i64>)>,
    pub blockbusters: HashSet<i64>,
    pub staff_done: Vec<StaffResult>,
    pub staff_count: i64,
    /// Housekeepers who reached their housekeeping room or finished a room
    /// this step, by person id, for the shift to send on (`staff_shift`).
    pub staff_ready: Vec<i64>,
    /// Housekeepers in the building, by the housekeeping room they work at.
    pub crew_roster: HashMap<i64, i64>,
    pub step: i64,
    /// The cars the schedule stood down, (shaft id, car index) ascending: nobody boards one, even
    /// one finishing its riders. Swapped in from the dispatch each step; saved as `closedCars`.
    pub closed_cars: Vec<(i64, i64)>,
    /// The cars standing open at a stop (`dispatch::OpenCar`), ascending: the only
    /// cars a person boards or leaves. Swapped in from the dispatch each step; never saved.
    pub open_cars: Vec<crate::dispatch::OpenCar>,
    /// The queue projection and its (step, tower revision). Never saved.
    pub queue_cache: Option<((i64, i64), crate::render_reads::QueueView)>,
    /// The queue projection's per-shaft maps from an earlier build, emptied,
    /// so a build allocates nothing once they have grown. Never saved.
    pub queue_spare:
        Vec<crate::crowd::fasthash::FastIndexMap<i64, crate::render_reads::QueueLanding>>,
    /// The motion pass's landing lists from its last slice, kept so the next
    /// slice fills them in place (`landing::Landings`). Never saved.
    pub landings: landing::Landings,
    /// The clock hour of the step, so nobody stays in or walks into a venue after it closes. `None`
    /// (a crowd stepped on its own) leaves every venue open. Set by the step, and saved as it left it.
    pub hour: Option<i64>,
    /// The game minute the step reached, for the train (`metro_train`). Not saved.
    pub minute: Option<f64>,
    /// Whether the step's day is a weekend, for the elevator schedules. Saved.
    pub weekend: bool,
    /// The walk-ins booked for this hour, latest first (`walk_ins`). Saved.
    pub walk_ins: Vec<walk_ins::WalkIn>,
    /// The walk-ins in the crowd, on their way or inside.
    pub walk_in_count: i64,
    /// Each office's workers (inside, on the way in, booked to leave) by office id (`commuters`).
    /// Saved (`commuters_save.rs`); a save without them takes the head counts as the workers inside.
    pub desks: std::collections::BTreeMap<i64, commuters::Desk>,
    /// The office arrivals and departures booked this hour, latest first. Saved.
    pub shifts: Vec<commuters::Shift>,
    /// The commuting workers in the crowd, on their way in or out. Counted
    /// again from the people on load.
    pub commuter_count: i64,
    /// The tower revision the desks were last squared with, `None` before the first (`commuters::reconcile`).
    pub desk_revision: Option<i64>,
    /// Everyone in the crowd who boarded an elevator this hour, by shaft and
    /// floor, for the origin rings (`sample_elevator_util`, #477). Not saved.
    pub elevator_boardings: fasthash::FastIndexMap<(i64, i64), f64>,
    /// The Modern router's transit graph and this step's lines. Never saved.
    pub router: Option<expected_time::Router>,
    /// Each shaft's line, keyed (shaft, floor), as the last motion slice counted it
    /// (`line_count`), for the Modern router's next step. Its riders are saved as `lines`.
    pub shaft_lines: fasthash::FastMap<(i64, i64), line_count::Line>,
    /// The waits Modern riders had at each stop, fading (`waits_seen`). Saved as `waitsSeen`.
    pub waits_seen: line_count::waits_seen::WaitsSeen,
    /// The route search's seen set, kept between searches. Never saved.
    pub(crate) route_seen: seg_set::SegSet,
    /// The staff routes found on the staff graph as it stands (`staff_routes`). Never saved.
    pub(crate) staff_routes: staff_routes::StaffRoutes,
    /// The people by floor band, for a view's people window. Never saved.
    pub(crate) by_floor: floor_index::FloorIndex,
}

impl Crowd {
    /// The way car `car` of `shaft` leaves `floor`, if open there so a person may step on or off.
    pub fn door_open(&self, shaft: i64, car: i64, floor: i64) -> Option<crate::dispatch::Leaving> {
        crate::dispatch::leaving_at(&self.open_cars, shaft, car, floor)
    }

    pub fn new(seed: u32) -> Crowd {
        Crowd {
            people: Vec::new(),
            rng: Rng::new(seed),
            next_id: 1,
            spawn_acc: 0.0,
            car_riders: fasthash::FastMap::default(),
            full_cars: Vec::new(),
            frustration: 0.0,
            commute_wait_by_floor: Default::default(),
            commute_revision: 0,
            adj: None,
            staff_adj: None,
            shaft_banks: None,
            passenger_parts: None,
            seg_served: None,
            lobby_reach: None,
            blockbusters: HashSet::new(),
            staff_done: Vec::new(),
            staff_count: 0,
            staff_ready: Vec::new(),
            crew_roster: HashMap::new(),
            step: 0,
            closed_cars: Default::default(),
            open_cars: Default::default(),
            queue_cache: None,
            queue_spare: Vec::new(),
            landings: Default::default(),
            hour: None,
            minute: None,
            weekend: false,
            walk_ins: Vec::new(),
            walk_in_count: 0,
            desks: Default::default(),
            shifts: Vec::new(),
            commuter_count: 0,
            desk_revision: None,
            elevator_boardings: Default::default(),
            router: None,
            shaft_lines: fasthash::FastMap::default(),
            waits_seen: Default::default(),
            route_seen: Default::default(),
            staff_routes: Default::default(),
            by_floor: Default::default(),
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

    pub fn begin_step(&mut self) {
        self.step += 1;
    }

    /// Whether venue `kind` is closed this step, by the step's hour.
    pub fn venue_closed(&self, kind: Kind) -> bool {
        self.hour.is_some_and(|h| !kind.is_open_at(h))
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

#[cfg(test)]
#[path = "commute_stress_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "patience_tests.rs"]
mod patience_tests;

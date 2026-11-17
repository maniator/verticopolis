//! The crowd in a save: everyone in the tower as they stand, so a reload
//! keeps the people walking, waiting, riding, eating and cleaning instead of
//! starting an empty building that fills again from the lobby.
//!
//! A save carries the people and the few crowd values a step reads back
//! (the crowd's random stream, its next id, the spawn accumulator, the
//! frustration level, the commute-stress averages, the last step's hour, the
//! lines and the stood-down cars the Modern router reads next, and the
//! walk-ins booked for the rest of the hour). Everything else the crowd keeps is either
//! rebuilt from the people on load (`adopt.rs`: who
//! rides each car, the venue and meal head counts, the housekeeping crews
//! and the rooms they hold) or rebuilt each step (routes, landings, the
//! open cars).
//!
//! A save from before the crowd was saved has no `crowd` key and loads with
//! an empty crowd, as every save did. A build from before this one ignores
//! the key. A person the loader cannot place (a hand-edited save with an
//! unknown state, a route that does not fit its legs, a floor off the lot) is
//! left out rather than trusted, so a forged save cannot send the motion code
//! past the end of a route.

// The router's saved lines and stood-down cars (`router_save.rs`).
#[path = "router_save.rs"]
mod router_save;

use serde::ser::{Serialize, SerializeMap, Serializer};
use serde_json::{json, Map, Value};

use super::commuters::Commute;
use super::commuters_save::CrowdMarks;
use super::spawn::seed_for;
use super::staff_shift::StaffTrip;
use super::trip::{Errand, ErrandPlace};
use super::walk_ins::WalkIn;
use super::{Crowd, PState, Person};
use crate::charges::whole;
use crate::facilities::{LOT_WIDTH, MAX_FLOOR, MIN_FLOOR};
use crate::save_entry::{entry_tree, EntryValue, SaveEntries, Scalar, WrittenAll};
use crate::sim_save::Each;

/// The most people a save restores. A working tower holds at most the
/// walk-ins' ceiling, the 140-person sample and its housekeeping crews, far
/// below this; the cap only bounds what a hand-edited save can make the
/// loader keep.
pub(crate) const MAX_SAVED_PEOPLE: usize = 10_000;

/// The most walk-in bookings a save restores: an hour's bookings for a
/// tower at full demand stay well under it.
pub(crate) const MAX_SAVED_WALK_INS: usize = 20_000;

/// How far off the lot a saved position may lie, in tiles, on either side:
/// a walk from anywhere in it ends in a bounded time.
const OFF_LOT_MARGIN: f64 = LOT_WIDTH as f64;

/// The longest route a saved person may carry, in floors. A route visits
/// each shaft at most once, and a tower holds at most 88 shafts.
const MAX_ROUTE_FLOORS: usize = 128;

impl PState {
    fn parse(s: &str) -> Option<PState> {
        Some(match s {
            "toShaft" => PState::ToShaft,
            "waiting" => PState::Waiting,
            "riding" => PState::Riding,
            "climbing" => PState::Climbing,
            "toDest" => PState::ToDest,
            "dwelling" => PState::Dwelling,
            _ => return None,
        })
    }

    /// Whether a person in this state is partway along a leg of their route,
    /// so the route must hold the leg's far floor.
    fn on_a_leg(self) -> bool {
        matches!(
            self,
            PState::ToShaft | PState::Waiting | PState::Riding | PState::Climbing
        )
    }
}

impl StaffTrip {
    fn as_str(self) -> &'static str {
        match self {
            StaffTrip::In => "in",
            StaffTrip::Base => "base",
            StaffTrip::Job => "job",
            StaffTrip::Free => "free",
            StaffTrip::Home => "home",
            StaffTrip::Out => "out",
        }
    }

    fn parse(s: &str) -> Option<StaffTrip> {
        Some(match s {
            "in" => StaffTrip::In,
            "base" => StaffTrip::Base,
            "job" => StaffTrip::Job,
            "free" => StaffTrip::Free,
            "home" => StaffTrip::Home,
            "out" => StaffTrip::Out,
            _ => return None,
        })
    }
}

impl ErrandPlace {
    fn as_str(self) -> &'static str {
        match self {
            ErrandPlace::Office => "office",
            ErrandPlace::Home => "home",
            ErrandPlace::Work => "work",
        }
    }

    fn parse(s: &str) -> Option<ErrandPlace> {
        match s {
            "office" => Some(ErrandPlace::Office),
            "home" => Some(ErrandPlace::Home),
            "work" => Some(ErrandPlace::Work),
            _ => None,
        }
    }
}

/// The routines a Modern resident runs, by the names the crowd stamps.
fn routine_name(s: &str) -> Option<&'static str> {
    match s {
        "schoolRun" => Some("schoolRun"),
        "salesCall" => Some("salesCall"),
        _ => None,
    }
}

impl Person {
    /// The person as the save writes them: every field a step reads, the
    /// unset optional ones left out. The seed is not written: every person's
    /// seed is the one their id gives ([`seed_for`]).
    pub(crate) fn save_form(&self) -> Value {
        entry_tree(self)
    }

    /// The person a save wrote, or `None` when the entry is not one the
    /// motion code can carry on from (see the module notes).
    pub(crate) fn from_save(v: &Value) -> Option<Person> {
        let o = v.as_object()?;
        let int = |key: &str| o.get(key).and_then(Value::as_f64).and_then(whole);
        let finite = |key: &str| o.get(key).and_then(Value::as_f64).filter(|n| n.is_finite());
        let flag = |key: &str| o.get(key) == Some(&Value::Bool(true));
        let opt_int = |key: &str| -> Option<Option<i64>> {
            match o.get(key) {
                None | Some(Value::Null) => Some(None),
                Some(v) => v.as_f64().and_then(whole).map(Some),
            }
        };
        let opt_finite = |key: &str| -> Option<Option<f64>> {
            match o.get(key) {
                None | Some(Value::Null) => Some(None),
                Some(v) => v.as_f64().filter(|n| n.is_finite()).map(Some),
            }
        };
        let on_lot = |f: i64| (MIN_FLOOR..=MAX_FLOOR).contains(&f);
        // A position across the lot (with a margin either side); a height
        // between the lowest and the highest floor.
        let across = |key: &str| {
            let span = -OFF_LOT_MARGIN..=LOT_WIDTH as f64 + OFF_LOT_MARGIN;
            finite(key).filter(|x| span.contains(x))
        };
        let height = |key: &str| {
            let span = MIN_FLOOR as f64..=MAX_FLOOR as f64;
            finite(key).filter(|y| span.contains(y))
        };
        let ints = |key: &str| -> Option<Vec<i64>> {
            o.get(key)?
                .as_array()?
                .iter()
                .map(|n| n.as_f64().and_then(whole))
                .collect()
        };

        let id = int("id").filter(|&id| id > 0)?;
        let state = PState::parse(o.get("state")?.as_str()?)?;
        let floors = ints("floors")?;
        let shafts = ints("shafts")?;
        // A route is its floors and the shafts between them: one floor more
        // than shafts, every floor on the lot.
        if floors.is_empty()
            || floors.len() > MAX_ROUTE_FLOORS
            || floors.len() != shafts.len() + 1
            || !floors.iter().all(|&f| on_lot(f))
        {
            return None;
        }
        let leg = usize::try_from(int("leg")?).ok()?;
        if leg > shafts.len() || (state.on_a_leg() && leg >= shafts.len()) {
            return None;
        }
        let floor = int("floor").filter(|&f| on_lot(f))?;
        let origin_floor = int("originFloor").filter(|&f| on_lot(f))?;
        // Only a rider holds a seat in a car.
        let car_index = opt_int("carIndex")?.filter(|&c| c >= 0);
        if (state == PState::Riding) != car_index.is_some() {
            return None;
        }
        let errand = match o.get("errand") {
            None | Some(Value::Null) => None,
            Some(e) => Some(Errand {
                place: ErrandPlace::parse(e.get("place")?.as_str()?)?,
                inbound: e.get("inbound")?.as_bool()?,
            }),
        };
        let staff_trip = match o.get("staffTrip") {
            None | Some(Value::Null) => None,
            Some(t) => Some(StaffTrip::parse(t.as_str()?)?),
        };
        // A housekeeper works for a crew and is somewhere in their working
        // day; nobody else carries either, or a room to clean.
        let staff = flag("staff");
        let crew_id = opt_int("crewId")?;
        let clean_unit_id = opt_int("cleanUnitId")?;
        let works = crew_id.is_some() && staff_trip.is_some();
        if staff != works || (!staff && clean_unit_id.is_some()) {
            return None;
        }
        let x = across("x")?;
        // A commuting worker carries their office and which way they go.
        let commute = match o.get("commute") {
            None | Some(Value::Null) => None,
            Some(c) => Some(Commute {
                workplace_id: c.get("officeId")?.as_f64().and_then(whole)?,
                inbound: c.get("inbound")?.as_bool()?,
            }),
        };
        Some(Person {
            id,
            seed: seed_for(id),
            state,
            floor,
            fy: height("fy")?,
            x,
            floors,
            origin_floor,
            shafts,
            leg,
            shaft_id: opt_int("shaftId")?,
            car_index,
            dest_x: across("destX")?,
            wait: finite("wait")?,
            trip_wait: finite("tripWait")?,
            age: finite("age")?,
            linger: finite("linger")?,
            staff,
            clean_unit_id,
            meal_venue_id: opt_int("mealVenueId")?,
            venue_unit_id: opt_int("venueUnitId")?,
            counted_hotel_guest: flag("countedHotelGuest"),
            origin_unit_id: opt_int("originUnitId")?,
            dwell_seconds_left: opt_finite("dwellSecondsLeft")?,
            returning: flag("returning"),
            routine: o
                .get("routine")
                .and_then(Value::as_str)
                .and_then(routine_name),
            linger_for: opt_finite("lingerFor")?,
            from_metro: flag("fromMetro"),
            gave_up: flag("gaveUp"),
            crew_id,
            staff_trip,
            walk_in: flag("walkIn"),
            errand,
            start_x: across("startX").unwrap_or(x),
            commuter: commute.is_some(),
            commute,
        })
    }
}

/// A walk-in booking as the save writes it.
fn walk_in_json(w: &WalkIn) -> Value {
    json!({ "at": w.at, "unitId": w.unit_id })
}

impl SaveEntries for Person {
    fn save_entries<E>(
        &self,
        mut put: impl FnMut(&'static str, EntryValue<'_>) -> Result<(), E>,
    ) -> Result<(), E> {
        put("id", EntryValue::Int(self.id))?;
        put("state", EntryValue::Text(self.state.as_str()))?;
        put("floor", EntryValue::Int(self.floor))?;
        put("fy", EntryValue::Float(self.fy))?;
        put("x", EntryValue::Float(self.x))?;
        put("startX", EntryValue::Float(self.start_x))?;
        put("floors", EntryValue::Ints(&self.floors))?;
        put("originFloor", EntryValue::Int(self.origin_floor))?;
        put("shafts", EntryValue::Ints(&self.shafts))?;
        // A leg index is far below `i64::MAX`.
        put("leg", EntryValue::Int(self.leg as i64))?;
        if let Some(v) = self.shaft_id {
            put("shaftId", EntryValue::Int(v))?;
        }
        if let Some(v) = self.car_index {
            put("carIndex", EntryValue::Int(v))?;
        }
        put("destX", EntryValue::Float(self.dest_x))?;
        put("wait", EntryValue::Float(self.wait))?;
        put("tripWait", EntryValue::Float(self.trip_wait))?;
        put("age", EntryValue::Float(self.age))?;
        put("linger", EntryValue::Float(self.linger))?;
        let flags = [
            ("staff", self.staff),
            ("countedHotelGuest", self.counted_hotel_guest),
            ("returning", self.returning),
            ("fromMetro", self.from_metro),
            ("gaveUp", self.gave_up),
            ("walkIn", self.walk_in),
        ];
        for (key, set) in flags {
            if set {
                put(key, EntryValue::True)?;
            }
        }
        let ids = [
            ("cleanUnitId", self.clean_unit_id),
            ("mealVenueId", self.meal_venue_id),
            ("venueUnitId", self.venue_unit_id),
            ("originUnitId", self.origin_unit_id),
            ("crewId", self.crew_id),
        ];
        for (key, id) in ids {
            if let Some(id) = id {
                put(key, EntryValue::Int(id))?;
            }
        }
        if let Some(v) = self.dwell_seconds_left {
            put("dwellSecondsLeft", EntryValue::Float(v))?;
        }
        if let Some(v) = self.linger_for {
            put("lingerFor", EntryValue::Float(v))?;
        }
        if let Some(v) = self.routine {
            put("routine", EntryValue::Text(v))?;
        }
        if let Some(t) = self.staff_trip {
            put("staffTrip", EntryValue::Text(t.as_str()))?;
        }
        if let Some(e) = self.errand {
            let place = Scalar::Text(e.place.as_str());
            put(
                "errand",
                EntryValue::Pair("place", place, "inbound", Scalar::Bool(e.inbound)),
            )?;
        }
        if let Some(c) = self.commute {
            // The key keeps its first name; it holds a venue's id too.
            let office = Scalar::Int(c.workplace_id);
            put(
                "commute",
                EntryValue::Pair("officeId", office, "inbound", Scalar::Bool(c.inbound)),
            )?;
        }
        Ok(())
    }
}

/// The crowd as the save writes it: [`Crowd::save_json`]'s object, each
/// person written straight to the save (`save_entry`), and the marks beside
/// its desks (`CrowdMarks`).
pub(crate) struct SavedCrowd<'a>(pub &'a Crowd, pub CrowdMarks);

impl Serialize for SavedCrowd<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let c = self.0;
        let mut m = s.serialize_map(None)?;
        for (key, value) in c.save_head() {
            m.serialize_entry(&key, &value)?;
        }
        c.commuters_write(&mut m, self.1)?;
        m.serialize_entry("walkIns", &Each(&c.walk_ins, walk_in_json))?;
        m.serialize_entry("people", &WrittenAll(&c.people))?;
        m.end()
    }
}

impl Crowd {
    /// The crowd's save values ahead of the walk-ins and the people: the
    /// random stream and counters a step reads back, the hour the last step
    /// ran in. The commuters' desks and bookings follow them.
    fn save_head(&self) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("nextId".into(), json!(self.next_id));
        m.insert("rng".into(), json!(self.rng.seed()));
        m.insert("spawnAcc".into(), json!(self.spawn_acc));
        m.insert("frustration".into(), json!(self.frustration));
        m.insert("commuteStress".into(), self.commute_stress_json());
        if let Some(hour) = self.hour {
            m.insert("hour".into(), json!(hour));
        }
        if self.weekend {
            m.insert("weekend".into(), json!(true));
        }
        // A line nobody stands in holds only a remembered wait, which
        // `waitsSeen` carries.
        let rows: Vec<[i64; 3]> = (self.shaft_lines.sorted().into_iter())
            .filter(|(_, line)| line.riders > 0)
            .map(|(&(shaft, floor), line)| [shaft, floor, line.riders])
            .collect();
        if !rows.is_empty() {
            m.insert("lines".into(), json!(rows));
        }
        if !self.waits_seen.is_empty() {
            m.insert("waitsSeen".into(), self.waits_seen_json());
        }
        if !self.closed_cars.is_empty() {
            m.insert("closedCars".into(), json!(self.closed_cars));
        }
        m
    }

    /// The crowd's save object: the same keys and values [`SavedCrowd`]
    /// writes.
    pub(crate) fn save_json(&self, marks: CrowdMarks) -> Value {
        let mut m = self.save_head();
        self.commuters_save(&mut m, marks);
        let walk_ins = self.walk_ins.iter().map(walk_in_json).collect();
        m.insert("walkIns".into(), Value::Array(walk_ins));
        let people = self.people.iter().map(Person::save_form).collect();
        m.insert("people".into(), Value::Array(people));
        Value::Object(m)
    }

    /// Takes the people and values a save's `crowd` object carries. An entry
    /// that does not read is skipped. The crowd is kept in id order (a
    /// housekeeper is found by a binary search on it, `staff_shift::index_of`),
    /// as every save writes it, so a person whose id is not above the last
    /// one kept is left out, and ids stay unique.
    pub(crate) fn restore(&mut self, v: &Value) {
        let Some(o) = v.as_object() else { return };
        let num = |key: &str| o.get(key).and_then(Value::as_f64).filter(|n| n.is_finite());
        if let Some(state) = num("rng")
            .and_then(whole)
            .and_then(|s| u32::try_from(s).ok())
        {
            self.rng.restore(state);
        }
        self.spawn_acc = num("spawnAcc").unwrap_or(0.0);
        self.frustration = num("frustration").unwrap_or(0.0);
        // The hour the last step ran in, which the next step's hourly work
        // reads before it sets it again.
        self.hour = num("hour").and_then(whole).filter(|h| (0..24).contains(h));
        self.weekend = o.get("weekend") == Some(&Value::Bool(true));
        self.restore_lines(o.get("lines"));
        self.restore_closed_cars(o.get("closedCars"));
        self.restore_waits_seen(o.get("waitsSeen"));
        self.commuters_restore(o);
        if let Some(rows) = o.get("commuteStress") {
            // A malformed list keeps the empty averages a load starts with.
            let _ = self.seed_commute_stress(rows);
        }
        if let Some(list) = o.get("walkIns").and_then(Value::as_array) {
            for w in list.iter().take(MAX_SAVED_WALK_INS) {
                let at = w
                    .get("at")
                    .and_then(Value::as_f64)
                    .filter(|n| n.is_finite());
                let unit = w.get("unitId").and_then(Value::as_f64).and_then(whole);
                if let (Some(at), Some(unit_id)) = (at, unit) {
                    self.walk_ins.push(WalkIn { at, unit_id });
                }
            }
            self.sort_walk_ins();
        }
        if let Some(list) = o.get("people").and_then(Value::as_array) {
            for p in list.iter().filter_map(Person::from_save) {
                if self.people.len() == MAX_SAVED_PEOPLE {
                    break;
                }
                if self.people.last().is_none_or(|last| p.id > last.id) {
                    self.people.push(p);
                }
            }
        }
        // The view's floor index, so the first frame after a load reads it.
        self.by_floor.rebuild(&self.people);
        // The next person gets an id above everyone's in the tower.
        let past_ids = self.people.last().map_or(1, |p| p.id + 1);
        let saved = num("nextId").and_then(whole).unwrap_or(1);
        self.next_id = saved.max(past_ids).max(1);
    }
}

#[cfg(test)]
#[path = "save_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "save_entry_tests.rs"]
mod entry_tests;

//! The stats readouts: `stats()` for the HUD strip (every UI tick) and the
//! rest of what `statsTemplate` asks the `Simulation` for while the stats
//! screen is open (`src/engine/sim/stats.ts`, `src/ui/templates/stats.ts`).
//!
//! `tower_stats` is one pass over the rooms (the tower's room index, so the
//! floor and lobby tiles are not walked). Unit states, customers and money
//! move between revisions and between hours, so no revision or hour key could
//! stand in for the pass without showing stale numbers. `highest_floor` and
//! `lowest_floor` read the tower's floor bounds, kept per revision, and
//! `population` is one more pass over the rooms (#1237).

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// The HUD strip's counters, in the order [`Simulation::tower_stats_record`]
/// gives them; the view layout names them for the port's readers.
pub const TOWER_STATS: [&str; 20] = [
    "population",
    "parkingSpaces",
    "money",
    "star",
    "offices",
    "occupiedOffices",
    "condos",
    "soldCondos",
    "hotelRooms",
    "occupiedHotel",
    "dirty",
    "shops",
    "restaurants",
    "vacant",
    "vacantNoRate",
    "floors",
    "basements",
    "elevators",
    "transports",
    "fires",
];

impl Simulation {
    /// `stats()`: the cheap counters the HUD strip and the stats screen share.
    pub fn tower_stats(&self) -> Value {
        let record = self.tower_stats_record();
        let mut m = Map::new();
        for (name, v) in TOWER_STATS.iter().zip(record) {
            // Every counter but the balance is a whole number in TypeScript's
            // answer, and the lock compares the JSON text.
            let v = if *name == "money" {
                json!(v)
            } else {
                json!(v as i64)
            };
            m.insert((*name).to_owned(), v);
        }
        Value::Object(m)
    }

    /// The same counters as numbers in [`TOWER_STATS`] order: the record the
    /// engine's port hands the HUD strip every UI tick, with no JSON.
    pub fn tower_stats_record(&self) -> [f64; TOWER_STATS.len()] {
        let (mut offices, mut occupied_offices, mut condos, mut sold_condos) = (0, 0, 0, 0);
        let (mut hotel_rooms, mut occupied_hotel, mut dirty) = (0, 0, 0);
        let (mut shops, mut restaurants, mut vacant, mut vacant_no_rate) = (0, 0, 0, 0);
        let mut parking_spaces = 0;
        for u in self.tower.room_units() {
            match u.kind {
                Kind::Office => {
                    offices += 1;
                    if u.is_tenanted() {
                        occupied_offices += 1;
                    }
                    if u.state == UnitState::Empty {
                        vacant += 1;
                        if u.no_rate {
                            vacant_no_rate += 1;
                        }
                    }
                }
                Kind::Condo => {
                    condos += 1;
                    if u.ever_occupied {
                        sold_condos += 1;
                    }
                }
                k if k.is_hotel() => {
                    hotel_rooms += 1;
                    if u.state == UnitState::Asleep {
                        occupied_hotel += 1;
                    }
                    if u.state == UnitState::Dirty {
                        dirty += 1;
                    }
                }
                Kind::Shop => shops += 1,
                Kind::Restaurant | Kind::FastFood => restaurants += 1,
                Kind::Parking => parking_spaces += 1,
                _ => {}
            }
        }
        let elevators = self
            .tower
            .transports
            .iter()
            .filter(|t| t.kind.is_elevator())
            .count();
        [
            self.population() as f64,
            f64::from(parking_spaces),
            self.money,
            self.star as f64,
            f64::from(offices),
            f64::from(occupied_offices),
            f64::from(condos),
            f64::from(sold_condos),
            f64::from(hotel_rooms),
            f64::from(occupied_hotel),
            f64::from(dirty),
            f64::from(shops),
            f64::from(restaurants),
            f64::from(vacant),
            f64::from(vacant_no_rate),
            self.highest_floor() as f64,
            (1 - self.lowest_floor()).max(0) as f64,
            elevators as f64,
            self.tower.transports.len() as f64,
            self.events.count() as f64,
        ]
    }

    /// The Modern "Households" readout: the homes in residence, the people in
    /// them, and a histogram of household sizes.
    pub fn households_report(&self) -> Value {
        let mut mix: BTreeMap<i64, i64> = BTreeMap::new();
        let (mut households, mut residents) = (0, 0);
        for u in self.tower.room_units() {
            if matches!(u.kind, Kind::Condo | Kind::RentalApartment) && u.is_present() {
                let size = u.resident_count();
                *mix.entry(size).or_insert(0) += 1;
                households += 1;
                residents += size;
            }
        }
        let mix: Vec<Value> = mix.iter().map(|(s, n)| json!([s, n])).collect();
        json!({ "households": households, "residents": residents, "mix": mix })
    }

    /// Everything the stats screen reads beyond `stats()`, in one answer.
    /// Takes `&mut self` only because the stranded-floor scan memoizes floor
    /// reachability by tower revision, as the engine's own reads do.
    pub fn stats_report(&mut self) -> Value {
        let parking = self.parking_demand();
        let mut out = Map::new();
        out.insert("stats".into(), self.tower_stats());
        out.insert("ratingPopulation".into(), json!(self.rating_population()));
        out.insert("hotelsCountTowardRating".into(), json!(self.star < 4));
        out.insert(
            "functionalParking".into(),
            json!(self.tower.functional_parking_set().len()),
        );
        out.insert(
            "parkingDemand".into(),
            json!({
                "officePop": parking.office_pop,
                "offices": parking.offices,
                "suites": parking.suites,
                "total": parking.total,
            }),
        );
        out.insert(
            "housekeeping".into(),
            self.housekeeping_coverage().to_json(),
        );
        out.insert("housekeepingReport".into(), self.housekeeping_report_json());
        out.insert(
            "recycling".into(),
            json!({
                "capacity": self.recycling_capacity(),
                "demandMet": self.recycling_demand_met(),
            }),
        );
        out.insert("strandedFloors".into(), json!(self.stranded_floors(false)));
        out.insert(
            "nextStarThreshold".into(),
            json!(self.next_star_threshold()),
        );
        out.insert("nextStar".into(), self.next_star_requirements());
        out.insert("milestones".into(), self.milestone_progress());
        out.insert("income".into(), self.income_breakdown());
        out.insert("elevators".into(), self.elevator_stats());
        out.insert("vipVisits".into(), json!(self.vip_visits));
        out.insert("vipFavorable".into(), json!(self.vip_favorable));
        out.insert(
            "exterminationDueDay".into(),
            json!(self.extermination_due_day),
        );
        out.insert("households".into(), self.households_report());
        Value::Object(out)
    }
}

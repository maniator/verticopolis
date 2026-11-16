//! Port of `sim/presence.ts` and `sim/congestion.ts` (the parts the sim reads).

use std::sync::Arc;

use indexmap::IndexMap;

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// The per-class congestion maxes a floor's reading was folded from
/// (`spatialCongestionAttributionByFloor`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CongestionAttribution {
    pub elevator: f64,
    pub stairs: f64,
    pub escalator: f64,
}

/// The congestion reading's passenger transports, kept per tower revision
/// (`Simulation::congestion_shafts`).
#[derive(Default)]
pub struct ShaftsByFloor {
    /// Each served floor's total capacity and its transports, as (slot,
    /// capacity, kind), in the order the reading folds them.
    floors: IndexMap<i64, (f64, Vec<(usize, f64, Kind)>)>,
    /// How many transports hold a slot: one per transport that stops at a
    /// served floor, numbered in list order.
    slots: usize,
}

#[doc(hidden)]
impl Simulation {
    /// `updatePresence`: the hourly head count per room.
    pub fn update_presence(&mut self) {
        let weekend = self.clock.is_weekend();
        let hour = self.clock.hour();
        let night = self.clock.is_night();
        let evening = self.clock.is_evening();
        let mode = self.tower.mode;
        for i in self.tower.room_indices() {
            let (u, at) = self.tower.marked(i);
            // A Modern office counts the workers who got to their desks, and
            // a Modern home the residents who got home (`crowd::commuters`),
            // not the clock.
            if u.kind.arrives_in_person(mode) {
                continue;
            }
            let f = u.kind.facility();
            if u.is_dormant() {
                if u.state == UnitState::Empty && f.attendance.is_some() {
                    u.sync_visitor_occupants(at);
                } else {
                    u.set_occupants(at, 0);
                }
                continue;
            }
            // `None` leaves the head count as it is.
            let occupants = match u.kind {
                Kind::Office => Some(if !weekend && (8..18).contains(&hour) {
                    f.population
                } else {
                    0
                }),
                Kind::Condo | Kind::RentalApartment => Some(if night || evening || weekend {
                    u.resident_count()
                } else {
                    1
                }),
                Kind::RentalStudio => Some(if night || evening || weekend {
                    f.population
                } else {
                    0
                }),
                Kind::HotelSingle | Kind::HotelDouble | Kind::HotelSuite => {
                    Some(if u.state == UnitState::Asleep {
                        f.population
                    } else {
                        0
                    })
                }
                // A venue, shop or restaurant holds the visitors inside it.
                _ => u.visitor_occupants().or(Some(
                    if u.state == UnitState::Occupied && u.open_for_business(hour, mode) {
                        f.population
                    } else {
                        0
                    },
                )),
            };
            if let Some(n) = occupants {
                u.set_occupants(at, n);
            }
        }
    }

    /// `rushFactor`.
    pub fn rush_factor(&self) -> f64 {
        let c = &self.clock;
        if c.is_morning() || c.is_evening() {
            1.45
        } else if c.is_lunch() {
            1.15
        } else if c.is_night() {
            0.35
        } else {
            0.8
        }
    }

    /// `transportCapacity`.
    pub fn transport_capacity(kind: Kind, cars: i64) -> f64 {
        let per = kind.car_capacity();
        if kind.is_elevator() {
            cars as f64 * per
        } else {
            per
        }
    }

    /// `spatialCongestionByFloor`: floor -> ratio, in the map's insertion order.
    pub fn spatial_congestion_by_floor(&self) -> IndexMap<i64, f64> {
        self.build_spatial_congestion(false).0
    }

    /// `spatialCongestionAttributionByFloor`: the per-class maxes (elevator,
    /// stairs, escalator) a floor's reading was folded from, for the
    /// congestion copy (`bindingTransportClassAt`).
    pub fn spatial_congestion_attribution_by_floor(&self) -> IndexMap<i64, CongestionAttribution> {
        self.build_spatial_congestion(true).1
    }

    /// Both maps from one pass, for a reader that needs a floor's ratio and
    /// then its binding class (the inspector's congestion gripe, #1215),
    /// where calling the two accessors above would build them twice.
    pub(crate) fn spatial_congestion_with_attribution(
        &self,
    ) -> (IndexMap<i64, f64>, IndexMap<i64, CongestionAttribution>) {
        self.build_spatial_congestion(true)
    }

    /// `buildSpatialCongestion` (sim/congestion.ts): the ratio map and, when
    /// `with_attribution` is set, the per-class attribution, from one pass.
    /// The ratio readers (the overlay, the hotspot, the hourly satisfaction
    /// pass) leave it unset: the map is empty then, not built and dropped.
    fn build_spatial_congestion(
        &self,
        with_attribution: bool,
    ) -> (IndexMap<i64, f64>, IndexMap<i64, CongestionAttribution>) {
        const HEADROOM: f64 = 12.0;
        let rush = self.rush_factor();
        let mut result: IndexMap<i64, f64> = IndexMap::new();
        let mut attribution: IndexMap<i64, CongestionAttribution> = IndexMap::new();
        let mut pop_by_floor: IndexMap<i64, f64> = IndexMap::new();
        let mut metro = 0;
        for u in self.tower.room_units() {
            if u.kind == Kind::Metro && u.is_operational() {
                metro += 1;
            }
            if u.is_present() {
                let p = u.live_load();
                if p > 0 && u.floor != 1 {
                    *pop_by_floor.entry(u.floor).or_insert(0.0) += p as f64;
                }
            }
        }
        if pop_by_floor.is_empty() {
            return (result, attribution);
        }
        let parking = self.tower.functional_parking_spots();
        let relief = (1.0 - metro as f64 * 0.25 - parking as f64 * 0.02).max(0.4);
        let shafts_by_floor = self.congestion_shafts();
        let mut load_by_shaft = vec![0.0; shafts_by_floor.slots];
        for (f, pop) in &pop_by_floor {
            let Some((total_cap, shafts)) = shafts_by_floor.floors.get(f) else {
                continue;
            };
            if *total_cap <= 0.0 {
                continue;
            }
            let demand = pop * relief;
            for &(slot, cap, _) in shafts {
                load_by_shaft[slot] += demand * (cap / total_cap);
            }
        }
        for (f, (_, shafts)) in &shafts_by_floor.floors {
            if *f != 1 && !pop_by_floor.contains_key(f) {
                continue;
            }
            let mut c = 0.0;
            let mut att = CongestionAttribution::default();
            for (slot, cap, kind) in shafts {
                let cong = if *cap > 0.0 {
                    (load_by_shaft[*slot] * rush) / (cap * HEADROOM)
                } else {
                    99.0
                };
                if cong > c {
                    c = cong;
                }
                if !with_attribution {
                    continue;
                }
                // The same reading folded into its class max; the staff
                // filter above admits only these three classes today.
                if kind.is_elevator() {
                    if cong > att.elevator {
                        att.elevator = cong;
                    }
                } else if *kind == Kind::Stairs {
                    if cong > att.stairs {
                        att.stairs = cong;
                    }
                } else if *kind == Kind::Escalator && cong > att.escalator {
                    att.escalator = cong;
                }
            }
            result.insert(*f, c);
            if with_attribution {
                attribution.insert(*f, att);
            }
        }
        (result, attribution)
    }

    /// The congestion reading's transports per served floor, built once per
    /// tower revision: the HUD reads congestion several times a second and a
    /// Modern tower may hold thousands of flights. Placing, removing or
    /// resizing a transport, a stop edit and a car count change each bump
    /// the revision, and so does every edit that changes the served floors.
    fn congestion_shafts(&self) -> Arc<ShaftsByFloor> {
        let tower = &self.tower;
        if let Some((rev, table)) = &tower.memo.borrow().congestion_shafts {
            if *rev == tower.revision {
                return table.clone();
            }
        }
        let served = tower.served_floors();
        let mut table = ShaftsByFloor::default();
        for t in &tower.transports {
            if t.kind.is_staff_only_transport() {
                continue;
            }
            let stops = tower.stops_of(t);
            if !stops.iter().any(|f| served.contains(f)) {
                continue;
            }
            let (slot, cap) = (table.slots, Simulation::transport_capacity(t.kind, t.cars));
            table.slots += 1;
            for f in stops.into_iter().filter(|f| served.contains(f)) {
                let (_, shafts) = table.floors.entry(f).or_default();
                shafts.push((slot, cap, t.kind));
            }
        }
        // Each floor's total, summed in the order the reading once summed it.
        for (total, shafts) in table.floors.values_mut() {
            *total = shafts.iter().fold(0.0, |sum, (_, cap, _)| sum + cap);
        }
        let table = Arc::new(table);
        tower.memo.borrow_mut().congestion_shafts = Some((tower.revision, table.clone()));
        table
    }

    /// `congestion()`: the mean over populated floors, the lobby excluded.
    pub fn congestion(&self) -> f64 {
        let map = self.spatial_congestion_by_floor();
        if map.is_empty() {
            return 0.0;
        }
        let mut sum = 0.0;
        let mut n = 0;
        for (f, c) in &map {
            if *f == 1 {
                continue;
            }
            sum += c;
            n += 1;
        }
        if n > 0 {
            sum / n as f64
        } else {
            0.0
        }
    }
}

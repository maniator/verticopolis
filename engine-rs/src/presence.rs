//! Port of `sim/presence.ts` and `sim/congestion.ts` (the parts the sim reads).

use std::collections::HashMap;

use indexmap::IndexMap;

use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

impl Simulation {
    /// `updatePresence`: the hourly head count per room.
    pub fn update_presence(&mut self) {
        let weekend = self.clock.is_weekend();
        let hour = self.clock.hour();
        let night = self.clock.is_night();
        let evening = self.clock.is_evening();
        for i in self.tower.room_indices() {
            let u = &mut self.tower.units[i];
            let f = u.kind.facility();
            if u.is_dormant() {
                if u.state == UnitState::Empty && f.attendance.is_some() {
                    u.sync_attendance_occupants();
                } else {
                    u.occupants = 0;
                }
                continue;
            }
            match u.kind {
                Kind::Office => {
                    u.occupants = if !weekend && (8..18).contains(&hour) {
                        f.population
                    } else {
                        0
                    };
                }
                Kind::Condo | Kind::RentalApartment => {
                    u.occupants = if night || evening || weekend {
                        u.resident_count()
                    } else {
                        1
                    };
                }
                Kind::RentalStudio => {
                    u.occupants = if night || evening || weekend {
                        f.population
                    } else {
                        0
                    };
                }
                Kind::HotelSingle | Kind::HotelDouble | Kind::HotelSuite => {
                    u.occupants = if u.state == UnitState::Asleep {
                        f.population
                    } else {
                        0
                    };
                }
                _ => {
                    if f.attendance.is_some() {
                        u.sync_attendance_occupants();
                    } else {
                        u.occupants = if u.state == UnitState::Occupied && u.kind.is_open_at(hour) {
                            f.population
                        } else {
                            0
                        };
                    }
                }
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
        const HEADROOM: f64 = 12.0;
        let rush = self.rush_factor();
        let mut result: IndexMap<i64, f64> = IndexMap::new();
        let mut pop_by_floor: IndexMap<i64, f64> = IndexMap::new();
        let mut metro = 0;
        for u in self.tower.room_units() {
            if u.kind == Kind::Metro && u.is_operational() {
                metro += 1;
            }
            if u.is_present() {
                let p = u.census_count();
                if p > 0 && u.floor != 1 {
                    *pop_by_floor.entry(u.floor).or_insert(0.0) += p as f64;
                }
            }
        }
        if pop_by_floor.is_empty() {
            return result;
        }
        let parking = self.tower.functional_parking_spots();
        let relief = (1.0 - metro as f64 * 0.25 - parking as f64 * 0.02).max(0.4);
        let served = self.tower.served_floors();
        let mut shafts_by_floor: IndexMap<i64, Vec<(i64, f64)>> = IndexMap::new();
        for t in &self.tower.transports {
            if t.kind.is_staff_only_transport() {
                continue;
            }
            let active = (t.bottom..=t.top).any(|f| t.stops_at(f) && served.contains(&f));
            if !active {
                continue;
            }
            let cap = Simulation::transport_capacity(t.kind, t.cars);
            for f in t.bottom..=t.top {
                if t.stops_at(f) && served.contains(&f) {
                    shafts_by_floor.entry(f).or_default().push((t.id, cap));
                }
            }
        }
        let mut load_by_shaft: HashMap<i64, f64> = HashMap::new();
        for (f, pop) in &pop_by_floor {
            let Some(shafts) = shafts_by_floor.get(f) else {
                continue;
            };
            if shafts.is_empty() {
                continue;
            }
            let total_cap: f64 = shafts.iter().fold(0.0, |s, (_, c)| s + c);
            if total_cap <= 0.0 {
                continue;
            }
            let demand = pop * relief;
            for (id, cap) in shafts {
                let share = demand * (cap / total_cap);
                *load_by_shaft.entry(*id).or_insert(0.0) += share;
            }
        }
        for (f, shafts) in &shafts_by_floor {
            if *f != 1 && !pop_by_floor.contains_key(f) {
                continue;
            }
            let mut c = 0.0;
            for (id, cap) in shafts {
                let cong = if *cap > 0.0 {
                    (load_by_shaft.get(id).copied().unwrap_or(0.0) * rush) / (cap * HEADROOM)
                } else {
                    99.0
                };
                if cong > c {
                    c = cong;
                }
            }
            result.insert(*f, c);
        }
        result
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

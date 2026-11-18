//! Port of the retired TypeScript `src/engine/sim/presence.ts` and
//! `src/engine/sim/congestion.ts` (the parts the sim reads).

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
    /// Each slot's transport id, by slot.
    ids: Vec<i64>,
}

/// The pieces every congestion reading starts from (`shaft_loads`).
struct ShaftLoads {
    shafts: Arc<ShaftsByFloor>,
    /// Each slot's share of the floors' demand.
    load_by_shaft: Vec<f64>,
    /// The populated floors (the ground lobby left out), in room order.
    pop_by_floor: IndexMap<i64, f64>,
    rush: f64,
}

/// `HEADROOM` in `buildSpatialCongestion`: how many loads a transport's
/// capacity carries before it reads as full.
const HEADROOM: f64 = 12.0;

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

    /// `spatialCongestionByFloor`: floor -> ratio, in the map's insertion
    /// order. The ratio is the congestion a floor's tenants feel, the one the
    /// hourly satisfaction pass drains them by (`fold_commute_waits`), so the
    /// overlay, the hotspot, the HUD and the 9 AM warning name the floor
    /// that is losing tenants (#2020).
    pub fn spatial_congestion_by_floor(&self) -> IndexMap<i64, f64> {
        let (mut ratios, _) = self.build_spatial_congestion(false);
        self.fold_commute_waits(&mut ratios, None);
        ratios
    }

    /// `spatialCongestionAttributionByFloor`: the per-class maxes (elevator,
    /// stairs, escalator) a floor's reading was folded from, for the
    /// congestion copy (`bindingTransportClassAt`).
    pub fn spatial_congestion_attribution_by_floor(&self) -> IndexMap<i64, CongestionAttribution> {
        self.spatial_congestion_with_attribution().1
    }

    /// Both maps from one pass, for a reader that needs a floor's ratio and
    /// then its binding class (the inspector's congestion gripe, #1215),
    /// where calling the two accessors above would build them twice.
    pub(crate) fn spatial_congestion_with_attribution(
        &self,
    ) -> (IndexMap<i64, f64>, IndexMap<i64, CongestionAttribution>) {
        let (mut ratios, mut attribution) = self.build_spatial_congestion(true);
        self.fold_commute_waits(&mut ratios, Some(&mut attribution));
        (ratios, attribution)
    }

    /// The transports behind a floor's congestion reading
    /// (`spatial_congestion_by_floor`), as ids in the tower's transport
    /// order, so a frontend can point at them. Where the floor's real
    /// commute wait sets its reading (`fold_commute_waits`), that is every
    /// passenger elevator stopping there, since the wait is a wait for a car.
    /// Otherwise it is the transport, or the transports tied for it, with
    /// the highest estimate on the floor. Empty for a floor with no reading.
    /// It runs the reading's load pass once and reads both the floor's
    /// reading and each transport's estimate from it, so the two cannot
    /// disagree; still a read for a tap, not a frame.
    pub fn congestion_cause(&self, floor: i64) -> Vec<i64> {
        let loads = self.shaft_loads();
        let (mut ratios, _) = Self::spatial_from(loads.as_ref(), false);
        self.fold_commute_waits(&mut ratios, None);
        let Some(&reading) = ratios.get(&floor) else {
            return Vec::new();
        };
        let at_floor = loads
            .as_ref()
            .and_then(|l| l.shafts.floors.get(&floor))
            .map_or(&[][..], |(_, at)| at.as_slice());
        let readings: Vec<f64> = at_floor
            .iter()
            .map(|&(slot, cap, _)| {
                loads
                    .as_ref()
                    .map_or(0.0, |l| shaft_reading(l.load_by_shaft[slot], cap, l.rush))
            })
            .collect();
        let estimate = readings.iter().copied().fold(0.0, f64::max);
        let waits_set_it = reading > estimate;
        let ids = |slot: usize| loads.as_ref().map(|l| l.shafts.ids[slot]);
        at_floor
            .iter()
            .zip(&readings)
            .filter(|((_, _, kind), &r)| {
                if waits_set_it {
                    kind.is_elevator()
                } else {
                    r == estimate && r > 0.0
                }
            })
            .filter_map(|(&(slot, _, _), _)| ids(slot))
            .collect()
    }

    /// Raises each floor's transport estimate to the floor's real average
    /// commute wait over the mode's limit where that is higher
    /// (`commute_wait_congestion`, #1971). A floor the estimate has no
    /// reading for joins the map after the estimate's floors, lowest first,
    /// when its tenants' trips have waited at all. Commute waits are waits
    /// for a car (stairs and escalators keep nobody waiting), so where the
    /// real wait wins, the floor's `attribution` binds on the elevators.
    ///
    /// The estimate's floors are raised by lookup. The averages are walked
    /// in floor order only when some recorded floor is missing from the
    /// estimate, which on a grown tower is the usual case: basement trips
    /// record floors the estimate does not list.
    fn fold_commute_waits(
        &self,
        ratios: &mut IndexMap<i64, f64>,
        mut attribution: Option<&mut IndexMap<i64, CongestionAttribution>>,
    ) {
        let waits = &self.crowd.commute_wait_by_floor;
        if waits.is_empty() {
            return;
        }
        let raise =
            |floor: i64, real: f64, att: &mut Option<&mut IndexMap<i64, CongestionAttribution>>| {
                if let Some(att) = att.as_deref_mut() {
                    let a = att.entry(floor).or_default();
                    a.elevator = a.elevator.max(real);
                }
            };
        let mut matched = 0;
        for (&floor, estimate) in ratios.iter_mut() {
            if !waits.contains_key(&floor) {
                continue;
            }
            matched += 1;
            let real = self.commute_wait_congestion(floor);
            if real > *estimate {
                *estimate = real;
                raise(floor, real, &mut attribution);
            }
        }
        if matched == waits.len() {
            return;
        }
        for (&floor, _) in waits.sorted() {
            if ratios.contains_key(&floor) {
                continue;
            }
            let real = self.commute_wait_congestion(floor);
            if real > 0.0 {
                ratios.insert(floor, real);
                raise(floor, real, &mut attribution);
            }
        }
    }

    /// `buildSpatialCongestion` (the retired TypeScript
    /// `src/engine/sim/congestion.ts`): the ratio map and, when
    /// `with_attribution` is set, the per-class attribution, from one pass. The
    /// ratio readers (the overlay, the hotspot, the hourly satisfaction pass)
    /// leave it unset: the map is empty then, not built and dropped.
    fn build_spatial_congestion(
        &self,
        with_attribution: bool,
    ) -> (IndexMap<i64, f64>, IndexMap<i64, CongestionAttribution>) {
        Self::spatial_from(self.shaft_loads().as_ref(), with_attribution)
    }

    /// The readings of `build_spatial_congestion` from loads already
    /// gathered, so a reader that also needs the per-transport loads
    /// (`congestion_cause`) gathers them once.
    fn spatial_from(
        loads: Option<&ShaftLoads>,
        with_attribution: bool,
    ) -> (IndexMap<i64, f64>, IndexMap<i64, CongestionAttribution>) {
        let mut result: IndexMap<i64, f64> = IndexMap::new();
        let mut attribution: IndexMap<i64, CongestionAttribution> = IndexMap::new();
        let Some(&ShaftLoads {
            shafts: ref shafts_by_floor,
            ref load_by_shaft,
            ref pop_by_floor,
            rush,
        }) = loads
        else {
            return (result, attribution);
        };
        for (f, (_, shafts)) in &shafts_by_floor.floors {
            if *f != 1 && !pop_by_floor.contains_key(f) {
                continue;
            }
            let mut c = 0.0;
            let mut att = CongestionAttribution::default();
            for (slot, cap, kind) in shafts {
                let cong = shaft_reading(load_by_shaft[*slot], *cap, rush);
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

    /// The demand each transport carries: the populated floors' people
    /// (less the Metro's and the garage's relief) shared over the transports
    /// that stop on each floor by capacity. `None` when no floor off the
    /// ground lobby holds anyone, the case where every reading is empty.
    fn shaft_loads(&self) -> Option<ShaftLoads> {
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
            return None;
        }
        let parking = self.tower.functional_parking_spots();
        let relief = (1.0 - metro as f64 * 0.25 - parking as f64 * 0.02).max(0.4);
        let shafts = self.congestion_shafts();
        let mut load_by_shaft = vec![0.0; shafts.slots];
        for (f, pop) in &pop_by_floor {
            let Some((total_cap, at_floor)) = shafts.floors.get(f) else {
                continue;
            };
            if *total_cap <= 0.0 {
                continue;
            }
            let demand = pop * relief;
            for &(slot, cap, _) in at_floor {
                load_by_shaft[slot] += demand * (cap / total_cap);
            }
        }
        Some(ShaftLoads {
            shafts,
            load_by_shaft,
            pop_by_floor,
            rush: self.rush_factor(),
        })
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
            table.ids.push(t.id);
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

/// One transport's congestion reading: its share of the demand at the rush
/// over the load its capacity carries. A transport with no capacity reads
/// as fully jammed.
fn shaft_reading(load: f64, cap: f64, rush: f64) -> f64 {
    if cap > 0.0 {
        (load * rush) / (cap * HEADROOM)
    } else {
        99.0
    }
}

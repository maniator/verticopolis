//! Port of `crowd/visits.ts`: attendance round trips and the dwell entry.

use super::meals::matches_meal_origin_kind;
use super::spawn::{add, inside_x, venue_has_room, Options, SpawnFloors};
use super::{dwell_seconds_range, Crowd, PState};
use crate::clock::Clock;
use crate::facilities::Kind;
use crate::tower::Tower;

pub const WEDDING_ARRIVAL_START: i64 = 11;
pub const WEDDING_ARRIVAL_END: i64 = 14;
const METRO_VISIT_SHARE: f64 = 0.5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VisitOrigin {
    Outside,
    Condo,
    Office,
    Hotel,
}

fn visit_origins(kind: Kind) -> Option<&'static [VisitOrigin]> {
    Some(match kind {
        Kind::Cinema => &[
            VisitOrigin::Outside,
            VisitOrigin::Condo,
            VisitOrigin::Office,
            VisitOrigin::Hotel,
        ],
        Kind::PartyHall => &[VisitOrigin::Outside, VisitOrigin::Condo, VisitOrigin::Hotel],
        Kind::WeddingHall => &[VisitOrigin::Outside],
        Kind::AquaticCenter => &[VisitOrigin::Outside, VisitOrigin::Condo, VisitOrigin::Hotel],
        _ => return None,
    })
}

fn origin_floors_for(origin: VisitOrigin, floors: &SpawnFloors) -> &[i64] {
    match origin {
        VisitOrigin::Condo => &floors.condo_floors,
        VisitOrigin::Office => &floors.staffed_offices,
        VisitOrigin::Hotel => &floors.hotel_floors,
        VisitOrigin::Outside => &[],
    }
}

fn meal_origin_of(origin: VisitOrigin) -> super::meals::MealOrigin {
    match origin {
        VisitOrigin::Condo => super::meals::MealOrigin::Condo,
        VisitOrigin::Office => super::meals::MealOrigin::Office,
        VisitOrigin::Hotel => super::meals::MealOrigin::Hotel,
        VisitOrigin::Outside => unreachable!(),
    }
}

pub fn push_venue_visit_options(
    crowd: &mut Crowd,
    _tower: &Tower,
    clock: &Clock,
    floors: &SpawnFloors,
    options: &mut Options,
) {
    let hour = clock.hour();
    let mut push_visits = |kind: Kind, venue_floors: &[i64]| {
        for &origin in visit_origins(kind).unwrap() {
            if origin != VisitOrigin::Outside && origin_floors_for(origin, floors).is_empty() {
                continue;
            }
            options.push_venue_visit(kind, venue_floors.to_vec(), origin);
        }
    };
    if let Some(cinemas) = floors.venues_by_kind.get(&Kind::Cinema) {
        if !cinemas.is_empty() {
            push_visits(Kind::Cinema, cinemas);
            if !crowd.blockbusters.is_empty() {
                let mut bb: Vec<i64> = Vec::new();
                for &f in cinemas {
                    for &id in floors.units_on(f) {
                        let u = _tower.get_unit(id).unwrap();
                        if u.kind == Kind::Cinema && crowd.blockbusters.contains(&u.id) {
                            bb.push(f);
                            break;
                        }
                    }
                }
                if !bb.is_empty() {
                    push_visits(Kind::Cinema, &bb);
                }
            }
        }
    }
    if let Some(halls) = floors.venues_by_kind.get(&Kind::PartyHall) {
        if !halls.is_empty() {
            push_visits(Kind::PartyHall, halls);
        }
    }
    if let Some(pools) = floors.venues_by_kind.get(&Kind::AquaticCenter) {
        if !pools.is_empty() {
            push_visits(Kind::AquaticCenter, pools);
        }
    }
    if let Some(weddings) = floors.venues_by_kind.get(&Kind::WeddingHall) {
        if !weddings.is_empty()
            && clock.is_weekend()
            && (WEDDING_ARRIVAL_START..WEDDING_ARRIVAL_END).contains(&hour)
        {
            push_visits(Kind::WeddingHall, weddings);
        }
    }
}

fn pick_outside_street_door(
    crowd: &mut Crowd,
    tower: &Tower,
    floors: &SpawnFloors,
    kind: Kind,
) -> (i64, Option<i64>) {
    if kind != Kind::Cinema && kind != Kind::PartyHall {
        return (1, None);
    }
    if floors.metro_stations.is_empty() {
        return (1, None);
    }
    let served: Vec<i64> = floors
        .metro_stations
        .iter()
        .copied()
        .filter(|&id| tower.is_metro_platform_served(tower.get_unit(id).unwrap()))
        .collect();
    if served.is_empty() {
        return (1, None);
    }
    if !crowd.rng.chance(METRO_VISIT_SHARE) {
        return (1, None);
    }
    let sid = *crowd.rng.pick(&served);
    (tower.get_unit(sid).unwrap().floor + 1, Some(sid))
}

pub fn spawn_venue_visit(
    crowd: &mut Crowd,
    tower: &mut Tower,
    kind: Kind,
    venue_floors: &[i64],
    floors: &SpawnFloors,
    hour: i64,
    origin: VisitOrigin,
) {
    if !kind.is_open_at(hour) {
        return;
    }
    let Some(rows) = visit_origins(kind) else {
        return;
    };
    if !rows.contains(&origin) {
        return;
    }
    let venue_floor = *crowd.rng.pick(venue_floors);
    let candidates: Vec<i64> = floors
        .units_on(venue_floor)
        .iter()
        .copied()
        .filter(|&id| {
            let u = tower.get_unit(id).unwrap();
            u.kind == kind
                && (if kind == Kind::WeddingHall {
                    u.is_operational()
                } else {
                    u.is_tenanted()
                })
                && venue_has_room(u)
        })
        .collect();
    if candidates.is_empty() {
        return;
    }
    let pool: Vec<i64> = if kind == Kind::Cinema && !crowd.blockbusters.is_empty() {
        candidates
            .iter()
            .flat_map(|&id| {
                if crowd.blockbusters.contains(&id) {
                    vec![id, id]
                } else {
                    vec![id]
                }
            })
            .collect()
    } else {
        candidates
    };
    let venue_id = *crowd.rng.pick(&pool);
    let origin_floor;
    let mut origin_room: Option<i64> = None;
    let mut origin_station: Option<i64> = None;
    if origin == VisitOrigin::Outside {
        let (f, st) = pick_outside_street_door(crowd, tower, floors, kind);
        origin_floor = f;
        origin_station = st;
    } else {
        let bin = origin_floors_for(origin, floors);
        if bin.is_empty() {
            return;
        }
        let room_floor = *crowd.rng.pick(bin);
        let mo = meal_origin_of(origin);
        let rooms: Vec<i64> = floors
            .units_on(room_floor)
            .iter()
            .copied()
            .filter(|&id| {
                let r = tower.get_unit(id).unwrap();
                matches_meal_origin_kind(r, mo) && r.visible_occupants() > 0
            })
            .collect();
        if rooms.is_empty() {
            return;
        }
        origin_room = Some(*crowd.rng.pick(&rooms));
        origin_floor = room_floor;
    }
    let (vx, vw) = {
        let v = tower.get_unit(venue_id).unwrap();
        (v.x, v.width)
    };
    let origin_x = origin_room.map(|id| tower.get_unit(id).unwrap().x);
    let Some(i) = add(crowd, tower, origin_floor, venue_floor, origin_x, Some(vx)) else {
        return;
    };
    crowd.people[i].dest_x = crowd.rng.int(vx, vx + vw - 1) as f64;
    crowd.people[i].meal_venue_id = Some(venue_id);
    if let Some(sid) = origin_station {
        let st = tower.get_unit(sid).unwrap().clone();
        crowd.people[i].x = inside_x(crowd, &st, 2) as f64;
    }
    if let Some(rid) = origin_room {
        crowd.people[i].origin_unit_id = Some(rid);
        let r = tower.get_unit_mut(rid).unwrap();
        r.out_for_meal = Some(r.out_for_meal.unwrap_or(0) + 1);
        tower.bump_meal_overlay_revision();
    }
}

/// `beginDwell`: the outbound arrival of a round-tripper.
pub fn begin_dwell(crowd: &mut Crowd, tower: &mut Tower, i: usize) {
    {
        let p = &mut crowd.people[i];
        p.state = PState::Dwelling;
        p.linger = 0.0;
        p.age = 0.0;
    }
    let venue_id = crowd.people[i].meal_venue_id;
    let venue_kind = venue_id.and_then(|id| tower.get_unit(id)).map(|u| u.kind);
    let (min, max) = dwell_seconds_range(venue_kind);
    crowd.people[i].dwell_seconds_left = Some(crowd.rng.int(min, max) as f64);
    let Some(vid) = venue_id else { return };
    if tower.get_unit(vid).is_none() {
        return;
    }
    let (kind, tenanted, operational, customers) = {
        let v = tower.get_unit(vid).unwrap();
        (
            v.kind,
            v.is_tenanted(),
            v.is_operational(),
            v.customers_in.unwrap_or(0),
        )
    };
    let cap = kind.attendance_cap();
    let pop = kind.facility().population;
    if kind.is_commercial() && tenanted && pop > 0 && customers < pop {
        crowd.people[i].venue_unit_id = Some(vid);
        let origin_is_hotel = crowd.people[i]
            .origin_unit_id
            .and_then(|id| tower.get_unit(id))
            .is_some_and(|u| u.kind.is_hotel());
        let v = tower.get_unit_mut(vid).unwrap();
        v.customers_in = Some(customers + 1);
        if origin_is_hotel {
            crowd.people[i].counted_hotel_guest = true;
            v.hotel_customers_in = Some(v.hotel_customers_in.unwrap_or(0) + 1);
        }
        tower.bump_meal_overlay_revision();
    } else if let Some(cap) = cap {
        let gate = if kind == Kind::WeddingHall {
            operational
        } else {
            tenanted
        };
        if gate && customers < cap {
            crowd.people[i].venue_unit_id = Some(vid);
            let v = tower.get_unit_mut(vid).unwrap();
            v.customers_in = Some(customers + 1);
            v.sync_attendance_occupants();
            tower.bump_meal_overlay_revision();
        }
    }
}

//! Meal trips out of a floor for lunch and dinner.

use super::{add, venue_has_room, MealPool, Opt, Options};
use crate::clock::Clock;
use crate::crowd::meals::{
    matches_meal_origin_kind, meal_window_for, outbound_weight, staff_on_shift, MealOrigin,
};
use crate::crowd::spawn_floors::SpawnFloors;
use crate::crowd::Crowd;
use crate::facilities::Kind;
use crate::jsmath;
use crate::tower::Tower;

pub(super) fn push_meal_options(
    crowd: &mut Crowd,
    tower: &Tower,
    clock: &Clock,
    floors: &SpawnFloors,
    options: &mut Options,
) {
    let Some(window) = meal_window_for(clock.hour()) else {
        return;
    };
    let (start, end) = window.bounds();
    let hour_frac = clock.minute_of_day() / 60.0 - start as f64;
    let t = (hour_frac / (end - start) as f64).clamp(0.0, 1.0);
    let outbound = outbound_weight(t);
    let venue_floors: Vec<i64> = window
        .venues()
        .iter()
        .flat_map(|k| floors.venues_by_kind.get(k).cloned().unwrap_or_default())
        .collect();
    if venue_floors.is_empty() {
        return;
    }
    let shift = tower.mode.housekeeping_shift();
    let mut pools: Vec<MealPool> = Vec::new();
    let mut push = |origin_kind: MealOrigin, list: Vec<i64>| {
        if !list.is_empty() && origin_kind.weight() > 0.0 {
            pools.push(MealPool {
                origin_kind,
                floors: list,
            });
        }
    };
    for &kind in window.origins() {
        match kind {
            MealOrigin::Office => push(MealOrigin::Office, floors.staffed_offices.clone()),
            MealOrigin::Condo => push(MealOrigin::Condo, floors.condo_floors.clone()),
            MealOrigin::Hotel => push(MealOrigin::Hotel, floors.hotel_floors.clone()),
            MealOrigin::Staff => {
                let on_shift: Vec<i64> = floors
                    .staff_floors
                    .iter()
                    .filter(|(k, _)| staff_on_shift(*k, clock.hour(), shift))
                    .map(|(_, f)| *f)
                    .collect();
                push(MealOrigin::Staff, on_shift);
            }
        }
    }
    if pools.is_empty() {
        return;
    }
    let outbound_base = jsmath::round(outbound * 3.0).max(0.0) as i64;
    for (pi, pool) in pools.iter().enumerate() {
        for _ in 0..outbound_base {
            let w = pool.origin_kind.weight();
            if w >= 1.0 || crowd.rng.chance(w) {
                options.opts.push(Opt::MealOutbound(pi));
            }
        }
    }
    options.pools = pools;
    options.venue_floors = venue_floors;
    options.venue_kinds = window.venues();
}

pub(super) fn spawn_meal_outbound(
    crowd: &mut Crowd,
    tower: &mut Tower,
    pool: &MealPool,
    venue_floors: &[i64],
    venue_kinds: &[Kind],
    hour: i64,
    floors: &SpawnFloors,
) {
    let origin_floor = *crowd.rng.pick(&pool.floors);
    let shift = tower.mode.housekeeping_shift();
    let candidates: Vec<i64> = floors
        .units_on(origin_floor)
        .iter()
        .copied()
        .filter(|&id| {
            let u = tower.get_unit(id).unwrap();
            matches_meal_origin_kind(u, pool.origin_kind)
                && (pool.origin_kind != MealOrigin::Staff || staff_on_shift(u.kind, hour, shift))
                && u.visible_occupants() > 0
        })
        .collect();
    if candidates.is_empty() {
        return;
    }
    let origin_id = *crowd.rng.pick(&candidates);
    let venue_floor = *crowd.rng.pick(venue_floors);
    let venue_candidates: Vec<i64> = floors
        .units_on(venue_floor)
        .iter()
        .copied()
        .filter(|&id| {
            let u = tower.get_unit(id).unwrap();
            venue_kinds.contains(&u.kind)
                && u.is_tenanted()
                && u.kind.is_open_at(hour)
                && venue_has_room(u)
        })
        .collect();
    if venue_candidates.is_empty() {
        return;
    }
    let venue_id = *crowd.rng.pick(&venue_candidates);
    let (ox, vx, vw) = {
        let o = tower.get_unit(origin_id).unwrap();
        let v = tower.get_unit(venue_id).unwrap();
        (o.x, v.x, v.width)
    };
    let Some(i) = add(crowd, tower, origin_floor, venue_floor, Some(ox), Some(vx)) else {
        return;
    };
    crowd.people[i].dest_x = crowd.rng.int(vx, vx + vw - 1) as f64;
    crowd.people[i].meal_venue_id = Some(venue_id);
    crowd.people[i].origin_unit_id = Some(origin_id);
    let (origin, at) = tower.marked_by_id(origin_id).unwrap();
    origin.set_out_for_meal(at, Some(origin.out_for_meal.unwrap_or(0) + 1));
    tower.bump_meal_overlay_revision();
}

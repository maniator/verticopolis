//! Port of `crowd/routines.ts` (Modern-only demographic routines).

use super::spawn::{add, Options, SpawnFloors};
use super::Crowd;
use crate::clock::Clock;
use crate::facilities::Kind;
use crate::tower::Tower;

const GROUND_LOBBY: i64 = 1;
const SCHOOL_RUN_DEPART_START: i64 = 7;
const SCHOOL_RUN_DEPART_END: i64 = 8;
const SCHOOL_RUN_RETURN_START: i64 = 15;
const SCHOOL_RUN_RETURN_END: i64 = 16;
const SALES_CALL_START: i64 = 10;
const SALES_CALL_END: i64 = 15;

fn passes(crowd: &mut Crowd, weight: f64) -> bool {
    weight >= 1.0 || crowd.rng.chance(weight)
}

pub fn push_routine_options(
    crowd: &mut Crowd,
    tower: &Tower,
    clock: &Clock,
    floors: &SpawnFloors,
    options: &mut Options,
) {
    let (school_run, sales_call) = tower.mode.demographic_routines();
    if school_run <= 0.0 && sales_call <= 0.0 {
        return;
    }
    let hour = clock.hour();
    if school_run > 0.0 && !clock.is_weekend() && !floors.household_floors.is_empty() {
        if (SCHOOL_RUN_DEPART_START..SCHOOL_RUN_DEPART_END).contains(&hour)
            && passes(crowd, school_run)
        {
            options.push_school_departure();
        }
        if (SCHOOL_RUN_RETURN_START..SCHOOL_RUN_RETURN_END).contains(&hour)
            && passes(crowd, school_run)
        {
            options.push_school_return();
        }
    }
    if sales_call > 0.0
        && !floors.staffed_offices.is_empty()
        && (SALES_CALL_START..SALES_CALL_END).contains(&hour)
        && passes(crowd, sales_call)
    {
        options.push_sales_call();
    }
}

pub fn spawn_school_departure(crowd: &mut Crowd, tower: &mut Tower, floors: &SpawnFloors) {
    let floor = *crowd.rng.pick(&floors.household_floors);
    let candidates: Vec<i64> = floors
        .units_on(floor)
        .iter()
        .copied()
        .filter(|&id| {
            let u = tower.get_unit(id).unwrap();
            u.kind.has_household() && u.visible_occupants() > 0
        })
        .collect();
    if candidates.is_empty() {
        return;
    }
    let origin_id = *crowd.rng.pick(&candidates);
    let ox = tower.get_unit(origin_id).unwrap().x;
    let Some(i) = add(crowd, tower, floor, GROUND_LOBBY, Some(ox), None) else {
        return;
    };
    let p = &mut crowd.people[i];
    p.routine = Some("schoolRun");
    p.origin_unit_id = Some(origin_id);
    p.returning = true;
    let o = tower.get_unit_mut(origin_id).unwrap();
    o.out_for_meal = Some(o.out_for_meal.unwrap_or(0) + 1);
    tower.bump_meal_overlay_revision();
}

pub fn spawn_school_return(crowd: &mut Crowd, tower: &mut Tower, floors: &SpawnFloors) {
    let floor = *crowd.rng.pick(&floors.household_floors);
    if let Some(i) = add(crowd, tower, GROUND_LOBBY, floor, None, None) {
        crowd.people[i].routine = Some("schoolRun");
    }
}

pub fn spawn_sales_call(crowd: &mut Crowd, tower: &mut Tower, floors: &SpawnFloors) {
    let floor = *crowd.rng.pick(&floors.staffed_offices);
    let candidates: Vec<i64> = floors
        .units_on(floor)
        .iter()
        .copied()
        .filter(|&id| {
            let u = tower.get_unit(id).unwrap();
            u.kind == Kind::Office && u.visible_occupants() > 0
        })
        .collect();
    if candidates.is_empty() {
        return;
    }
    let origin_id = *crowd.rng.pick(&candidates);
    let ox = tower.get_unit(origin_id).unwrap().x;
    let Some(i) = add(crowd, tower, floor, GROUND_LOBBY, Some(ox), None) else {
        return;
    };
    let p = &mut crowd.people[i];
    p.routine = Some("salesCall");
    p.origin_unit_id = Some(origin_id);
    let o = tower.get_unit_mut(origin_id).unwrap();
    o.out_for_meal = Some(o.out_for_meal.unwrap_or(0) + 1);
    tower.bump_meal_overlay_revision();
}

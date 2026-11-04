//! What a step does around its images, as the edit commands do around
//! theirs: the VIP visit day only where an edit set it, the visit called
//! off with the last Wedding Hall, the riders of a car or a shaft taken
//! away let off, a shaft put back with its cars empty, an emergency's
//! answer kept out of the step, a name the simulation gave since kept, and
//! the pooled shaft caps.
use super::check_tests::{lift, meanwhile, refused, sell};
use super::tests::{gesture, office, tower};
use super::StepRefused;
use crate::crowd::spawn::make_person;
use crate::crowd::{motion, PState, Route};
use crate::events::PendingChoice;
use crate::facilities::{Kind, POOLED_CAPS};
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A tower with floor up to floor 100, where a Wedding Hall can go.
fn tall() -> Simulation {
    let mut sim = tower();
    for floor in 5..=100 {
        for x in 10..70 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok);
        }
    }
    sim
}

/// The VIP's visit, with no hall standing to impress them: they come back
/// in five days.
fn an_unimpressed_visit(sim: &mut Simulation) {
    sim.vip_visit_day = sim.clock.day() as f64;
    sim.tower.built_wedding_hall = Some(true);
    sim.check_vip();
    assert_eq!(sim.vip_visit_day, (sim.clock.day() + 5) as f64);
}

#[test]
fn the_vip_day_time_moves_is_no_part_of_a_step() {
    let mut sim = tower();
    assert!(
        gesture(&mut sim, |s| meanwhile(s, an_unimpressed_visit)).is_none(),
        "a gesture that changed nothing leaves no step"
    );
    let again = sim.vip_visit_day;
    let step = gesture(&mut sim, |s| {
        office(s, 2, 12);
        meanwhile(s, an_unimpressed_visit);
    })
    .unwrap();
    assert_eq!(step.vip_visit_day, None);
    sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.vip_visit_day, again, "the VIP does not come back early");
}

#[test]
fn undoing_the_last_wedding_hall_calls_off_the_visit() {
    let mut sim = tall();
    let build = gesture(&mut sim, |s| {
        assert!(s.build(Kind::WeddingHall, 100, 12).ok)
    })
    .unwrap();
    // The VIP came and went, and set a new day; the undo still calls off
    // the visit, as a sale of the last hall does.
    an_unimpressed_visit(&mut sim);
    let after_the_visit = sim.vip_visit_day;
    let redo = sim.apply_undo_step(&build).unwrap();
    assert_eq!(sim.tower.built_wedding_hall, Some(false));
    assert_eq!(sim.vip_visit_day, -1.0);
    sim.apply_undo_step(&redo).unwrap();
    assert_eq!(
        sim.vip_visit_day, after_the_visit,
        "the redo puts the day back"
    );
}

/// A person on board car `car` of shaft `id`, going from floor 1 to 3.
fn on_board(sim: &mut Simulation, id: i64, car: i64) {
    let route = Route {
        floors: vec![1, 3],
        shafts: vec![id],
    };
    let i = make_person(&mut sim.crowd, &sim.tower, route, 30.0, None);
    let p = &mut sim.crowd.people[i];
    (p.state, p.shaft_id, p.car_index) = (PState::Riding, Some(id), Some(car));
    sim.crowd.car_riders.insert((id, car), 1);
}

/// Whether anyone in the crowd rides shaft `id`.
fn anyone_rides(sim: &Simulation, id: i64) -> bool {
    sim.crowd
        .people
        .iter()
        .any(|p| p.state == PState::Riding && p.shaft_id == Some(id))
}

#[test]
fn the_riders_of_a_car_or_a_shaft_a_step_takes_away_get_off() {
    let mut sim = tower();
    let id = lift(&mut sim);
    let car = gesture(&mut sim, |s| assert!(s.add_car(id).ok)).unwrap();
    on_board(&mut sim, id, 1);
    assert!(anyone_rides(&sim, id));
    sim.apply_undo_step(&car).unwrap();
    assert_eq!(sim.tower.get_transport(id).unwrap().cars, 1);
    motion::advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert!(!anyone_rides(&sim, id), "off the car");
    assert_eq!(sim.crowd.car_riders[&(id, 1)], 0, "and its seat free");

    let mut sim = tower();
    let mut id = 0;
    let shaft = gesture(&mut sim, |s| id = lift(s)).unwrap();
    on_board(&mut sim, id, 0);
    sim.apply_undo_step(&shaft).unwrap();
    assert!(sim.tower.get_transport(id).is_none());
    motion::advance(&mut sim.crowd, 0.1, &mut sim.tower);
    assert!(!anyone_rides(&sim, id), "off the shaft");
}

#[test]
fn a_shaft_put_back_comes_back_with_its_cars_empty() {
    let mut sim = tower();
    let id = lift(&mut sim);
    assert!(sim.add_car(id).ok);
    let t = sim.tower.get_transport_mut(id).unwrap();
    (t.car_positions, t.car_dir, t.car_load) = (vec![2.5, 3.0], vec![1, -1], Some(vec![4.0, 2.0]));
    let sale = gesture(&mut sim, |s| sell(s, id)).unwrap();
    let redo = sim.apply_undo_step(&sale).unwrap();
    let t = sim.tower.get_transport(id).unwrap();
    assert_eq!(
        t.car_positions,
        [1.0, 2.0],
        "where a new shaft's cars stand"
    );
    assert_eq!(t.car_dir, [0, 0]);
    assert_eq!(t.car_load, None, "with nobody in them");
    sim.apply_undo_step(&redo).expect("the sale goes again");
}

#[test]
fn an_emergency_answered_during_a_gesture_is_no_part_of_its_step() {
    let mut sim = tower();
    let burning = office(&mut sim, 2, 30);
    assert!(sim.tower.set_label(burning, "Acme"));
    sim.tower.get_unit_mut(burning).unwrap().state = UnitState::Fire;
    sim.events.active.insert(burning);
    sim.events.pending = Some(PendingChoice {
        kind: "fireRescue",
        cost: 1.0,
        message: String::new(),
    });
    let mut built = 0;
    let step = gesture(&mut sim, |s| {
        built = office(s, 2, 12);
        s.resolve_choice(true);
    })
    .unwrap();
    let u = sim.tower.get_unit(burning).unwrap();
    assert_eq!((u.state, u.label.as_str()), (UnitState::Gutted, "Office"));
    let touched: Vec<i64> = step.units.iter().map(|img| img.id).collect();
    assert_eq!(touched, [built], "the gutted room is time's doing");
}

#[test]
fn an_undo_keeps_a_name_the_simulation_gave_since() {
    let mut sim = tower();
    let id = office(&mut sim, 2, 12);
    let was = sim.tower.get_unit(id).unwrap().rent;
    let step = gesture(&mut sim, |s| assert!(s.price_unit(id, 20_000.0).is_some())).unwrap();
    let priced = sim.tower.get_unit(id).unwrap().rent;
    assert_ne!(was, priced);
    // A company moves in and the office takes its name.
    assert!(sim.tower.set_label(id, "Acme"));
    let redo = sim.apply_undo_step(&step).unwrap();
    let u = sim.tower.get_unit(id).unwrap();
    assert_eq!((u.rent, u.label.as_str()), (was, "Acme"));
    sim.apply_undo_step(&redo).unwrap();
    let u = sim.tower.get_unit(id).unwrap();
    assert_eq!((u.rent, u.label.as_str()), (priced, "Acme"));
}

#[test]
fn a_shaft_the_step_shrinks_makes_room_for_one_it_puts_back() {
    let mut sim = tower();
    assert!(sim.build_transport(Kind::ElevatorStandard, 15, 1, 4).ok);
    let low = sim.tower.transport_at(1, 15).unwrap().id;
    let step = gesture(&mut sim, |s| {
        assert!(s.resize_transport(low, 1, 2).ok);
        let r = s.build_transport(Kind::ElevatorStandard, 15, 3, 4);
        assert!(r.ok, "{:?}", r.reason);
    })
    .unwrap();
    let redo = sim.apply_undo_step(&step).unwrap();
    assert_eq!(sim.tower.get_transport(low).unwrap().top, 4);
    sim.apply_undo_step(&redo)
        .expect("the redo shrinks one and puts back the other");
    assert_eq!(sim.tower.get_transport(low).unwrap().top, 2);
    assert!(sim.tower.transport_at(4, 15).is_some_and(|t| t.id != low));
}

/// The spot of the `n`th shaft of `kinds` (taken in turn) stacked in
/// columns across the lot on floors 1 to 12: its kind, column and floors.
/// Each column holds six elevators (floors 1-2, 3-4 and on), or eleven links
/// end to end (1-2, 2-3 and on).
fn spot(kinds: &[Kind], n: i64) -> (Kind, i64, i64, i64) {
    let width = kinds.iter().map(|k| k.facility().width).max().unwrap();
    let fixed = kinds[0].is_fixed_span();
    let (per_column, rise) = if fixed { (11, 1) } else { (6, 2) };
    let bottom = 1 + (n % per_column) * rise;
    let kind = kinds[n as usize % kinds.len()];
    (kind, 10 + (n / per_column) * width, bottom, bottom + 1)
}

fn build_at(sim: &mut Simulation, (kind, x, bottom, top): (Kind, i64, i64, i64)) {
    let r = sim.build_transport(kind, x, bottom, top);
    assert!(r.ok, "{kind:?} at {x}, {bottom}: {:?}", r.reason);
}

#[test]
fn a_shaft_is_never_put_back_past_its_pooled_cap() {
    let elevators = [
        Kind::ElevatorStandard,
        Kind::ElevatorService,
        Kind::ElevatorExpress,
    ];
    for kinds in [&elevators[..], &[Kind::Stairs, Kind::Escalator]] {
        let mut sim = tower();
        for floor in 5..=12 {
            for x in 10..70 {
                assert!(sim.tower.place(Kind::Floor, floor, x).ok);
            }
        }
        let cap = POOLED_CAPS
            .iter()
            .find(|p| p.kinds.contains(&kinds[0]))
            .unwrap()
            .cap;
        for n in 0..cap - 1 {
            build_at(&mut sim, spot(kinds, n));
        }
        let last = gesture(&mut sim, |s| build_at(s, spot(kinds, cap - 1))).unwrap();
        let redo = sim.apply_undo_step(&last).unwrap();
        assert_eq!(sim.check_undo_step(&redo), Ok(()), "the pool has room");
        build_at(&mut sim, spot(kinds, cap));
        refused(&mut sim, &redo, StepRefused::Blocked);
    }
}

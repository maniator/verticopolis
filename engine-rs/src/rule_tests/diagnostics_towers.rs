//! The diagnostics facts (#1215) on constructed towers, from the retired
//! `conformanceWasmDiagnosticsTowers.integration.test.ts`, for the branches
//! the diagnostics unit tests do not build: a slot one story above the top
//! against two, a floor past the stair climb, a nightclub's halo, unmet demand
//! outranking a home's noise, a clinic held back by its price, an unsold
//! condo's hold tax rounded up, and unmet demand at zero and partial coverage.
//!
//! Already covered in Rust (`diagnostics::tenant_tests` unless named):
//! - a ground-connected floor no rider reaches:
//!   `a_ground_connected_floor_no_rider_reaches_reads_no_route`
//! - a room off the market: `no_rate_reads_occupied_or_off_the_market`
//! - the slot to clear and the unit on it:
//!   `lobby_distance_names_the_slot_and_the_work_it_needs`
//! - a sinking room's slot: `classic_lobby_distance_sinks_only_in_the_very_far_band`
//! - no slot past a lobby on the last one: `a_room_past_a_lobby_on_the_last_slot_finds_no_slot`
//! - each congestion binding and the elevator stop:
//!   `walkway_bindings_name_their_class_and_the_elevator_stop`
//! - an open spot off the market is held back by nothing:
//!   `wont_lease_names_the_gate_cause_and_the_carrying_cost`
//! - a notice with no deadline: `the_notice_counts_down_and_never_goes_negative`
//! - the demand memo's lag within the hour:
//!   `diagnostics::memo_tests::the_demand_memo_rebuilds_on_each_key_input_and_holds_within_the_hour`
//! - ids that name no unit: `unknown_and_malformed_ids_answer_nothing`
//!
//! The card-check cases (the inspector card shows every fact it is handed)
//! test the TypeScript reference card, which goes with `src/engine/`; the
//! shipped card's text is held by `cardTextParity.integration.test.ts`.
use crate::clock::GameMode;
use crate::diagnostics::DiagnosticFacts;
use crate::econ::rent_config;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::sim::Simulation;
use crate::tower::UnitState;

const C: i64 = LOT_WIDTH / 2;
/// The satisfaction of an unhappy tenant, low enough for the gripe ladder.
const UNHAPPY: f64 = 0.2;
/// A full house of residents for a condo.
const FAMILY: i64 = 3;

/// The ground lobby across the lot and floor slabs on 2..=top.
fn slabs(mode: GameMode, top: i64) -> Simulation {
    let mut sim = Simulation::new_game(11, mode);
    sim.money = 1e12;
    sim.star = 5;
    for x in 0..LOT_WIDTH {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for f in 2..=top {
        for x in 0..LOT_WIDTH {
            assert!(sim.tower.place(Kind::Floor, f, x).ok);
        }
    }
    sim
}

/// A standard elevator at `x` over `bottom..=top` with all 8 cars.
fn elevator(sim: &mut Simulation, x: i64, bottom: i64, top: i64) {
    let r = sim.build_transport(Kind::ElevatorStandard, x, bottom, top);
    assert!(r.ok, "{:?}", r.reason);
    let id = sim.tower.transports.last().unwrap().id;
    assert!(sim.tower.set_cars(id, 8));
}

fn room(sim: &mut Simulation, kind: Kind, floor: i64, x: i64, state: UnitState, sat: f64) -> i64 {
    let r = sim.tower.place(kind, floor, x);
    assert!(r.ok, "{kind:?} at {floor},{x}: {:?}", r.reason);
    let id = r.unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = state;
    u.satisfaction = sat;
    if state != UnitState::Empty {
        u.ever_occupied = true;
    }
    id
}

fn facts(sim: &mut Simulation, id: i64) -> DiagnosticFacts {
    sim.diagnostic_facts(id).expect("a unit")
}

/// The gripe's cause with the coverage fields it carries.
fn demand(f: &DiagnosticFacts) -> Option<(&'static str, Option<f64>, Option<bool>)> {
    f.gripe
        .as_ref()
        .map(|g| (g.cause, g.coverage, g.floor_reachable))
}

#[test]
fn a_slot_one_story_above_the_top_needs_no_support_and_two_stories_does() {
    // Floor 15 sits one story above a 14-floor tower, which a lobby can stand
    // on, and two above a 13-floor one, which needs a floor first.
    for (top, needs_support) in [(13, true), (14, false)] {
        let mut sim = slabs(GameMode::Modern, top);
        elevator(&mut sim, C, 1, top);
        let office = room(&mut sim, Kind::Office, top, 10, UnitState::Occupied, 1.0);
        let slot = facts(&mut sim, office).lobby.and_then(|l| l.slot);
        let slot = slot.unwrap_or_else(|| panic!("top {top}: a slot"));
        assert_eq!(slot.floor, 15, "top {top}");
        assert_eq!(slot.needs_support, needs_support, "top {top}");
        assert!(!slot.on_slot && !slot.clear_first, "top {top}");
    }
}

#[test]
fn a_floor_past_the_stair_climb_reads_no_route_and_unreachable_demand() {
    // Classic riders take at most four flights: floor 7 is on a six-flight
    // stair chain but no one climbs to it.
    let mut sim = slabs(GameMode::Classic, 7);
    for f in 1..7 {
        assert!(sim.build_transport(Kind::Stairs, C, f, f + 1).ok);
    }
    room(&mut sim, Kind::FastFood, 2, C + 6, UnitState::Occupied, 1.0);
    let high = room(
        &mut sim,
        Kind::Office,
        7,
        C + 6,
        UnitState::Occupied,
        UNHAPPY,
    );
    let f = facts(&mut sim, high);
    assert_eq!(f.access, Some("noRoute"));
    assert_eq!(demand(&f), Some(("unmetDemand", Some(0.0), Some(false))));
}

#[test]
fn a_nightclub_casts_a_halo_on_a_home_above_it() {
    let mut sim = slabs(GameMode::Modern, 3);
    elevator(&mut sim, C, 1, 3);
    let home = room(
        &mut sim,
        Kind::Condo,
        2,
        C + 6,
        UnitState::Occupied,
        UNHAPPY,
    );
    sim.tower.get_unit_mut(home).unwrap().residents = Some(FAMILY);
    room(
        &mut sim,
        Kind::Nightclub,
        3,
        C - 60,
        UnitState::Occupied,
        1.0,
    );
    let g = facts(&mut sim, home).gripe.expect("a noise gripe");
    assert_eq!(
        (g.cause, g.adjacent, g.club),
        ("noise", Some(false), Some(true))
    );
}

/// A Modern tower whose one shop no rider reaches: elevators on 1..=3 across
/// the lot and a fast food on floor 5, where no shaft stops, so every tenant
/// and open spot on 2 and 3 reads zero retail coverage.
fn shop_out_of_reach() -> Simulation {
    let mut sim = slabs(GameMode::Modern, 5);
    for sx in (10..LOT_WIDTH - 10).step_by(40) {
        elevator(&mut sim, sx, 1, 3);
    }
    room(&mut sim, Kind::FastFood, 5, 12, UnitState::Occupied, 1.0);
    sim
}

const ZERO_COVERAGE: Option<(&str, Option<f64>, Option<bool>)> =
    Some(("unmetDemand", Some(0.0), Some(true)));

#[test]
fn unmet_demand_at_zero_coverage_outranks_the_noise_a_home_hears_first() {
    // The office next door makes the condo noisy; at zero coverage unmet
    // demand erodes faster than a condo's noise and takes the tier (#548).
    let mut sim = shop_out_of_reach();
    room(&mut sim, Kind::Office, 2, 12, UnitState::Occupied, 1.0);
    let home = room(&mut sim, Kind::Condo, 2, 22, UnitState::Occupied, UNHAPPY);
    sim.tower.get_unit_mut(home).unwrap().residents = Some(FAMILY);
    let unit = sim.tower.get_unit(home).unwrap().clone();
    assert!(sim.noise_afflicted(&unit), "the home is noisy");
    assert_eq!(demand(&facts(&mut sim, home)), ZERO_COVERAGE);
}

#[test]
fn an_unsold_condos_hold_tax_rounds_up() {
    // 1.5% of 123,457 is 1,851.855: the carry is the 700 overhead plus 1,852.
    let mut sim = shop_out_of_reach();
    let condo = room(&mut sim, Kind::Condo, 3, 22, UnitState::Empty, 1.0);
    sim.tower.get_unit_mut(condo).unwrap().rent = Some(123_457.0);
    let w = facts(&mut sim, condo).wont_lease.expect("held back");
    assert_eq!(w.carry, 2_552.0);
    let g = w.gripe.expect("a cause");
    assert_eq!(
        Some((g.cause, g.coverage, g.floor_reachable)),
        ZERO_COVERAGE
    );
}

#[test]
fn a_clinic_priced_at_its_ceiling_is_held_back_by_rent() {
    // A clinic is no unmet-demand origin, so the gate reads its price.
    let mut sim = slabs(GameMode::Modern, 3);
    elevator(&mut sim, C, 1, 3);
    let clinic = room(&mut sim, Kind::Clinic, 2, C + 6, UnitState::Empty, 1.0);
    let ceiling = rent_config(Kind::Clinic).expect("a priced kind").max;
    sim.tower.get_unit_mut(clinic).unwrap().rent = Some(ceiling);
    let w = facts(&mut sim, clinic).wont_lease.expect("held back");
    assert_eq!(w.gripe.map(|g| g.cause), Some("rent"));
}

#[test]
fn unmet_demand_reads_zero_coverage_for_a_tenant_and_a_spot_then_partial() {
    let mut sim = slabs(GameMode::Modern, 5);
    for sx in (10..LOT_WIDTH - 10).step_by(40) {
        elevator(&mut sim, sx, 1, 3);
    }
    let dry = room(&mut sim, Kind::Office, 2, 12, UnitState::Occupied, UNHAPPY);
    // The won't-lease gate reads its own coverage, for a spot on the market.
    let spot = room(&mut sim, Kind::Office, 3, 52, UnitState::Empty, 1.0);
    room(&mut sim, Kind::FastFood, 5, 12, UnitState::Occupied, 1.0);
    assert_eq!(demand(&facts(&mut sim, dry)), ZERO_COVERAGE);
    let g = facts(&mut sim, spot).wont_lease.and_then(|w| w.gripe);
    let g = g.expect("the spot is held back");
    assert_eq!(
        Some((g.cause, g.coverage, g.floor_reachable)),
        ZERO_COVERAGE
    );
    // A reachable shop the whole floor's offices outgrow.
    room(&mut sim, Kind::FastFood, 3, 12, UnitState::Occupied, 1.0);
    for x in (22..LOT_WIDTH - 9).step_by(10) {
        room(&mut sim, Kind::Office, 2, x, UnitState::Occupied, 1.0);
    }
    let (cause, coverage, _) = demand(&facts(&mut sim, dry)).expect("a gripe");
    assert_eq!(cause, "unmetDemand");
    let coverage = coverage.expect("a coverage");
    assert!(coverage > 0.0 && coverage < 1.0, "partial: {coverage}");
}

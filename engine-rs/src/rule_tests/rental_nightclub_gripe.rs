//! A nightclub's beat carries across floors, and the rental Apartment feels
//! it as a condo does (#684): the ladder names noise for it, never the
//! "access" catch-all, and the card offers the cross-floor remedy, not the
//! lobby tile. The forgiving Studio feels no club and is never blamed for
//! one. The condo and guest-room halo is in
//! `rule_tests::move_in_gate_legibility` and `rule_tests::unmet_demand`.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::{calm, lay_row, put, seat, unit, MID as C};

/// A Modern tower with `kind` on floor 2 and a nightclub far along floor 3:
/// inside the cross-floor halo, outside the same-floor noise band.
fn club_tower(kind: Kind) -> (Simulation, i64) {
    let mut sim = Simulation::new_game(9, GameMode::Modern);
    sim.money = 1e9;
    sim.star = 1;
    lay_row(&mut sim, Kind::Lobby, 1);
    lay_row(&mut sim, Kind::Floor, 2);
    lay_row(&mut sim, Kind::Floor, 3);
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 3).ok);
    let lift = sim.tower.transports[0].id;
    assert!(sim.tower.set_cars(lift, 8));
    let id = put(&mut sim, kind, 2, C);
    put(&mut sim, Kind::Nightclub, 3, C - 60);
    seat(&mut sim, id, UnitState::Occupied, 0.5);
    sim.tower.get_unit_mut(id).unwrap().residents = Some(3);
    let u = unit(&sim, id).clone();
    assert!(
        !sim.noise_afflicted(&u),
        "the club is not a same-floor source"
    );
    (sim, id)
}

fn ladder(sim: &Simulation, id: i64) -> Option<&'static str> {
    sim.dominant_gripe(unit(sim, id), &calm())
}

#[test]
fn the_apartment_names_the_club_as_a_condo_does() {
    let (condo_sim, condo) = club_tower(Kind::Condo);
    assert_eq!(ladder(&condo_sim, condo), Some("noise"), "the control");
    let (sim, apt) = club_tower(Kind::RentalApartment);
    assert_eq!(ladder(&sim, apt), Some("noise"));
    assert_eq!(
        sim.vacate_cause(unit(&sim, apt), &calm()),
        "noise",
        "never access"
    );
}

#[test]
fn the_apartments_card_offers_the_club_remedy_and_not_the_lobby_tile() {
    let (mut sim, apt) = club_tower(Kind::RentalApartment);
    let g = sim
        .diagnostic_facts(apt)
        .unwrap()
        .gripe
        .expect("a Main gripe");
    assert_eq!(g.cause, "noise");
    assert_eq!((g.club, g.adjacent), (Some(true), Some(false)));
}

#[test]
fn the_studio_is_not_blamed_for_a_club_it_does_not_feel() {
    let (mut sim, studio) = club_tower(Kind::RentalStudio);
    assert_eq!(ladder(&sim, studio), None);
    assert_eq!(sim.diagnostic_facts(studio).unwrap().gripe, None);
}

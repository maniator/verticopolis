use super::*;
use crate::clock::GameMode;
use crate::facilities::LOT_WIDTH;

const C: i64 = LOT_WIDTH / 2;

/// `servedTower` (moveInGateHelpers.ts) with floors 2..6: a full lobby
/// row, floor slabs, and a center standard elevator with 8 cars.
fn served_tower(seed: u32) -> Simulation {
    served_tower_in(seed, GameMode::Modern)
}

fn served_tower_in(seed: u32, mode: GameMode) -> Simulation {
    let mut sim = Simulation::new_game(seed, mode);
    sim.money = 1e12;
    sim.star = 1;
    for x in 0..LOT_WIDTH {
        sim.tower.place(Kind::Lobby, 1, x);
    }
    for f in 2..=6 {
        for x in 0..LOT_WIDTH {
            sim.tower.place(Kind::Floor, f, x);
        }
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 6).ok);
    let id = sim.tower.transports[0].id;
    assert!(sim.tower.set_cars(id, 8));
    sim
}

/// A sold three-person household at $160,000, the way the TypeScript
/// suite seats one; returns the unit's index.
fn seat_owner(sim: &mut Simulation, floor: i64, x: i64, no_rate: bool) -> usize {
    let r = sim.tower.place(Kind::Condo, floor, x);
    assert!(r.ok, "{:?}", r.reason);
    let id = r.unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = UnitState::Occupied;
    u.ever_occupied = true;
    u.residents = Some(3);
    u.rent = Some(160_000.0);
    u.no_rate = no_rate;
    sim.tower.units.iter().position(|u| u.id == id).unwrap()
}

fn last_line(sim: &Simulation) -> &str {
    &sim.log.last().unwrap().text
}

/// An unsold condo on floor 2 asking `asking`, ready for `move_in`;
/// returns the unit's index.
fn unsold_condo(sim: &mut Simulation, asking: f64) -> usize {
    let r = sim.tower.place(Kind::Condo, 2, C);
    assert!(r.ok, "{:?}", r.reason);
    let id = r.unit_id.unwrap();
    let u = sim.tower.get_unit_mut(id).unwrap();
    u.state = UnitState::Empty;
    u.rent = Some(asking);
    sim.tower.units.iter().position(|u| u.id == id).unwrap()
}

#[test]
fn the_condo_sale_line_matches_the_typescript_wording() {
    // Classic sells at the flat asking price and names no household.
    let mut sim = served_tower_in(30, GameMode::Classic);
    let i = unsold_condo(&mut sim, 150_000.0);
    sim.move_in(i);
    assert_eq!(last_line(&sim), "Condominium on floor 2 sold for $150,000.");
    // Modern rolls a household and scales the price by its size over 3.
    let mut sim = served_tower(31);
    let i = unsold_condo(&mut sim, 160_000.0);
    sim.move_in(i);
    let residents = sim.tower.units[i]
        .residents
        .expect("a Modern sale rolls a household");
    let price = match residents {
        2 => "106,667",
        3 => "160,000",
        4 => "213,333",
        5 => "266,667",
        r => panic!("household of {r}"),
    };
    assert_eq!(
        last_line(&sim),
        format!("Condominium on floor 2 sold to a household of {residents} for ${price}.")
    );
}

#[test]
fn the_buy_back_note_follows_the_gate_verdict() {
    // A live structural drain (an office beside the condo): the gate holds
    // the spot, so every reason reads "stays empty", a congestion one too.
    let mut sim = served_tower(20);
    assert!(sim.tower.place(Kind::Office, 2, C - 9).ok);
    let i = seat_owner(&mut sim, 2, C, false);
    sim.vacate(i, "congestion");
    assert_eq!(
        last_line(&sim),
        "The owner left Condominium on floor 2 (overcrowded vertical transport). You bought it back for $160,000. It stays empty until you fix the cause."
    );
    // No drain: a congestion eviction re-sells, and the note names the
    // elevator and its lever.
    let mut sim = served_tower(22);
    let i = seat_owner(&mut sim, 2, C, false);
    sim.vacate(i, "congestion");
    assert_eq!(
        last_line(&sim),
        "The owner left Condominium on floor 2 (overcrowded vertical transport). You bought it back for $160,000. A new owner will buy in, but the crowded elevators will wear them down too until you add cars."
    );
    // A relocation onto a clean spot carries no caveat.
    let mut sim = served_tower(23);
    let i = seat_owner(&mut sim, 2, C, false);
    sim.vacate(i, "relocation");
    assert_eq!(
        last_line(&sim),
        "The owner left Condominium on floor 2 (the household is relocating). You bought it back for $160,000."
    );
    // A No Rate owned condo points at the rate, whatever the gate says.
    let mut sim = served_tower(25);
    let i = seat_owner(&mut sim, 2, C, true);
    sim.vacate(i, "noise");
    assert_eq!(
        last_line(&sim),
        "The owner left Condominium on floor 2 (a noisy neighbor nearby). You bought it back for $160,000. It is off the market (No Rate); set a rate to sell it again."
    );
    // The buy-back amount goes through the same formatter: a household
    // of 2 at $160,000 is rounded by `household_price` (as
    // `householdPrice` rounds it) before the line, and a fractional
    // stored price with no household (a legacy sold record) reads as
    // `toLocaleString()` reads it.
    let mut sim = served_tower(27);
    let i = seat_owner(&mut sim, 2, C, false);
    sim.tower.units[i].residents = Some(2);
    sim.vacate(i, "relocation");
    assert_eq!(
        last_line(&sim),
        "The owner left Condominium on floor 2 (the household is relocating). You bought it back for $106,667."
    );
    let mut sim = served_tower(28);
    let i = seat_owner(&mut sim, 2, C, false);
    sim.tower.units[i].residents = None;
    sim.tower.units[i].rent = Some(123_456.78);
    sim.vacate(i, "relocation");
    assert_eq!(
        last_line(&sim),
        "The owner left Condominium on floor 2 (the household is relocating). You bought it back for $123,456.78."
    );
    // A never-sold condo and any other kind get the plain line.
    let mut sim = served_tower(26);
    let r = sim.tower.place(Kind::Office, 2, C);
    let i = sim
        .tower
        .units
        .iter()
        .position(|u| u.id == r.unit_id.unwrap())
        .unwrap();
    sim.tower.units[i].state = UnitState::Occupied;
    sim.vacate(i, "rent");
    assert_eq!(
        last_line(&sim),
        "A tenant left Office on floor 2 (rent set too high)."
    );
}

#[test]
fn the_congestion_note_names_the_binding_transport() {
    // A stairs-only floor: the note names the stairs and the capacity lever.
    let mut sim = Simulation::new_game(26, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 1;
    for x in 0..LOT_WIDTH {
        sim.tower.place(Kind::Lobby, 1, x);
        sim.tower.place(Kind::Floor, 2, x);
    }
    assert!(sim.build_transport(Kind::Stairs, C, 1, 2).ok);
    assert_eq!(
        sim.binding_transport_class_at(2),
        CongestionBindingClass::Stairs
    );
    let i = seat_owner(&mut sim, 2, C, false);
    sim.vacate(i, "congestion");
    assert!(
        last_line(&sim).ends_with(" A new owner will buy in, but the crowded stairs will wear them down too until you add capacity."),
        "{}",
        last_line(&sim)
    );

    // A mixed floor whose stair chain continues to a populated stairs-only
    // floor 3: the 2-3 link binds floor 2's reading past the healthy
    // elevator (#701), so the note names the stairs.
    let mut sim = Simulation::new_game(27, GameMode::Modern);
    sim.money = 1e12;
    sim.star = 1;
    for x in 0..LOT_WIDTH {
        sim.tower.place(Kind::Lobby, 1, x);
        sim.tower.place(Kind::Floor, 2, x);
        sim.tower.place(Kind::Floor, 3, x);
    }
    assert!(sim.build_transport(Kind::ElevatorStandard, C + 20, 1, 2).ok);
    assert!(sim.build_transport(Kind::Stairs, C, 1, 2).ok);
    assert!(sim.build_transport(Kind::Stairs, C, 2, 3).ok);
    for x in [C - 30, C - 21, C - 12] {
        let r = sim.tower.place(Kind::Office, 3, x);
        assert!(r.ok, "{:?}", r.reason);
        sim.tower.get_unit_mut(r.unit_id.unwrap()).unwrap().state = UnitState::Occupied;
    }
    let i = seat_owner(&mut sim, 2, C + 40, false);
    assert_eq!(
        sim.binding_transport_class_at(2),
        CongestionBindingClass::Stairs
    );
    sim.vacate(i, "congestion");
    assert!(
        last_line(&sim).contains("crowded stairs"),
        "{}",
        last_line(&sim)
    );
    assert!(last_line(&sim).ends_with("until you add capacity."));

    // An unpopulated floor has no attribution entry and falls back to the
    // serving kinds; a floor no passenger transport stops at reads none.
    let sim = served_tower(28);
    assert_eq!(
        sim.binding_transport_class_at(2),
        CongestionBindingClass::Elevator
    );
    assert_eq!(
        sim.binding_transport_class_at(9),
        CongestionBindingClass::None
    );
}

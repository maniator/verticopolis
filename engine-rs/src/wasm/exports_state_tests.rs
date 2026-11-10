use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

/// A lobby, one floor and an office on it.
fn with_office() -> (Engine, i64) {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    for x in 150..200 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
    }
    let r = e.sim.tower.place(Kind::Office, 2, 160);
    assert!(r.ok);
    (e, r.unit_id.unwrap())
}

#[test]
fn set_clock_moves_the_minutes_and_keeps_the_calendar() {
    let (mut e, _) = with_office();
    let calendar = format!("{:?}", e.sim.clock.calendar);
    assert!(e.set_clock((24.0 + 18.0) * 60.0));
    assert_eq!(e.sim.clock.minutes, 42.0 * 60.0);
    assert_eq!(format!("{:?}", e.sim.clock.calendar), calendar);
    // A literal 0 is the founding 07:00, as the clock's own constructor reads it.
    assert!(e.set_clock(0.0));
    assert_eq!(e.sim.clock.minutes, 7.0 * 60.0);
    for bad in [f64::NAN, f64::INFINITY, -1.0, MAX_TOOL_CLOCK_MINUTES + 1.0] {
        assert!(!e.set_clock(bad), "{bad}");
        assert_eq!(e.sim.clock.minutes, 7.0 * 60.0, "{bad} changed the clock");
    }
}

#[test]
fn set_unit_state_writes_through_the_marked_setters() {
    let (mut e, id) = with_office();
    let before = e.sim.tower.view.marks.position();
    assert!(e.set_unit_state(id as f64, "occupied", Some(6.0)));
    let unit = e.sim.tower.get_unit(id).unwrap();
    assert_eq!((unit.state, unit.occupants), (UnitState::Occupied, 6));
    // The frame's mark log saw the change, so the views that key on it move.
    assert!(e.sim.tower.view.marks.position() > before);
    // Without occupants only the state changes.
    assert!(e.set_unit_state(id as f64, "moving_in", None));
    let unit = e.sim.tower.get_unit(id).unwrap();
    assert_eq!((unit.state, unit.occupants), (UnitState::MovingIn, 6));
}

#[test]
fn set_unit_state_refuses_what_it_cannot_write() {
    let (mut e, id) = with_office();
    let state = e.sim.tower.get_unit(id).unwrap().state;
    let marks = e.sim.tower.view.marks.position();
    for (unit, name, occupants) in [
        (id as f64, "open", None),
        (id as f64, "construction", None),
        (id as f64, "fire", None),
        (9999.0, "occupied", None),
        (-1.0, "occupied", None),
        (f64::NAN, "occupied", None),
        (f64::INFINITY, "occupied", None),
        (id as f64 + 0.5, "occupied", None),
        (id as f64, "occupied", Some(-1.0)),
        (id as f64, "occupied", Some(2.5)),
        (id as f64, "occupied", Some(f64::NAN)),
        (id as f64, "occupied", Some(f64::INFINITY)),
        (id as f64, "occupied", Some(1e300)),
    ] {
        assert!(
            !e.set_unit_state(unit, name, occupants),
            "{unit} {name} {occupants:?}"
        );
    }
    let unit = e.sim.tower.get_unit(id).unwrap();
    assert_eq!((unit.state, unit.occupants), (state, 0));
    // A refusal writes nothing, so it marks nothing either.
    assert_eq!(e.sim.tower.view.marks.position(), marks);
    // The largest count a JavaScript number holds exactly is still taken.
    assert!(e.set_unit_state(id as f64, "occupied", Some(MAX_TOOL_OCCUPANTS)));
}

#[test]
fn every_state_name_reads_back_as_its_state() {
    for state in [
        UnitState::Construction,
        UnitState::Empty,
        UnitState::Occupied,
        UnitState::MovingIn,
        UnitState::Vacating,
        UnitState::Asleep,
        UnitState::Dirty,
        UnitState::Infested,
        UnitState::Fire,
        UnitState::Gutted,
    ] {
        assert_eq!(UnitState::from_name(state.as_str()), Some(state));
    }
    assert_eq!(UnitState::from_name("Occupied"), None);
}

#[test]
fn set_customers_in_writes_the_tally_and_refuses_what_it_cannot() {
    let (mut e, id) = with_office();
    let marks = e.sim.tower.view.marks.position();
    for (unit, count) in [
        (9999.0, 1.0),
        (id as f64 + 0.5, 1.0),
        (id as f64, -1.0),
        (id as f64, 2.5),
        (id as f64, f64::NAN),
        (id as f64, f64::INFINITY),
        (id as f64, 1e300),
        (id as f64, MAX_TOOL_OCCUPANTS + 1.0),
        (-1.0, 1.0),
        (f64::NAN, 1.0),
        (f64::INFINITY, 1.0),
    ] {
        assert!(!e.set_customers_in(unit, count), "{unit} {count}");
    }
    assert_eq!(e.sim.tower.get_unit(id).unwrap().customers_in, None);
    assert_eq!(e.sim.tower.view.marks.position(), marks);
    let occupants = e.sim.tower.get_unit(id).unwrap().occupants;
    assert!(e.set_customers_in(id as f64, 4.0));
    assert_eq!(e.sim.tower.get_unit(id).unwrap().customers_in, Some(4));
    // An office keeps no attendance, so its occupants are not the tally.
    assert_eq!(e.sim.tower.get_unit(id).unwrap().occupants, occupants);
    assert!(e.sim.tower.view.marks.position() > marks);
    // Both ends of the range are taken.
    assert!(e.set_customers_in(id as f64, 0.0));
    assert_eq!(e.sim.tower.get_unit(id).unwrap().customers_in, Some(0));
    assert!(e.set_customers_in(id as f64, MAX_TOOL_OCCUPANTS));
    assert_eq!(
        e.sim.tower.get_unit(id).unwrap().customers_in,
        Some(MAX_TOOL_OCCUPANTS as i64)
    );
}

#[test]
fn set_customers_in_makes_the_follow_ups_a_counted_arrival_makes() {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    for x in 150..200 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 3, x).ok);
    }
    let r = e.sim.tower.place(Kind::PartyHall, 2, 150);
    assert!(r.ok);
    let hall = r.unit_id.unwrap();
    assert!(Kind::PartyHall.attendance_cap().is_some());
    assert!(e.set_unit_state(hall as f64, "occupied", None));
    let revision = e.sim.tower.meal_overlay_revision;
    // A refusal moves neither the mirror nor the revision.
    assert!(!e.set_customers_in(hall as f64, 2.5));
    assert_eq!(e.sim.tower.get_unit(hall).unwrap().occupants, 0);
    assert_eq!(e.sim.tower.meal_overlay_revision, revision);
    // A stamp mirrors the tally into the attendance venue's occupants and
    // moves the meal overlay revision by one, as an arrival does.
    assert!(e.set_customers_in(hall as f64, 5.0));
    let unit = e.sim.tower.get_unit(hall).unwrap();
    assert_eq!((unit.customers_in, unit.occupants), (Some(5), 5));
    assert_eq!(e.sim.tower.meal_overlay_revision, revision + 1);
}

#[test]
fn set_weather_takes_the_three_save_names_and_refuses_the_rest() {
    use crate::sim_loop::Weather;
    let (mut e, _) = with_office();
    for (name, want) in [
        ("rain", Weather::Rain),
        ("cloudy", Weather::Cloudy),
        ("clear", Weather::Clear),
    ] {
        assert!(e.set_weather(name), "{name}");
        assert_eq!(e.sim.weather, want, "{name}");
    }
    assert!(e.set_weather("rain"));
    for bad in ["", "Rain", "snow"] {
        assert!(!e.set_weather(bad), "{bad:?}");
        assert_eq!(e.sim.weather, Weather::Rain, "{bad:?} changed the weather");
    }
}

#[test]
fn clear_retail_tallies_unsets_all_four_and_nothing_else() {
    let (mut e, office) = with_office();
    let r = e.sim.tower.place(Kind::Shop, 2, 180);
    assert!(r.ok);
    let shop = r.unit_id.unwrap();
    {
        let i = e.sim.tower.by_id[&shop];
        let mut t = e.sim.tower.units[i].extras_mut();
        t.patronage_today = Some(3.0);
        t.patronage_yest = Some(4.0);
        t.profit_today = Some(50.0);
        t.profit_yest = Some(60.0);
        t.dirty_days = Some(1);
    }
    let money = e.sim.money;
    e.clear_retail_tallies();
    let t = e.sim.tower.get_unit(shop).unwrap().extras().clone();
    assert_eq!(
        (
            t.patronage_today,
            t.patronage_yest,
            t.profit_today,
            t.profit_yest
        ),
        (None, None, None, None)
    );
    assert_eq!(t.dirty_days, Some(1), "the other extras stay");
    assert_eq!(e.sim.money, money);
    // A unit with no tally ends with no extras record.
    assert!(e.sim.tower.get_unit(office).unwrap().extras.is_none());
}

#[test]
fn start_fire_at_ignites_the_chosen_room_and_offers_the_rescue() {
    let (mut e, id) = with_office();
    let mut stream = e.sim.rng.clone();
    let started = e.sim.events.fires_started;
    assert!(e.start_fire_at(id as f64));
    let office = e.sim.tower.units.iter().find(|u| u.id == id).unwrap();
    assert_eq!(office.state, UnitState::Fire);
    assert_eq!(office.occupants, 0);
    assert!(e.sim.events.active.contains(&id));
    assert_eq!(e.sim.events.fires_started, started + 1);
    let pending = e
        .sim
        .events
        .pending
        .as_ref()
        .expect("the rescue is offered");
    assert_eq!(pending.kind, "fireRescue");
    // The outbreak drew nothing from the random stream.
    assert_eq!(e.sim.rng.next(), stream.next());
}

#[test]
fn start_fire_at_refuses_without_changing_anything() {
    let (mut e, id) = with_office();
    let lobby = e
        .sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Lobby)
        .unwrap()
        .id;
    for bad in [id as f64 + 0.5, -1.0, 9e15, lobby as f64] {
        assert!(!e.start_fire_at(bad), "{bad}");
        assert_eq!(e.sim.events.fires_started, 0, "{bad} started a fire");
        assert!(e.sim.events.pending.is_none(), "{bad} raised a choice");
    }
    // A second outbreak waits until the first is out, as the daily roll does.
    assert!(e.start_fire_at(id as f64));
    let pending = e.sim.events.pending.clone();
    assert!(!e.start_fire_at(id as f64));
    assert_eq!(e.sim.events.fires_started, 1);
    assert_eq!(
        format!("{:?}", e.sim.events.pending),
        format!("{pending:?}")
    );
    // Each guard refuses on its own. A declined offer leaves the fire
    // burning, and a pending choice blocks an outbreak with no fire burning.
    let other = e.sim.tower.place(Kind::Office, 2, 180).unit_id.unwrap();
    e.resolve_choice(false);
    assert!(e.sim.events.pending.is_none());
    assert!(!e.start_fire_at(other as f64), "a fire still burns");
    e.sim.events.active.clear();
    e.sim.events.pending = pending;
    assert!(!e.start_fire_at(other as f64), "a choice is pending");
    assert_eq!(e.sim.events.fires_started, 1);
    // With neither guard holding, the same room ignites, so the two
    // refusals above came from the guards.
    e.sim.events.pending = None;
    assert!(e.start_fire_at(other as f64));
    assert_eq!(e.sim.events.fires_started, 2);
}

#[test]
fn vacate_unit_empties_the_room_and_buys_back_a_sold_condo() {
    let (mut e, office) = with_office();
    assert!(e.set_unit_state(office as f64, "occupied", Some(6.0)));
    assert!(e.vacate_unit(office as f64, "access"));
    let unit = e.sim.tower.get_unit(office).unwrap();
    assert_eq!((unit.state, unit.occupants), (UnitState::Empty, 0));
    // A sold condo leaves through the buy-back, at its recorded price.
    let r = e.sim.tower.place(Kind::Condo, 2, 180);
    let condo = r.unit_id.unwrap();
    assert!(e.set_unit_state(condo as f64, "occupied", None));
    e.sim.tower.get_unit_mut(condo).unwrap().ever_occupied = true;
    assert!(e.set_unit_rent(condo as f64, Some(150_000.0)));
    let money = e.sim.money;
    assert!(e.vacate_unit(condo as f64, "relocation"));
    let unit = e.sim.tower.get_unit(condo).unwrap();
    assert_eq!((unit.state, unit.ever_occupied), (UnitState::Empty, false));
    assert!(e.sim.money < money, "the buy-back was charged");
}

#[test]
fn vacate_unit_refuses_an_unknown_unit_or_cause() {
    let (mut e, office) = with_office();
    assert!(e.set_unit_state(office as f64, "occupied", Some(6.0)));
    for (unit, reason) in [
        (office as f64, "boredom"),
        (office as f64, ""),
        (9999.0, "access"),
        (0.5, "access"),
    ] {
        assert!(!e.vacate_unit(unit, reason), "{unit} {reason}");
        assert_eq!(
            e.sim.tower.get_unit(office).unwrap().state,
            UnitState::Occupied,
            "{unit} {reason}"
        );
    }
}

#[test]
fn set_unit_rent_writes_the_price_as_given_and_refuses_a_bad_one() {
    let (mut e, office) = with_office();
    // An off-ladder price stays as written, and null clears it.
    assert!(e.set_unit_rent(office as f64, Some(12_345.0)));
    assert_eq!(e.sim.tower.get_unit(office).unwrap().rent, Some(12_345.0));
    assert!(e.set_unit_rent(office as f64, None));
    assert_eq!(e.sim.tower.get_unit(office).unwrap().rent, None);
    assert!(e.set_unit_rent(office as f64, Some(9_000.0)));
    for (unit, rent) in [
        (office as f64, Some(-1.0)),
        (office as f64, Some(f64::NAN)),
        (office as f64, Some(f64::INFINITY)),
        (9999.0, Some(1.0)),
    ] {
        assert!(!e.set_unit_rent(unit, rent), "{unit} {rent:?}");
        assert_eq!(
            e.sim.tower.get_unit(office).unwrap().rent,
            Some(9_000.0),
            "{unit} {rent:?}"
        );
    }
}

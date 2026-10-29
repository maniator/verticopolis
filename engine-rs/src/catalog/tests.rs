use super::*;
use crate::charges::ExtendEnd;
use crate::sim::Simulation;

/// `conformance/catalog-digests.json`, which the TypeScript engine writes
/// from its own tables (`catalog.integration.test.ts`).
const LOCK: &str = include_str!("../../../conformance/catalog-digests.json");

const MODES: [GameMode; 2] = [GameMode::Classic, GameMode::Modern];

#[test]
fn each_mode_matches_the_lock() {
    let lock: Value = serde_json::from_str(LOCK).expect("catalog-digests.json parses");
    for mode in MODES {
        let want = lock["catalogs"][mode.as_str()]
            .as_str()
            .unwrap_or_else(|| panic!("the lock has no {} digest", mode.as_str()));
        assert_eq!(
            catalog_digest(mode),
            want,
            "the {} catalog moved off the lock; print it with catalog_json",
            mode.as_str()
        );
    }
}

#[test]
fn one_entry_per_kind_in_catalog_order() {
    for mode in MODES {
        let c = catalog(mode);
        assert_eq!(c.facilities.len(), FACILITIES.len());
        for (entry, f) in c.facilities.iter().zip(FACILITIES.iter()) {
            assert_eq!(entry.key, f.key);
            assert_eq!(Kind::parse(entry.key), Some(f.kind));
        }
    }
}

fn entry<'a>(c: &'a Catalog, key: &str) -> &'a FacilityEntry {
    c.facilities
        .iter()
        .find(|e| e.key == key)
        .unwrap_or_else(|| panic!("no {key} in the catalog"))
}

fn json_entry<'a>(v: &'a Value, key: &str) -> &'a Value {
    v["facilities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["key"] == key)
        .unwrap_or_else(|| panic!("no {key} in the catalog JSON"))
}

/// The canon pooling of CLAUDE.md, read back through the catalog.
#[test]
fn pools_caps_and_spans_follow_canon() {
    let c = catalog(GameMode::Modern);
    assert_eq!(c.pools.len(), 2);
    assert_eq!(
        (c.pools[0].key, c.pools[0].cap, c.pools[0].kinds.clone()),
        (
            "elevators",
            24,
            vec!["elevatorStandard", "elevatorService", "elevatorExpress"]
        )
    );
    assert_eq!(
        (c.pools[1].key, c.pools[1].cap, c.pools[1].kinds.clone()),
        ("walkways", 64, vec!["stairs", "escalator"])
    );
    for key in ["elevatorStandard", "elevatorService", "elevatorExpress"] {
        let e = entry(&c, key);
        assert_eq!(e.pool, Some("elevators"));
        assert_eq!(e.max_cars, Some(8), "{key}");
        assert!(!e.fixed_span);
    }
    assert_eq!(entry(&c, "elevatorStandard").max_span, Some(30));
    assert_eq!(entry(&c, "elevatorService").max_span, Some(30));
    assert_eq!(
        entry(&c, "elevatorExpress").max_span,
        Some(MAX_FLOOR - MIN_FLOOR)
    );
    for key in ["stairs", "escalator"] {
        let e = entry(&c, key);
        assert_eq!(e.pool, Some("walkways"));
        assert_eq!(
            (e.max_span, e.max_cars, e.fixed_span),
            (Some(1), None, true)
        );
    }
    // Transports work as soon as they are placed.
    for e in c.facilities.iter().filter(|e| e.transport) {
        assert_eq!(e.build_minutes, 0.0, "{}", e.key);
    }
    assert_eq!(entry(&c, "metro").build_cap, Some(1));
    let office = entry(&c, "office");
    assert_eq!(
        (
            office.build_cap,
            office.pool,
            office.max_span,
            office.car_capacity
        ),
        (None, None, None, None)
    );
    assert!(office.build_minutes > 0.0);
}

#[test]
fn values_resolve_for_the_mode() {
    let classic = catalog(GameMode::Classic);
    let modern = catalog(GameMode::Modern);
    assert!(!entry(&classic, "foodHall").available);
    assert!(entry(&modern, "foodHall").available);
    assert!(entry(&classic, "office").available);
    // Classic prices the canon kinds on the ladder, starting at Average.
    match entry(&classic, "condo").rent.as_ref().unwrap() {
        Rent::Ladder {
            default,
            rungs,
            no_rate,
            ..
        } => {
            assert_eq!(*default, 150_000.0);
            assert_eq!(rungs.len(), 4);
            assert_eq!(rungs[2].label, "Average");
            assert!(*no_rate);
        }
        other => panic!("Classic condo should be on a ladder, got {other:?}"),
    }
    // A Modern-only priced kind has no Classic ladder.
    assert_eq!(entry(&classic, "rentalStudio").rent, None);
    match entry(&modern, "condo").rent.as_ref().unwrap() {
        Rent::Band {
            default, no_rate, ..
        } => {
            assert_eq!(*default, 160_000.0);
            assert!(!*no_rate);
        }
        other => panic!("Modern condo should be on a band, got {other:?}"),
    }
    assert_eq!(entry(&classic, "shop").daily_income, Some(20_000.0));
    assert_eq!(entry(&modern, "shop").daily_income, Some(2_500.0));
    assert_eq!(classic.economy.exterminator, None);
    assert!(modern.economy.exterminator.is_some());
    assert!(!classic.economy.auto_bridge_toggleable);
    assert!(modern.economy.auto_bridge_toggleable);
    assert_eq!(classic.economy.overhead_per_unit_monthly, 0.0);
    assert_eq!(modern.economy.overhead_per_unit_monthly, 700.0);
    // Classic always runs the canon calendar: upkeep lands every three
    // days at a tenth of the monthly figure, quarterly rent in full.
    let canon = &classic.economy.calendars;
    assert_eq!(canon.len(), 1);
    assert_eq!(
        (
            canon[0].key,
            canon[0].maintenance_period_days,
            canon[0].maintenance_scale,
            canon[0].quarterly_rent_scale
        ),
        ("canon", 3, 0.1, 1.0)
    );
    let keys: Vec<_> = modern.economy.calendars.iter().map(|c| c.key).collect();
    assert_eq!(keys, ["realWorld", "canon"]);
    assert_eq!(modern.economy.calendars[0].maintenance_scale, 1.0);
    assert_eq!(modern.economy.calendars[1].quarterly_rent_scale, 3.0 / 90.0);
    assert_eq!(classic.world.ground_floor_structure, "lobby");
    let cadence = |c: &Catalog, key: &str| match entry(c, key).rent.as_ref().unwrap() {
        Rent::Ladder { cadence, .. } | Rent::Band { cadence, .. } => *cadence,
    };
    assert_eq!(cadence(&classic, "office"), "quarterly");
    assert_eq!(cadence(&classic, "condo"), "sale");
    assert_eq!(cadence(&classic, "hotelSuite"), "nightly");
    assert_eq!(cadence(&modern, "rentalStudio"), "maintenancePeriod");
    assert_eq!(cadence(&modern, "clinic"), "quarterly");
    // Only the venues that track customers quote a ticket.
    assert_eq!(entry(&modern, "shop").spend_per_customer, Some(20.0));
    assert_eq!(entry(&modern, "nightclub").spend_per_customer, None);
    // Classic never counts Food Hall customers: it pays the hall nothing.
    assert_eq!(entry(&classic, "foodHall").spend_per_customer, None);
    assert_eq!(entry(&modern, "foodHall").spend_per_customer, Some(25.0));
}

/// The prices the catalog quotes are the ones the build and sell paths
/// charge, in both modes, so a frontend's label cannot drift from the
/// treasury.
#[test]
fn quoted_prices_are_what_the_engine_charges() {
    for mode in MODES {
        let c = catalog(mode);
        let mut sim = Simulation::new_game(1, mode);
        assert_eq!(sim.money, c.economy.starting_money);
        sim.money = 1e9;
        let lobby = entry(&c, "lobby");
        let before = sim.money;
        assert!(sim.build(Kind::Lobby, 1, 170).ok);
        assert_eq!(before - sim.money, lobby.cost);
        // The floor tool on the ground floor lays a lobby, at its price.
        let before = sim.money;
        assert!(sim.build(Kind::Floor, 1, 171).ok);
        assert_eq!(before - sim.money, lobby.cost);
        for x in 172..200 {
            assert!(sim.build(Kind::Lobby, 1, x).ok);
        }
        for floor in 2..=4 {
            for x in 170..200 {
                assert!(sim.build(Kind::Floor, floor, x).ok);
            }
        }
        let elevator = entry(&c, "elevatorStandard");
        let before = sim.money;
        assert!(sim.build_transport(Kind::ElevatorStandard, 172, 1, 4).ok);
        assert_eq!(
            before - sim.money,
            elevator.cost + 3.0 * c.economy.transport_floor_cost
        );
        let stairs = entry(&c, "stairs");
        let before = sim.money;
        assert!(sim.build_transport(Kind::Stairs, 190, 1, 2).ok);
        assert_eq!(before - sim.money, stairs.cost);
        let office = entry(&c, "office");
        let before = sim.money;
        assert!(sim.build(Kind::Office, 2, 180).ok);
        assert_eq!(before - sim.money, office.cost);
        // A room on bare floor lays the floor under it at the floor's
        // price: nine tiles for an office on floor 5 over floor 4.
        let floor = entry(&c, "floor");
        let before = sim.money;
        assert!(sim.build(Kind::Office, 5, 180).ok);
        assert_eq!(
            before - sim.money,
            office.cost + office.width as f64 * floor.cost
        );
        let before = sim.money;
        assert!(sim.sell_at(2, 180));
        assert_eq!(sim.money - before, office.resale_refund);
        // The car and extend commands charge the quoted car price, car
        // refund and per-floor cost. They run after the rooms so the
        // longer shaft changes no bridging quote above.
        let shaft = sim
            .tower
            .transports
            .iter()
            .find(|t| t.kind == Kind::ElevatorStandard)
            .map(|t| t.id)
            .unwrap();
        let before = sim.money;
        assert!(sim.add_car(shaft).ok);
        assert_eq!(before - sim.money, c.economy.add_car_cost);
        let before = sim.money;
        assert!(sim.remove_car(shaft).ok);
        assert_eq!(sim.money - before, c.economy.car_resale_refund);
        let before = sim.money;
        assert!(sim.extend_transport(shaft, ExtendEnd::Up, 5).charge.ok);
        assert_eq!(before - sim.money, c.economy.transport_floor_cost);
    }
}

#[test]
fn json_takes_the_typescript_keys_and_number_forms() {
    let v = catalog_value(GameMode::Classic);
    let office = json_entry(&v, "office");
    assert!(office.get("minStar").is_some());
    assert!(office.get("buildMinutes").is_some());
    assert!(office["attendance"].is_null());
    assert_eq!(office["rent"]["shape"], "ladder");
    assert_eq!(office["rent"]["noRate"], true);
    assert_eq!(v["world"]["lotWidth"], 375);
    assert!(v["economy"].get("addCarCost").is_some());
    let modern = catalog_value(GameMode::Modern);
    assert_eq!(json_entry(&modern, "office")["rent"]["shape"], "band");
    // Whole dollars print as JavaScript prints them, with no fraction.
    let text = catalog_json(GameMode::Classic);
    assert!(text.contains(r#""addCarCost":40000,"#), "{text}");
    assert!(text.contains(r#""maintenanceScale":0.1,"#), "{text}");
    assert_eq!(
        catalog_json(GameMode::Modern),
        canonical_json(&serde_json::from_str(&catalog_json(GameMode::Modern)).unwrap())
    );
}

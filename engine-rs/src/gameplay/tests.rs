use super::*;
use crate::facilities::FACILITIES;
use crate::sim::Simulation;

fn catalog() -> Value {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../conformance/events/catalog.json"
    ))
    .expect("catalog");
    serde_json::from_str(&text).expect("catalog parses")
}

/// One event of every variant, so a variant added without a catalog
/// entry (or the reverse) fails below.
fn one_of_each() -> Vec<GameplayEvent> {
    vec![
        GameplayEvent::TowerFounded {
            mode: GameMode::Modern,
        },
        GameplayEvent::FacilityPlaced {
            kind: Kind::Office,
            floor: 2,
            count: 1,
        },
        GameplayEvent::FacilityRemoved {
            kind: Kind::Condo,
            method: RemovalMethod::Bulldoze,
        },
        GameplayEvent::PricingChanged { kind: Kind::Office },
        GameplayEvent::CapacityChanged {
            kind: Kind::ElevatorStandard,
        },
        GameplayEvent::StarReached { star: 6 },
        GameplayEvent::FireStarted,
        GameplayEvent::FireGutted { rooms: 3 },
        GameplayEvent::BombDetonated { rooms: 0 },
        GameplayEvent::EmergencyResolved {
            kind: EmergencyKind::BombThreat,
            decision: EmergencyDecision::Decline,
            source: EmergencySource::Timeout,
        },
        GameplayEvent::MilestoneReached { id: "full-house" },
    ]
}

#[test]
fn the_catalog_passes_its_own_rules() {
    check_catalog(&catalog()).expect("catalog is valid");
}

#[test]
fn gameplay_event_matches_the_catalog() {
    let cat = catalog();
    let events = one_of_each();
    let ours: Vec<&str> = events.iter().map(GameplayEvent::name).collect();
    let theirs: Vec<&str> = cat["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    assert_eq!(ours, theirs, "variants and catalog entries, in order");
    let ordinals: Vec<usize> = events.iter().map(GameplayEvent::ordinal).collect();
    assert_eq!(ordinals, (0..theirs.len()).collect::<Vec<_>>());
    assert_eq!(GameplayEvent::VARIANTS, theirs.len());
    assert!(events.iter().all(|e| e.ordinal() < GameplayEvent::VARIANTS));
    for e in &events {
        check_event(&cat, &e.to_json()).unwrap_or_else(|err| panic!("{err}"));
    }
    // The closed sets the engine draws from are the catalog's sets.
    let enum_of = |name: &str| -> Vec<String> {
        cat["enums"][name]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string())
            .collect()
    };
    let kinds: Vec<String> = FACILITIES.iter().map(|f| f.key.to_string()).collect();
    assert_eq!(enum_of("facilityKind"), kinds);
    let sim = Simulation::new_game(1, GameMode::Classic);
    let milestones: Vec<String> = sim
        .milestone_tests()
        .iter()
        .map(|(id, _, _)| id.to_string())
        .collect();
    assert_eq!(enum_of("milestoneId"), milestones);
    assert_eq!(enum_of("mode"), ["classic", "modern"]);
    assert_eq!(
        enum_of("removalMethod"),
        [
            RemovalMethod::Sell.as_str(),
            RemovalMethod::Bulldoze.as_str()
        ]
    );
    assert_eq!(
        enum_of("emergencyDecision"),
        [
            EmergencyDecision::Accept.as_str(),
            EmergencyDecision::Decline.as_str()
        ]
    );
    assert_eq!(
        enum_of("emergencySource"),
        [
            EmergencySource::Player.as_str(),
            EmergencySource::Timeout.as_str()
        ]
    );
    assert_eq!(
        enum_of("emergencyKind"),
        [
            EmergencyKind::FireRescue.as_str(),
            EmergencyKind::BombThreat.as_str()
        ]
    );
    assert_eq!(
        EmergencyKind::parse("bombThreat"),
        Some(EmergencyKind::BombThreat)
    );
    assert_eq!(EmergencyKind::parse("ransom"), None);
    // The floor bounds are the grid's. (That the TypeScript ring holds as
    // many events as this one is checked from the TypeScript side, in
    // src/engine/gameplayEmission.test.ts, so this crate's tests read
    // nothing outside engine-rs/ and conformance/.)
    let floor = &cat["events"][1]["payload"]["floor"];
    assert_eq!(
        (floor["min"].as_i64(), floor["max"].as_i64()),
        (
            Some(crate::facilities::MIN_FLOOR),
            Some(crate::facilities::MAX_FLOOR)
        )
    );
    assert_eq!(serde_json::from_str::<Value>(CATALOG_JSON).unwrap(), cat);
    // A value outside a set, a stray field and an unknown name all fail.
    let mut bad = GameplayEvent::StarReached { star: 1 }.to_json();
    assert!(check_event(&cat, &bad).unwrap_err().contains("star"));
    bad = json!({ "name": "star_reached", "payload": { "star": 3, "towerName": "x" } });
    assert!(check_event(&cat, &bad).unwrap_err().contains("towerName"));
    bad = json!({ "name": "tower_renamed", "payload": {} });
    assert!(check_event(&cat, &bad)
        .unwrap_err()
        .contains("not in the catalog"));
}

#[test]
fn the_catalog_refuses_a_string_field_that_is_not_a_catalog_enum() {
    let mut cat = catalog();
    cat["events"][0]["payload"]["towerName"] = json!({ "type": "string" });
    assert!(check_catalog(&cat)
        .unwrap_err()
        .contains("closed enums and small integers only"));
    let mut cat = catalog();
    cat["events"][0]["payload"]["mode"] = json!({ "type": "enum", "enum": "freeText" });
    assert!(check_catalog(&cat)
        .unwrap_err()
        .contains("not in the catalog"));
    let mut cat = catalog();
    cat["events"][0]["payload"]["money"] = json!({ "type": "number" });
    assert!(check_catalog(&cat).unwrap_err().contains("not allowed"));
    let mut cat = catalog();
    cat["events"][0]["payload"]["cash"] =
        json!({ "type": "integer", "min": 0, "max": 2_000_000_000i64 });
    assert!(check_catalog(&cat).unwrap_err().contains("within 100000"));
    // Names and prose the generated TypeScript declaration could not carry.
    let mut cat = catalog();
    cat["events"][0]["name"] = json!("1st_tower");
    assert!(check_catalog(&cat).unwrap_err().contains("snake_case"));
    let mut cat = catalog();
    cat["enums"][""] = json!(["x"]);
    assert!(check_catalog(&cat).unwrap_err().contains("camelCase"));
    let mut cat = catalog();
    cat["events"][0]["payload"]["tower-name"] = json!({ "type": "enum", "enum": "mode" });
    assert!(check_catalog(&cat).unwrap_err().contains("camelCase"));
    let mut cat = catalog();
    cat["events"][0]["semantics"] = json!("ends the doc */ early");
    assert!(check_catalog(&cat).unwrap_err().contains("without */"));
    let mut cat = catalog();
    cat.as_object_mut().unwrap().remove("catalogVersion");
    assert!(check_catalog(&cat).unwrap_err().contains("catalogVersion"));
    let mut cat = catalog();
    cat["enums"]["event"] = json!(["x"]);
    assert!(check_catalog(&cat).unwrap_err().contains("reserved"));
    assert!(check_catalog(&json!([]))
        .unwrap_err()
        .contains("must be an object"));
    let mut cat = catalog();
    cat["catalogVersion"] = json!(1e20);
    assert!(check_catalog(&cat).unwrap_err().contains("catalogVersion"));
    let mut cat = catalog();
    cat["events"][1]["payload"]["floor"]["min"] = json!(i64::MIN);
    assert!(check_catalog(&cat).unwrap_err().contains("within 100000"));
    // A whole number written with a fraction reads as JavaScript reads it.
    let mut cat = catalog();
    cat["events"][1]["payload"]["count"]["max"] = json!(1000.0);
    check_catalog(&cat).expect("1000.0 is a whole number");
    assert!(check_event(
        &cat,
        &json!({ "name": "star_reached", "payload": { "star": 3.0 } })
    )
    .is_ok());
}

#[test]
fn a_full_ring_drops_the_oldest_and_counts_it() {
    let mut buf = GameplayEvents::default();
    for star in 0..(GAMEPLAY_RING_CAP as i64 + 5) {
        buf.push(GameplayEvent::StarReached { star });
    }
    assert_eq!(buf.len(), GAMEPLAY_RING_CAP);
    assert_eq!(buf.dropped, 5);
    let drained = buf.drain();
    assert_eq!(drained[0], GameplayEvent::StarReached { star: 5 });
    assert!(buf.is_empty());
    assert_eq!(buf.dropped, 5, "draining keeps the running count");
}

#[test]
fn the_buffer_never_reaches_the_save_or_the_hashed_views() {
    use crate::canonical::canonical_json;
    use crate::snapshot::state_view;
    let mut sim = Simulation::new_game(9, GameMode::Modern);
    sim.gameplay.drain();
    let save = sim.serialize().to_string();
    let state = canonical_json(&state_view(&sim));
    let crowd = canonical_json(&sim.crowd.view());
    for i in 0..(GAMEPLAY_RING_CAP + 3) {
        sim.gameplay.push(GameplayEvent::FacilityPlaced {
            kind: Kind::Office,
            floor: (i % 50) as i64,
            count: 1,
        });
    }
    assert_eq!(sim.gameplay.len(), GAMEPLAY_RING_CAP);
    assert!(sim.gameplay.dropped > 0);
    assert_eq!(sim.serialize().to_string(), save);
    assert_eq!(canonical_json(&state_view(&sim)), state);
    assert_eq!(canonical_json(&sim.crowd.view()), crowd);
    sim.gameplay.drain();
    assert_eq!(sim.serialize().to_string(), save);
    assert_eq!(canonical_json(&state_view(&sim)), state);
    assert_eq!(canonical_json(&sim.crowd.view()), crowd);
}

#[test]
fn a_new_game_founds_once_and_a_load_emits_nothing() {
    let mut sim = Simulation::new_game(3, GameMode::Classic);
    let founded = batch_json(&sim.gameplay.drain());
    assert_eq!(
        founded,
        json!([{ "name": "tower_founded", "payload": { "mode": "classic" } }])
    );
    let loaded = crate::load::deserialize(&sim.serialize()).expect("loads");
    assert!(loaded.gameplay.is_empty());
    // A real four-star save, with its milestones, stars, shafts and prices.
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../conformance/fixtures/towerone-star4.vctower"
    ))
    .expect("fixture");
    let raw = crate::load::decode_vctower(&text).expect("decodes");
    assert!(crate::load::deserialize(&raw)
        .expect("loads")
        .gameplay
        .is_empty());
}

/// A founded tower with a lobby row and a floor above, its founding
/// drained (the twin of `tower()` in `src/engine/gameplayEmission.test.ts`).
fn tower() -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1e9;
    for x in 170..210 {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for x in 170..210 {
        assert!(sim.build(Kind::Floor, 2, x).ok);
    }
    sim.gameplay.drain();
    sim
}

fn drained(sim: &mut Simulation) -> Value {
    let cat = catalog();
    let out = batch_json(&sim.gameplay.drain());
    for e in out.as_array().unwrap() {
        check_event(&cat, e).unwrap_or_else(|err| panic!("{err}"));
    }
    out
}

#[test]
fn placements_report_the_kind_placed_and_the_top_story() {
    let mut sim = Simulation::new_game(3, GameMode::Classic);
    sim.money = 1e9;
    sim.gameplay.drain();
    assert!(sim.build(Kind::Floor, 1, 180).ok);
    assert!(!sim.build(Kind::Office, 1, 180).ok);
    let first = drained(&mut sim);
    assert_eq!(
        first,
        json!([{ "name": "facility_placed", "payload": { "kind": "lobby", "floor": 1, "count": 1 } }])
    );
    let mut sim = tower();
    sim.star = 5; // the party hall unlocks late; the rating itself emits nothing here
    assert!(sim.build(Kind::PartyHall, 2, 180).ok);
    assert!(sim.build_transport(Kind::ElevatorStandard, 172, 1, 2).ok);
    assert_eq!(
        drained(&mut sim),
        json!([
            { "name": "facility_placed", "payload": { "kind": "partyHall", "floor": 3, "count": 1 } },
            { "name": "facility_placed", "payload": { "kind": "elevatorStandard", "floor": 2, "count": 1 } }
        ])
    );
}

#[test]
fn the_sell_command_reports_and_the_raw_tower_removal_does_not() {
    let mut sim = tower();
    assert!(sim.build(Kind::Office, 2, 180).ok);
    assert!(sim.build_transport(Kind::Stairs, 200, 1, 2).ok);
    sim.gameplay.drain();
    assert!(sim.sell_at(2, 180));
    assert!(sim.sell_at(2, 200));
    assert!(sim.sell_at(2, 209));
    assert_eq!(
        drained(&mut sim),
        json!([
            { "name": "facility_removed", "payload": { "kind": "office", "method": "sell" } },
            { "name": "facility_removed", "payload": { "kind": "stairs", "method": "sell" } },
            { "name": "facility_removed", "payload": { "kind": "floor", "method": "sell" } }
        ])
    );
    let id = sim.tower.unit_at(2, 190).unwrap().id;
    assert!(sim.tower.remove_unit(id).is_some());
    assert!(sim.gameplay.is_empty());
}

#[test]
fn price_and_capacity_edits_report_changes_and_not_no_ops() {
    let mut sim = tower();
    assert!(sim.build(Kind::Office, 2, 180).ok);
    assert!(sim.build(Kind::Office, 2, 190).ok);
    assert!(sim.build_transport(Kind::ElevatorStandard, 172, 1, 2).ok);
    sim.gameplay.drain();
    let office = sim.tower.unit_at(2, 180).unwrap().id;
    assert!(sim.adjust_rent(office, 1).is_some());
    let price = sim.price_unit(office, 9000.0).unwrap();
    assert!(sim.price_unit(office, price).is_some()); // the same price
    assert!(sim.set_no_rate(office));
    assert!(sim.set_no_rate(office)); // already off the market
    assert!(sim
        .apply_rent_batch(Kind::Office, crate::rent::BatchTarget::Default, false)
        .is_some_and(|r| r.changed > 0));
    assert!(sim
        .apply_rent_batch(Kind::Office, crate::rent::BatchTarget::Default, false)
        .is_some_and(|r| r.changed == 0));
    let shaft = sim.tower.transport_at(1, 172).unwrap().id;
    assert!(sim.set_cars(shaft, 3));
    assert!(!sim.set_cars(shaft, 3));
    assert!(sim.resize_transport(shaft, 1, 2).ok); // the same span
    assert!(sim.resize_transport(shaft, 1, 3).ok);
    let names: Vec<String> = drained(&mut sim)
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["name"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        names,
        [
            "pricing_changed",
            "pricing_changed",
            "pricing_changed",
            "pricing_changed",
            "capacity_changed",
            "capacity_changed"
        ]
    );
}

#[test]
fn stars_milestones_fires_bombs_and_resolutions_report_in_order() {
    let mut sim = tower();
    sim.star = 4;
    sim.note_stars(1);
    sim.check_milestones();
    sim.check_milestones();
    assert_eq!(
        drained(&mut sim),
        json!([
            { "name": "star_reached", "payload": { "star": 2 } },
            { "name": "star_reached", "payload": { "star": 3 } },
            { "name": "star_reached", "payload": { "star": 4 } },
            { "name": "milestone_reached", "payload": { "id": "star-4" } }
        ])
    );
    sim.star = 1;
    assert!(sim.build(Kind::Office, 2, 180).ok);
    assert!(sim.build(Kind::Office, 2, 190).ok);
    for u in sim.tower.units.iter_mut() {
        if u.state == crate::tower::UnitState::Construction {
            u.state = crate::tower::UnitState::Empty;
        }
    }
    sim.gameplay.drain();
    sim.start_fire();
    sim.events.pending = Some(crate::events::PendingChoice {
        kind: "fireRescue",
        cost: 1000.0,
        message: String::new(),
    });
    sim.resolve_choice(true);
    sim.money = 10.0;
    sim.events.pending = Some(crate::events::PendingChoice {
        kind: "fireRescue",
        cost: 1000.0,
        message: String::new(),
    });
    sim.resolve_choice(true);
    assert_eq!(
        drained(&mut sim),
        json!([
            { "name": "fire_started", "payload": {} },
            { "name": "emergency_resolved", "payload": { "kind": "fireRescue", "decision": "accept", "source": "player" } },
            { "name": "fire_gutted", "payload": { "rooms": 1 } },
            { "name": "emergency_resolved", "payload": { "kind": "fireRescue", "decision": "decline", "source": "player" } }
        ])
    );
    sim.money = 1e9;
    sim.events.pending = Some(crate::events::PendingChoice {
        kind: "bombThreat",
        cost: 300_000.0,
        message: String::new(),
    });
    sim.maybe_random_event();
    let events = drained(&mut sim);
    assert_eq!(
        events[0],
        json!({ "name": "emergency_resolved", "payload": { "kind": "bombThreat", "decision": "decline", "source": "timeout" } })
    );
    assert_eq!(events[1]["name"], "bomb_detonated");
    assert!(events[1]["payload"]["rooms"].as_i64().unwrap() > 0);
}

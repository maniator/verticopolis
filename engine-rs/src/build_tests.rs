//! Tests for `build.rs`: the transport quote against the build, and the
//! structural refusals.
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;

/// `canBuild` sends every kind that is not a room down the structural
/// branch, where a transport is refused by name, as the TypeScript does.
#[test]
fn can_build_refuses_a_transport_kind_by_name() {
    let sim = Simulation::new_game(1, GameMode::Classic);
    let c = sim.can_build(Kind::ElevatorStandard, 1, 180);
    assert!(!c.ok);
    assert_eq!(
        c.reason.as_deref(),
        Some("Use placeTransport for vertical transport.")
    );
    assert_eq!(c.cost, Kind::ElevatorStandard.facility().cost);
}

/// A tower with a lobby on floor 1 and floor tiles on floors 2 and 3 at
/// x 100..=111, rated `star`, holding `money`.
fn shaft_site(mode: GameMode, star: i64, money: f64) -> Simulation {
    let mut sim = Simulation::new_game(1, mode);
    sim.money = 1e9;
    for x in (100..=111).step_by(Kind::Lobby.facility().width as usize) {
        assert!(sim.build(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=3 {
        for x in 100..=111 {
            assert!(sim.build(Kind::Floor, floor, x).ok);
        }
    }
    sim.star = star;
    sim.money = money;
    sim
}

/// `can_build_transport` answers what `build_transport` then does. The
/// build refuses through the quote, so its refusals match by
/// construction; what this pins is that a quote that passes is a shaft
/// placed and a charge of exactly the quoted price, over every transport kind (and one room kind), spans
/// that fit, are too short or too tall, positions on and off the lot,
/// locked and unlocked, with money flush, exact and one dollar short.
#[test]
fn the_transport_quote_is_what_the_build_charges() {
    let kinds = [
        Kind::ElevatorStandard,
        Kind::ElevatorService,
        Kind::ElevatorExpress,
        Kind::Stairs,
        Kind::Escalator,
        Kind::Office,
    ];
    let spans = [(1, 2), (1, 3), (2, 3), (3, 3), (3, 2), (1, 40)];
    let mut placed = 0;
    let mut refused = std::collections::BTreeSet::new();
    // Classic at one star (every elevator but the standard one, and the
    // escalator, locked)
    // and Modern at five (all unlocked).
    for (mode, star) in [(GameMode::Classic, 1), (GameMode::Modern, 5)] {
        for kind in kinds {
            for (bottom, top) in spans {
                for x in [100, 111, -1] {
                    let mut price = None;
                    for short in [None, Some(0.0), Some(1.0)] {
                        let money = match (short, price) {
                            (None, _) => 1e9,
                            (Some(d), Some(p)) => p - d,
                            (Some(_), None) => unreachable!(),
                        };
                        let mut sim = shaft_site(mode, star, money);
                        let quote = sim.can_build_transport(kind, x, bottom, top);
                        let p = *price.get_or_insert(quote.cost);
                        assert_eq!(quote.cost, p);
                        let shafts = sim.tower.transports.len();
                        let built = sim.build_transport(kind, x, bottom, top);
                        let case =
                            format!("{mode:?} {star}★ {kind:?} x{x} {bottom}..{top} ${money}");
                        assert_eq!(built.ok, quote.ok, "{case}");
                        assert_eq!(built.reason, quote.reason, "{case}");
                        if quote.ok {
                            assert_eq!(money - sim.money, p, "{case}");
                            // The quote passed, so the shaft really stands.
                            assert_eq!(sim.tower.transports.len(), shafts + 1, "{case}");
                            placed += 1;
                        } else {
                            assert_eq!(sim.money, money, "{case}");
                            refused.insert(quote.reason.unwrap_or_default());
                        }
                    }
                }
            }
        }
    }
    assert!(placed > 0);
    // The sweep reaches the lock, the money check and the placement rules.
    for reason in [
        "Not enough money.",
        "Transport needs height.",
        "Off the edge of the lot.",
        "Not a transport.",
    ] {
        assert!(
            refused.contains(reason),
            "{reason} not reached: {refused:?}"
        );
    }
    assert!(
        refused.iter().any(|r| r.contains("unlocks at")),
        "{refused:?}"
    );
}

/// Out-of-range input from a native host is refused by the placement
/// rules without overflowing, in a debug build as in a release one.
#[test]
fn an_out_of_range_shaft_is_refused_without_overflow() {
    let mut sim = shaft_site(GameMode::Modern, 5, 1e30);
    let q = sim.can_build_transport(Kind::Stairs, i64::MAX, 1, 2);
    assert_eq!(q.reason.as_deref(), Some("Off the edge of the lot."));
    let q = sim.can_build_transport(Kind::ElevatorStandard, 100, -2, i64::MAX);
    assert!(!q.ok);
    assert!(q.reason.unwrap().contains("can span at most"));
    let q = sim.can_build_transport(Kind::Stairs, 100, i64::MIN, i64::MAX);
    assert!(q.reason.unwrap().contains("links exactly two floors"));
    // At an ordinary balance a huge elevator span costs more than the
    // tower holds, so the money check refuses it first.
    let rich = shaft_site(GameMode::Modern, 5, 1e9);
    let q = rich.can_build_transport(Kind::ElevatorStandard, 100, -2, i64::MAX);
    assert_eq!(q.reason.as_deref(), Some("Not enough money."));
    // Spans of a valid length (one floor, and an elevator's longest) at
    // both ends of the range reach the rest of the placement rules,
    // which refuse them for want of floors.
    let longest = Kind::ElevatorStandard.max_span();
    for (bottom, top) in [
        (i64::MIN, i64::MIN + 1),
        (i64::MAX - 1, i64::MAX),
        (i64::MIN, i64::MIN + longest),
        (i64::MAX - longest, i64::MAX),
    ] {
        assert!(!sim.can_build_transport(Kind::Stairs, 100, bottom, top).ok);
        assert!(
            !sim.can_build_transport(Kind::ElevatorStandard, 100, bottom, top)
                .ok
        );
    }
    // The structural branch with bridging off checks the lot edge too.
    sim.auto_bridge = false;
    let q = sim.can_build(Kind::Floor, 2, i64::MAX);
    assert_eq!(q.reason.as_deref(), Some("Off the edge of the lot."));
    assert!(!sim.build_transport(Kind::Stairs, i64::MAX, 1, 2).ok);
}

/// An elevator's quote is its catalog price plus the per-floor cost for
/// each floor past its first; stairs and escalators pay the catalog price.
#[test]
fn the_transport_quote_follows_the_catalog() {
    let c = crate::catalog::catalog(GameMode::Modern);
    let sim = shaft_site(GameMode::Modern, 5, 1e9);
    let price = |k: Kind| {
        c.facilities
            .iter()
            .find(|f| f.key == k.as_str())
            .unwrap()
            .cost
    };
    assert_eq!(
        sim.can_build_transport(Kind::ElevatorStandard, 100, 1, 5)
            .cost,
        price(Kind::ElevatorStandard) + 4.0 * c.economy.transport_floor_cost
    );
    assert_eq!(
        sim.can_build_transport(Kind::Stairs, 100, 1, 2).cost,
        price(Kind::Stairs)
    );
}

/// A structural tile far off the lot or outside the floor range has no bridge
/// plan (#1003): the plan used to scan one tile at a time back to the lot,
/// and an extreme coordinate overflowed. The answer is the refusal it always
/// was, and on the lot the plan is unchanged.
#[test]
fn a_structural_tile_far_off_the_lot_has_no_bridge_and_is_refused_at_once() {
    let mut sim = shaft_site(GameMode::Modern, 1, 1e9);
    let started = std::time::Instant::now();
    for kind in [Kind::Floor, Kind::Lobby] {
        for x in [
            i64::MAX,
            i64::MIN,
            i64::from(i32::MAX),
            i64::from(i32::MIN),
            crate::facilities::LOT_WIDTH,
            -1,
        ] {
            for floor in [1, 2, -1] {
                let q = sim.can_build(kind, floor, x);
                assert!(!q.ok, "{kind:?} @ {floor},{x}");
                assert_eq!(q.reason.as_deref(), Some("Off the edge of the lot."));
                assert!(sim.tower.bridge_fill_plan(kind, floor, x, 1, 1).is_empty());
            }
        }
        for floor in [i64::MAX, i64::MIN, crate::facilities::MAX_FLOOR + 1] {
            assert!(sim
                .tower
                .bridge_fill_plan(kind, floor, 100, 1, 1)
                .is_empty());
            assert!(!sim.can_build(kind, floor, 100).ok);
        }
    }
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    // On the lot, a lobby past the strip still bridges the gap to it.
    assert!(!sim
        .tower
        .bridge_fill_plan(Kind::Lobby, 1, 120, 1, 1)
        .is_empty());
    sim.auto_bridge = false;
    assert!(!sim.can_build(Kind::Floor, 2, i64::MAX).ok);
}

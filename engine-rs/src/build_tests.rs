//! Tests for `build.rs`: the transport quote against the build, and the
//! structural refusals.
use crate::clock::GameMode;
use crate::facilities::{Kind, LOBBY_INTERVAL};
use crate::sim::Simulation;
use crate::tower::Tower;

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
    let mut sim = shaft_site(GameMode::Modern, 5, 1e9);
    assert!(sim.auto_bridge);
    let started = std::time::Instant::now();
    for kind in [Kind::Floor, Kind::Lobby] {
        // Nearest the lot first, so a regression fails on a cheap case before
        // it reaches the slow ones.
        for x in [
            crate::facilities::LOT_WIDTH,
            -1,
            i64::from(i32::MAX),
            i64::from(i32::MIN),
            i64::MAX,
            i64::MIN,
        ] {
            for floor in [1, 2, -1] {
                let q = sim.can_build(kind, floor, x);
                assert!(!q.ok, "{kind:?} @ {floor},{x}");
                assert_eq!(q.reason.as_deref(), Some("Off the edge of the lot."));
                assert!(sim.tower.bridge_fill_plan(kind, floor, x, 1, 1).is_empty());
            }
        }
        for floor in [
            i64::MAX,
            i64::MIN,
            crate::facilities::MAX_FLOOR + 1,
            crate::facilities::MIN_FLOOR - 1,
        ] {
            assert!(sim
                .tower
                .bridge_fill_plan(kind, floor, 100, 1, 1)
                .is_empty());
            let q = sim.can_build(kind, floor, 100);
            assert_eq!(q.reason.as_deref(), Some("Outside the buildable range."));
        }
    }
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
    // Each case below seeds a neighbor the old scan would have bridged to,
    // in a tower of its own, so the empty plan comes from the bound alone.
    // A floor tile below the lowest basement.
    let (low, top) = (
        crate::facilities::MIN_FLOOR - 1,
        crate::facilities::MAX_FLOOR,
    );
    let mut t = Tower::new();
    t.struct_kind.insert((low, 97), Kind::Floor);
    assert!(t.bridge_fill_plan(Kind::Floor, low, 100, 1, 1).is_empty());
    // A floor tile above the top floor, resting on structure.
    let mut t = Tower::new();
    t.struct_kind.insert((top + 1, 97), Kind::Floor);
    for x in 98..=99 {
        t.structure.insert((top, x), 0);
    }
    assert!(t
        .bridge_fill_plan(Kind::Floor, top + 1, 100, 1, 1)
        .is_empty());
    // A room whose footprint runs past the lot edge by one tile.
    let lot = crate::facilities::LOT_WIDTH;
    let office = Kind::Office.facility().width;
    let ox = lot - office + 1;
    let q = sim.can_build(Kind::Office, 2, ox);
    assert_eq!(q.reason.as_deref(), Some("Off the edge of the lot."));
    let mut t = Tower::new();
    t.struct_kind.insert((2, ox - 3), Kind::Floor);
    for x in ox - 2..ox {
        t.structure.insert((1, x), 0);
    }
    assert!(t
        .bridge_fill_plan(Kind::Office, 2, ox, office, 1)
        .is_empty());
    // A two-story room whose top story would sit above the top floor.
    let q = sim.can_build(Kind::Cinema, top, 100);
    assert_eq!(
        q.reason.as_deref(),
        Some("Not enough floors above for this facility.")
    );
    let cinema = Kind::Cinema.facility().width;
    let mut t = Tower::new();
    t.struct_kind.insert((top, 97), Kind::Floor);
    for x in 98..=99 {
        t.structure.insert((top - 1, x), 0);
    }
    assert!(t
        .bridge_fill_plan(Kind::Cinema, top, 100, cinema, 2)
        .is_empty());
    // On the lot the plan is unchanged: the lobby strip covers 100..=111, so
    // a lobby at 120 bridges exactly 112..=119, laid outward from the strip.
    let plan = sim.tower.bridge_fill_plan(Kind::Lobby, 1, 120, 1, 1);
    assert_eq!(plan, (112..=119).map(|x| (1, x)).collect::<Vec<_>>());
    sim.auto_bridge = false;
    assert!(!sim.can_build(Kind::Floor, 2, i64::MAX).ok);
}

/// The off-lot guard leaves every in-range footprint alone: a bridge is still
/// planned at the first and last column and at the lowest and top floors.
#[test]
fn a_bridge_is_still_planned_at_each_bound() {
    let at = |fl: i64, x: i64, kind: Kind, support: bool| {
        let mut t = Tower::new();
        t.struct_kind.insert((fl, x), kind);
        if support {
            for g in [x - 2, x - 1, x + 1, x + 2] {
                t.structure.insert((fl - 1, g), 0);
            }
        }
        t
    };
    let xs = |plan: Vec<(i64, i64)>| plan.into_iter().map(|(_, x)| x).collect::<Vec<_>>();
    let last = crate::facilities::LOT_WIDTH - 1;
    let (min, max) = (crate::facilities::MIN_FLOOR, crate::facilities::MAX_FLOOR);
    // The first column, bridging right to a lobby two tiles away.
    let t = at(1, 3, Kind::Lobby, false);
    assert_eq!(xs(t.bridge_fill_plan(Kind::Lobby, 1, 0, 1, 1)), [2, 1]);
    // The last column, bridging left to a lobby two tiles away.
    let t = at(1, last - 3, Kind::Lobby, false);
    assert_eq!(
        xs(t.bridge_fill_plan(Kind::Lobby, 1, last, 1, 1)),
        [last - 2, last - 1]
    );
    // The lowest basement and the top floor.
    let t = at(min, 97, Kind::Floor, false);
    assert_eq!(
        xs(t.bridge_fill_plan(Kind::Floor, min, 100, 1, 1)),
        [98, 99]
    );
    let t = at(max, 97, Kind::Floor, true);
    assert_eq!(
        xs(t.bridge_fill_plan(Kind::Floor, max, 100, 1, 1)),
        [98, 99]
    );
}

/// A two-story room bridges its upper story over the tiles its lower story
/// plans: the upper gap has no structure under it until the plan is built, so
/// only the story below's planned tiles support it, tile by tile.
#[test]
fn an_upper_story_bridges_over_the_tiles_the_story_below_plans() {
    let cinema = Kind::Cinema.facility().width;
    let tower = |supported: &[i64]| {
        let mut t = Tower::new();
        for fl in [5, 6] {
            t.struct_kind.insert((fl, 95), Kind::Floor);
        }
        for &x in supported {
            t.structure.insert((4, x), 0);
        }
        t
    };
    let plan = tower(&[96, 97, 98, 99]).bridge_fill_plan(Kind::Cinema, 5, 100, cinema, 2);
    let both: Vec<_> = [5, 6]
        .into_iter()
        .flat_map(|fl| (96..=99).map(move |x| (fl, x)))
        .collect();
    assert_eq!(plan, both);
    // Support under part of the gap carries up the same tiles and no others.
    let plan = tower(&[98, 99]).bridge_fill_plan(Kind::Cinema, 5, 100, cinema, 2);
    assert_eq!(plan, [(5, 98), (5, 99), (6, 98), (6, 99)]);
    // With nothing under the lower story, neither story bridges.
    assert!(tower(&[])
        .bridge_fill_plan(Kind::Cinema, 5, 100, cinema, 2)
        .is_empty());
    // An empty or negative footprint plans nothing and indexes no flag, even
    // one whose right edge lies left of the lot (x + w < 0), where the scan
    // right would reach a negative tile.
    for (x, w) in [(100, 0), (100, -3), (1, -3)] {
        assert!(tower(&[96, 97, 98, 99])
            .bridge_fill_plan(Kind::Cinema, 5, x, w, 2)
            .is_empty());
    }
}

/// A lobby placed where there is no floor yet pays for that floor too, on the
/// ground floor and on a sky lobby floor: by the Lobby tool, by the Floor tool
/// on the ground floor, for each tile bridged to the tower, and by the brush,
/// with bridging on or (in Modern) off. A lobby over a floor tile pays the
/// lobby's price alone.
#[test]
fn a_lobby_pays_for_the_floor_it_lays() {
    let lobby = Kind::Lobby.facility().cost;
    let floor = Kind::Floor.facility().cost;
    let sky = LOBBY_INTERVAL;
    // A new game starts on an empty lot.
    let x = 100;
    for mode in [GameMode::Classic, GameMode::Modern] {
        let mut sim = Simulation::new_game(1, mode);
        sim.money = 1e9;
        let charged = |sim: &mut Simulation, kind: Kind, story: i64, x: i64| -> f64 {
            let quote = sim.can_build(kind, story, x).cost;
            let before = sim.money;
            assert!(sim.build(kind, story, x).ok, "{kind:?} on {story} at {x}");
            assert_eq!(before - sim.money, quote, "the quote is the charge");
            quote
        };
        let brushed = |sim: &mut Simulation, story: i64, tiles: &[i64]| -> f64 {
            let before = sim.money;
            let r = sim.paint_brush(Kind::Lobby, story, tiles);
            assert_eq!(r.placed, tiles.len() as i64, "{:?}", r.reason);
            before - sim.money
        };
        assert_eq!(charged(&mut sim, Kind::Lobby, 1, x), lobby + floor);
        // Two gap tiles bridged to the first lay their floor too.
        assert_eq!(
            charged(&mut sim, Kind::Lobby, 1, x + 3),
            3.0 * (lobby + floor)
        );
        // The floor tool on the ground floor lays a lobby, at the same price.
        assert_eq!(charged(&mut sim, Kind::Floor, 1, x + 4), lobby + floor);
        assert_eq!(brushed(&mut sim, 1, &[x + 5, x + 6]), 2.0 * (lobby + floor));
        for story in 2..=sky {
            for tx in x..=x + 3 {
                if story < sky || tx < x + 3 {
                    charged(&mut sim, Kind::Floor, story, tx);
                }
            }
        }
        // A sky lobby over a floor tile turns it into lobby for its own price,
        // by the tool and by the brush.
        assert_eq!(charged(&mut sim, Kind::Lobby, sky, x), lobby);
        assert_eq!(brushed(&mut sim, sky, &[x + 1]), lobby);
        // Over the story below with no floor of its own, it lays one.
        assert_eq!(charged(&mut sim, Kind::Lobby, sky, x + 3), lobby + floor);
        if mode == GameMode::Modern {
            assert!(!sim.toggle_auto_bridge(), "bridging off");
            assert_eq!(charged(&mut sim, Kind::Lobby, 1, x + 7), lobby + floor);
            assert_eq!(brushed(&mut sim, 1, &[x + 8]), lobby + floor);
            assert_eq!(charged(&mut sim, Kind::Floor, 1, x + 9), lobby + floor);
            assert_eq!(charged(&mut sim, Kind::Lobby, sky, x + 2), lobby);
        }
    }
}

/// The floor brush on the ground floor lays a lobby only where there is no
/// floor yet: it skips plain floor there (an old save can hold it), as the
/// brush preview does.
#[test]
fn the_floor_brush_on_the_ground_floor_skips_plain_floor() {
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    sim.money = 1e9;
    let x = 100;
    assert!(sim.build(Kind::Lobby, 1, x).ok);
    assert!(sim.tower.place(Kind::Floor, 1, x + 1).ok);
    let before = sim.money;
    let r = sim.paint_brush(Kind::Floor, 1, &[x, x + 1, x + 2]);
    assert_eq!(r.placed, 1, "{:?}", r.reason);
    let tile = Kind::Lobby.facility().cost + Kind::Floor.facility().cost;
    assert_eq!(before - sim.money, tile);
    assert_eq!(sim.tower.structure_kind_at(1, x + 1), Some(Kind::Floor));
    assert_eq!(sim.tower.structure_kind_at(1, x + 2), Some(Kind::Lobby));
}

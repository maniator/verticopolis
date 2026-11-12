//! The event visuals' signals, from the retired engine half of
//! `eventSprites.integration.test.ts` (its sprite-drawing half needs no
//! engine and stays). The signals are transients the renderer polls: a dig
//! that turns up treasure fires the sparkle at its site, and no signal rides
//! along in a save. The TypeScript `trigger*` methods were that engine's own
//! seam; the Rust engine bumps each signal where its event happens.
use super::{seeded_game, MID};
use crate::clock::GameMode;
use crate::facilities::{Kind, LOT_WIDTH};
use crate::sim::{FxState, PointFx, ThiefFx};

#[test]
fn a_dig_that_turns_up_treasure_sparkles_at_the_dig_site() {
    // Seed 42 turns up treasure while parking is dug into a fresh B1 slab.
    let mut sim = seeded_game(42, GameMode::Classic);
    sim.star = 3;
    sim.money = 10_000_000.0;
    let x0 = MID - 20;
    for x in x0..(x0 + 120).min(LOT_WIDTH) {
        sim.tower.place(Kind::Floor, 0, x);
    }
    let width = Kind::Parking.facility().width;
    let mut x = x0;
    while x + width <= (x0 + 120).min(LOT_WIDTH) {
        sim.build(Kind::Parking, 0, x);
        x += width;
    }
    assert!(sim
        .log
        .iter()
        .any(|e| e.text.to_lowercase().contains("treasure")));
    assert!(sim.fx.treasure.seq > 0, "the visual fired");
    assert_eq!(sim.fx.treasure.floor, 0, "at the dug B1 slab");
}

#[test]
fn no_signal_rides_along_in_a_save() {
    let mut sim = seeded_game(1, GameMode::Classic);
    sim.fx = FxState {
        santa_seq: 1,
        explosion: PointFx {
            floor: 9,
            x: 30.0,
            seq: 1,
        },
        thief: ThiefFx {
            caught: false,
            floor: 3,
            x: 0,
            seq: 1,
        },
        treasure: PointFx {
            floor: -1,
            x: 5.0,
            seq: 1,
        },
        vip_seq: 1,
    };
    let save = sim.serialize();
    for key in [
        "santaFxSeq",
        "explosionFx",
        "thiefFx",
        "treasureFx",
        "vipFxSeq",
        "fx",
    ] {
        assert!(save.get(key).is_none(), "{key} is not saved");
    }
    // A reload starts the visual counters clean.
    let reloaded = crate::load::deserialize(&save).expect("loads");
    assert_eq!(reloaded.fx, FxState::default());
}

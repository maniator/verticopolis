//! The one-pass removals and the brush's lobby batch end exactly as the
//! one-by-one edits they replace: the same list, indexes, express stops,
//! wedding hall flag, save and events, and the revision those edits reach
//! (one more after a brush whose lobby took a floor tile's place).

use serde_json::Value;

use crate::brush::BrushResult;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::Tower;

/// A lobby on floor 1, plain floor on 2 to 14 over columns 150 to 209 and
/// on 15 to 31 over 150 to 199, an express shaft from 1 to 31 and sky lobby
/// runs on 15 and 30. The same tower every call.
fn tower() -> Simulation {
    let mut sim = Simulation::new_game(7, GameMode::Classic);
    sim.money = 1e9;
    sim.star = 3;
    for x in 150..210 {
        assert!(sim.tower.place(Kind::Lobby, 1, x).ok);
    }
    for floor in 2..=31 {
        let end = if floor < 15 { 210 } else { 200 };
        for x in 150..end {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok, "{floor} {x}");
        }
    }
    let express = sim.build_transport(Kind::ElevatorExpress, 152, 1, 31);
    assert!(express.ok, "{:?}", express.reason);
    for floor in [15, 30] {
        for x in 160..164 {
            assert!(sim.build(Kind::Lobby, floor, x).ok);
        }
    }
    sim.gameplay.drain();
    sim
}

/// Floor from 32 to 99 over columns 150 to 165 and the wedding hall on the
/// roof (floor 100, the only floor it may stand on). Answers the hall's id.
fn wedding_hall(sim: &mut Simulation) -> i64 {
    sim.star = 5;
    for floor in 32..100 {
        for x in 150..178 {
            assert!(sim.tower.place(Kind::Floor, floor, x).ok, "{floor} {x}");
        }
    }
    let hall = sim.build(Kind::WeddingHall, 100, 150);
    assert!(hall.ok, "{:?}", hall.reason);
    assert_eq!(sim.tower.built_wedding_hall, Some(true));
    sim.gameplay.drain();
    *sim.tower.rooms.get(&(100, 150)).expect("the hall stands")
}

/// The id at `floor`, `x`: structure first, then a room.
fn id_at(t: &Tower, floor: i64, x: i64) -> i64 {
    t.structure
        .get(&(floor, x))
        .or_else(|| t.rooms.get(&(floor, x)))
        .copied()
        .unwrap_or_else(|| panic!("nothing at {floor}, {x}"))
}

/// Every unit's index entry points at it, and no other entry exists.
fn assert_indexed(t: &Tower) {
    assert_eq!(
        t.by_id.len(),
        t.units.len(),
        "the index holds exactly the units"
    );
    for (i, u) in t.units.iter().enumerate() {
        assert_eq!(
            t.by_id.get(&u.id),
            Some(&i),
            "unit {} is indexed at its place",
            u.id
        );
    }
}

fn events(sim: &mut Simulation) -> Vec<Value> {
    sim.gameplay.drain().iter().map(|e| e.to_json()).collect()
}

/// `paintBrush` as the port ran it before the brush moved into the engine:
/// the same passes, one `build` at a time, with no batch.
fn one_by_one(sim: &mut Simulation, kind: Kind, floor: i64, tiles: &[i64]) -> BrushResult {
    let mut placed = 0;
    let mut reason = None;
    let mut progress = true;
    while progress {
        progress = false;
        for &tx in tiles {
            let existing = sim.tower.structure_kind_at(floor, tx);
            if existing == Some(kind) || (existing.is_some() && kind != Kind::Lobby) {
                continue;
            }
            let r = sim.build(kind, floor, tx);
            if r.ok {
                placed += 1;
                progress = true;
            } else {
                reason = r.reason;
            }
        }
    }
    BrushResult { placed, reason }
}

#[test]
fn removing_together_ends_as_removing_one_by_one() {
    let (mut batch, mut single) = (tower(), tower());
    let office = batch.build(Kind::Office, 2, 180);
    assert!(office.ok && single.build(Kind::Office, 2, 180).ok);
    let hall = wedding_hall(&mut batch);
    assert_eq!(wedding_hall(&mut single), hall);
    let t = &batch.tower;
    // Both sky lobbies lose every tile, interleaved, and 30 loses its last
    // first; an unknown id and a repeat remove nothing.
    let ids = vec![
        id_at(t, 15, 161),
        id_at(t, 30, 160),
        id_at(t, 2, 180),
        id_at(t, 15, 160),
        999_999,
        id_at(t, 30, 161),
        id_at(t, 15, 163),
        id_at(t, 2, 180),
        id_at(t, 30, 199),
        id_at(t, 30, 163),
        id_at(t, 30, 162),
        hall,
        id_at(t, 15, 162),
        id_at(t, 1, 209),
    ];
    let express = t.transports[0].id;
    let stops_before = t.stops_of(&t.transports[0]);
    assert!(
        stops_before.contains(&15) && stops_before.contains(&30),
        "the express stops at both sky lobbies"
    );

    let gone = batch.tower.remove_units(&ids);
    let mut expect = Vec::new();
    for &id in &ids {
        if let Some(u) = single.tower.remove_unit(id) {
            expect.push(u.id);
        }
    }
    assert_eq!(gone.iter().map(|u| u.id).collect::<Vec<_>>(), expect);
    assert_eq!(
        gone.len(),
        12,
        "the unknown and repeated ids remove nothing"
    );
    assert_eq!(batch.serialize(), single.serialize());
    assert_eq!(batch.tower.revision, single.tower.revision);
    assert_eq!(batch.tower.built_wedding_hall, Some(false));
    assert_eq!(single.tower.built_wedding_hall, Some(false));
    assert_indexed(&batch.tower);
    let t = &batch.tower;
    let i = t.transport_index(express).expect("the express stands");
    let stops = t.stops_of(&t.transports[i]);
    assert!(
        !stops.contains(&15) && !stops.contains(&30),
        "the express no longer stops at 15 or 30"
    );
    assert_eq!(events(&mut batch), events(&mut single));
}

#[test]
fn removes_one_by_id_and_nothing_for_an_id_it_does_not_hold() {
    let mut sim = tower();
    let first = sim.tower.units[0].id;
    let rev = sim.tower.revision;
    assert_eq!(sim.tower.remove_unit(first).map(|u| u.id), Some(first));
    assert_eq!(sim.tower.remove_unit(first).map(|u| u.id), None);
    assert_eq!(sim.tower.remove_units(&[]).len(), 0);
    assert_eq!(sim.tower.revision, rev + 1);
    assert_indexed(&sim.tower);
}

#[test]
fn a_lobby_brush_ends_as_laying_its_tiles_one_by_one() {
    // Upgrades of plain floor (198, 199, 165, 170), a lobby on a bare tile
    // (205, whose bridge from 199 lays 200 to 204, so 200 is then skipped), a
    // repeated column, and a tile with nothing under it (212), refused every
    // pass.
    let tiles = [198, 205, 199, 165, 200, 199, 212, 170];
    let (mut brush, mut single) = (tower(), tower());
    let rev = brush.tower.revision;
    let got = brush.paint_brush(Kind::Lobby, 15, &tiles);
    let want = one_by_one(&mut single, Kind::Lobby, 15, &tiles);
    assert_eq!(got, want);
    assert_eq!(
        got.placed, 5,
        "198, 205 (its bridge lays 200 to 204), 199, 165 and 170"
    );
    assert!(got.reason.is_some());
    assert_eq!(brush.serialize(), single.serialize());
    assert_eq!(
        brush.tower.revision,
        single.tower.revision + 1,
        "the move to the end bumps the revision once"
    );
    assert!(brush.tower.revision > rev);
    assert_indexed(&brush.tower);
    assert!(brush.tower.lobby_upgrades.is_none(), "the batch ended");
    assert_eq!(events(&mut brush), events(&mut single));
    // A brush that upgrades nothing leaves the list as it laid it.
    let got = brush.paint_brush(Kind::Lobby, 15, &tiles);
    let want = one_by_one(&mut single, Kind::Lobby, 15, &tiles);
    assert_eq!(got, want);
    assert_eq!(got.placed, 0);
    assert_eq!(brush.serialize(), single.serialize());
    assert_eq!(brush.tower.revision, single.tower.revision + 1);
    assert_indexed(&brush.tower);
}

#[test]
fn a_floor_brush_ends_as_laying_its_tiles_one_by_one() {
    // In the basement a tile stands on its neighbor: only 150 and 151 hang
    // under the lobby at first, so the tiles to their left are refused and
    // tried again (the bridge lays some of them). Nothing takes a floor
    // tile's place, so the revision matches.
    let tiles = [147, 148, 149, 150, 151, 150];
    let (mut brush, mut single) = (tower(), tower());
    let got = brush.paint_brush(Kind::Floor, 0, &tiles);
    let want = one_by_one(&mut single, Kind::Floor, 0, &tiles);
    assert_eq!(got, want);
    assert_eq!(got.placed, 3, "the bridges lay the other two");
    assert!(got.reason.is_some(), "a tile was refused on the first pass");
    let laid: Vec<i64> = (140..160)
        .filter(|&x| brush.tower.structure_kind_at(0, x).is_some())
        .collect();
    assert_eq!(laid, [147, 148, 149, 150, 151]);
    assert_eq!(brush.serialize(), single.serialize());
    assert_eq!(brush.tower.revision, single.tower.revision);
    assert_indexed(&brush.tower);
    assert_eq!(events(&mut brush), events(&mut single));
}

#[test]
fn a_malformed_brush_lays_nothing() {
    let mut sim = tower();
    let (save, rev) = (sim.serialize(), sim.tower.revision);
    let many: Vec<i64> = (150..183).collect();
    for (kind, tiles) in [
        (Kind::Office, &[180][..]),
        (Kind::Lobby, &many[..]),
        (Kind::ElevatorExpress, &[][..]),
    ] {
        assert_eq!(
            sim.paint_brush(kind, 15, tiles),
            BrushResult::invalid(),
            "{kind:?}"
        );
    }
    assert_eq!(sim.serialize(), save);
    assert_eq!(sim.tower.revision, rev);
    assert!(sim.tower.lobby_upgrades.is_none());
    // At the limit the brush runs: every tile hangs under the ground lobby.
    let at_limit = sim.paint_brush(Kind::Floor, 0, &many[..32]);
    assert_eq!(
        at_limit,
        BrushResult {
            placed: 32,
            reason: None
        }
    );
}

#[test]
fn a_brush_inside_a_brush_joins_the_outer_batch() {
    let (mut brush, mut single) = (tower(), tower());
    let rev = brush.tower.revision;
    // Floor 15, then 30, then 15 again.
    let (a, b, c) = brush.with_lobby_upgrades(|sim| {
        let a = sim.paint_brush(Kind::Lobby, 15, &[198, 199]);
        assert!(sim.tower.lobby_upgrades.is_some(), "the inner brush joined");
        let b = sim.paint_brush(Kind::Lobby, 30, &[170]);
        (a, b, sim.paint_brush(Kind::Lobby, 15, &[165]))
    });
    assert_eq!(a, one_by_one(&mut single, Kind::Lobby, 15, &[198, 199]));
    assert_eq!(b, one_by_one(&mut single, Kind::Lobby, 30, &[170]));
    assert_eq!(c, one_by_one(&mut single, Kind::Lobby, 15, &[165]));
    assert_eq!(a.placed + b.placed + c.placed, 4);
    assert_eq!(brush.serialize(), single.serialize());
    assert_eq!(
        brush.tower.revision,
        single.tower.revision + 1,
        "one move for every brush"
    );
    assert_eq!(brush.tower.revision, rev + 4 * 2 + 1);
    assert!(brush.tower.lobby_upgrades.is_none(), "the batch ended");
    assert_indexed(&brush.tower);
    assert_eq!(events(&mut brush), events(&mut single));
}

#[test]
fn a_removal_inside_a_brush_still_moves_every_unit_placed() {
    // Removing two tiles near the start of the list shifts the lobby already
    // laid on 198 two places nearer the start, before the slot 199 takes; the
    // move still finds both.
    let (mut brush, mut single) = (tower(), tower());
    let early = [id_at(&brush.tower, 2, 150), id_at(&brush.tower, 2, 151)];
    assert_eq!(
        early,
        [id_at(&single.tower, 2, 150), id_at(&single.tower, 2, 151)]
    );
    brush.with_lobby_upgrades(|sim| {
        assert_eq!(sim.paint_brush(Kind::Lobby, 15, &[198]).placed, 1);
        let gone: Vec<i64> = sim
            .tower
            .remove_units(&early)
            .iter()
            .map(|u| u.id)
            .collect();
        assert_eq!(gone, early);
        assert_eq!(sim.paint_brush(Kind::Lobby, 15, &[199]).placed, 1);
    });
    one_by_one(&mut single, Kind::Lobby, 15, &[198]);
    for id in early {
        assert_eq!(single.tower.remove_unit(id).map(|u| u.id), Some(id));
    }
    one_by_one(&mut single, Kind::Lobby, 15, &[199]);
    assert_eq!(brush.serialize(), single.serialize());
    assert_eq!(brush.tower.revision, single.tower.revision + 1);
    assert_indexed(&brush.tower);
}

#[test]
fn a_panic_inside_the_brush_still_ends_the_batch() {
    let mut sim = tower();
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sim.with_lobby_upgrades(|sim| {
            assert_eq!(sim.paint_brush(Kind::Lobby, 15, &[198]).placed, 1);
            panic!("a host that catches this keeps the tower");
        })
    }));
    assert!(caught.is_err());
    assert!(sim.tower.lobby_upgrades.is_none(), "the batch ended");
    assert_indexed(&sim.tower);
    let lobby = id_at(&sim.tower, 15, 198);
    assert_eq!(sim.tower.units.last().map(|u| u.id), Some(lobby));
}

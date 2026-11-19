use super::*;
use crate::clock::GameMode;
use crate::facilities::{Kind, FACILITIES};
use crate::sim::Simulation;

pub(super) fn code(kind: Kind) -> f64 {
    FACILITIES.iter().position(|f| f.kind == kind).unwrap() as f64
}

pub(super) fn engine() -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    e
}

/// One edit as a gesture: capture, build a lobby at `x`, commit.
pub(super) fn gesture(e: &mut Engine, label: &str, x: f64) {
    e.port_undo_capture(label);
    e.port_build(code(Kind::Lobby), 1.0, x);
    e.port_undo_commit();
}

pub(super) fn units(e: &Engine) -> usize {
    e.sim.tower.units.len()
}

#[test]
fn an_undo_puts_the_tower_back_and_a_redo_puts_the_edit_back() {
    let mut e = engine();
    let start = units(&e);
    gesture(&mut e, "Build Lobby", 100.0);
    let built = e.sim.save_text();
    assert_eq!(units(&e), start + 1);
    assert_eq!(e.port_undo_depths(), vec![1.0, 0.0]);

    let (generation, revision) = (e.generation, e.sim.tower.revision);
    let rec = e.port_undo();
    // The same tower: the generation stays, and the revision a room's
    // removal raises tells the readers the structure moved (#1802).
    assert_eq!(rec, vec![1.0, generation as f64]);
    assert_eq!(e.generation, generation);
    assert!(e.sim.tower.revision > revision);
    assert_eq!(units(&e), start);
    assert_eq!(e.port_undo_notice().as_deref(), Some("Undid: Build Lobby"));
    assert_eq!(e.port_undo_depths(), vec![0.0, 1.0]);

    assert_eq!(e.port_redo()[0], 1.0);
    assert_eq!(e.sim.save_text(), built);
    assert_eq!(e.port_undo_notice().as_deref(), Some("Redid: Build Lobby"));
    assert_eq!(e.port_undo_depths(), vec![1.0, 0.0]);
}

#[test]
fn nothing_to_step_says_so_and_changes_nothing() {
    let mut e = engine();
    let before = e.sim.save_text();
    let generation = e.generation;
    assert_eq!(e.port_undo(), vec![NOTHING_TO_STEP, generation as f64]);
    assert_eq!(e.port_undo_notice().as_deref(), Some("Nothing to undo."));
    assert_eq!(e.port_redo(), vec![NOTHING_TO_STEP, generation as f64]);
    assert_eq!(e.port_undo_notice().as_deref(), Some("Nothing to redo."));
    assert_eq!(e.sim.save_text(), before);
    assert!(e.last_reason_text().is_none());
}

#[test]
fn a_gesture_that_changed_nothing_leaves_no_step() {
    let mut e = engine();
    e.port_undo_capture("Nothing");
    assert!(!e.port_undo_commit());
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);
}

#[test]
fn an_undo_closes_the_gesture_under_way() {
    let mut e = engine();
    let start = units(&e);
    e.port_undo_capture("Build Lobby");
    e.port_build(code(Kind::Lobby), 1.0, 100.0);
    assert_eq!(e.port_undo()[0], 1.0);
    assert_eq!(units(&e), start, "the drag under way was undone");
    assert_eq!(e.port_undo_notice().as_deref(), Some("Undid: Build Lobby"));
}

#[test]
fn a_dropped_gesture_leaves_no_step_unless_it_changed_the_tower() {
    let mut e = engine();
    e.port_undo_capture("Peek");
    e.port_undo_discard();
    assert!(!e.port_undo_commit());
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);
    // An edit the host meant to drop still happened: it is kept, so the
    // older steps never meet a tower they do not know.
    gesture(&mut e, "First", 140.0);
    e.port_undo();
    e.port_undo_capture("Build Lobby");
    e.port_build(code(Kind::Lobby), 1.0, 100.0);
    e.port_undo_discard();
    assert_eq!(
        e.port_undo_depths(),
        vec![1.0, 0.0],
        "kept, and the redo trail ended"
    );
    // The same when the host opens the next gesture over it.
    e.port_undo_capture("Build Lobby");
    e.port_build(code(Kind::Lobby), 1.0, 120.0);
    e.port_undo_capture("Build Lobby");
    assert!(!e.port_undo_commit());
    assert_eq!(e.port_undo_depths(), vec![2.0, 0.0]);
}

#[test]
fn steps_come_back_newest_first_and_a_new_edit_ends_the_redo_trail() {
    let mut e = engine();
    let start = units(&e);
    gesture(&mut e, "First", 100.0);
    gesture(&mut e, "Second", 120.0);
    e.port_undo();
    assert_eq!(units(&e), start + 1);
    assert_eq!(e.port_undo_depths(), vec![1.0, 1.0]);
    gesture(&mut e, "Third", 140.0);
    assert_eq!(e.port_undo_depths(), vec![2.0, 0.0]);
    e.port_undo();
    assert_eq!(e.port_undo_notice().as_deref(), Some("Undid: Third"));
    e.port_undo();
    assert_eq!(e.port_undo_notice().as_deref(), Some("Undid: First"));
    assert_eq!(units(&e), start);
}

#[test]
fn an_undo_keeps_the_live_bridging_setting() {
    let mut e = engine();
    e.sim.auto_bridge = !e.sim.auto_bridge;
    let bridging = e.sim.auto_bridge;
    gesture(&mut e, "Build Lobby", 100.0);
    e.port_undo();
    assert_eq!(e.sim.auto_bridge, bridging);
}

#[test]
fn another_tower_forgets_the_steps_a_restore_included() {
    let mut e = engine();
    gesture(&mut e, "Build Lobby", 100.0);
    let save = e.sim.save_text();
    assert_eq!(e.port_restore(&save)[0], 1.0);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);

    gesture(&mut e, "Build Lobby", 100.0);
    assert_eq!(e.port_load_save(&save)[0], 1.0);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);

    gesture(&mut e, "Build Lobby", 100.0);
    e.port_found(3.0, 1.0, 1.0, false);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);
    e.port_undo_capture("Build Lobby");
    e.port_undo_clear();
    assert!(!e.port_undo_commit());
}

#[test]
fn a_tower_file_forgets_the_steps_and_a_refused_load_keeps_them() {
    let mut e = engine();
    gesture(&mut e, "Build Lobby", 100.0);
    let file = e.port_export_vctower("2.80.0", 1.0e12).expect("the file");
    assert_eq!(e.port_load_save("not a save")[0], 0.0);
    assert_eq!(e.port_found(3.0, 99.0, 1.0, false)[0], 0.0);
    assert_eq!(
        e.port_undo_depths(),
        vec![1.0, 0.0],
        "a refused swap kept them"
    );
    assert_eq!(e.port_load_vctower(&file)[0], 1.0);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);

    // A `.TDT` file holds a Classic tower.
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Classic));
    e.sim.money = 1e9;
    gesture(&mut e, "Build Lobby", 100.0);
    assert!(e.port_tdt_export()[0] > 0.0, "{:?}", e.last_reason_text());
    let bytes = e.port_tdt_file().expect("the TDT bytes");
    assert!(e.port_load_tdt(&bytes, "TOWER.TDT")[0] > 0.0);
    assert_eq!(e.port_undo_depths(), vec![1.0, 0.0], "staging keeps them");
    assert_eq!(e.port_adopt_tdt()[0], 1.0);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0]);
}

#[test]
fn each_stack_holds_the_last_fifty_edits() {
    let mut e = engine();
    for n in 0..60 {
        gesture(&mut e, "Build Lobby", 100.0 + 5.0 * f64::from(n));
    }
    assert_eq!(e.port_undo_depths(), vec![50.0, 0.0]);
    for _ in 0..50 {
        assert_eq!(e.port_undo()[0], 1.0);
    }
    assert_eq!(
        e.port_undo()[0],
        NOTHING_TO_STEP,
        "the button has nothing left"
    );
    assert_eq!(e.port_undo_depths(), vec![0.0, 50.0]);
}

/// Each way a host swaps a tower in forgets the steps, so the rides and the
/// hourly passes a step compares, which a new tower starts again from zero,
/// never meet a step made on another tower. A tower file and a `.TDT`
/// file are in `a_tower_file_forgets_the_steps_and_a_refused_load_keeps_them`.
#[test]
fn every_tower_swap_forgets_the_steps() {
    let with_steps = || {
        let mut e = engine();
        gesture(&mut e, "First", 100.0);
        gesture(&mut e, "Second", 120.0);
        e.port_undo();
        assert_eq!(e.port_undo_depths(), vec![1.0, 1.0]);
        e
    };
    let mut e = with_steps();
    let save = e.sim.save_text();
    assert_eq!(e.port_load_save(&save)[0], 1.0);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0], "a load");
    let mut e = with_steps();
    assert_eq!(e.port_restore(&save)[0], 1.0);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0], "a restore");
    let mut e = with_steps();
    assert_eq!(e.port_found(7.0, 0.0, 0.0, false)[0], 1.0);
    assert_eq!(e.port_undo_depths(), vec![0.0, 0.0], "a new tower");
}

/// A step that puts back only a room's settings (a name, a rent) raises no
/// tower revision, as the edits it reverses raise none, and keeps the
/// generation; the name reaches the readers through the meta log (#1802).
#[test]
fn a_settings_step_keeps_the_revision_and_the_generation() {
    let mut e = engine();
    e.sim.star = 3;
    for x in 100..120 {
        e.sim.tower.place(Kind::Lobby, 1, x);
        e.sim.tower.place(Kind::Floor, 2, x);
    }
    let built = e.sim.build(Kind::Office, 2, 100);
    assert!(built.ok, "{:?}", built.reason);
    let id = e.sim.tower.rooms[&(2, 100)];
    e.port_undo_capture("Rename");
    assert!(e.sim.tower.set_label(id, "Penthouse"));
    e.port_undo_commit();
    e.port_undo_capture("Rent");
    assert!(!e.port_set_rent(id as f64, 300_000.0)[0].is_nan());
    e.port_undo_commit();
    let (generation, revision) = (e.generation, e.sim.tower.revision);
    for take in [Engine::port_undo, Engine::port_undo, Engine::port_redo] {
        let meta = e.sim.tower.meta_revision;
        assert_eq!(take(&mut e), vec![1.0, generation as f64]);
        assert_eq!(e.sim.tower.revision, revision, "no structure moved");
        assert!(
            e.sim.tower.meta_revision > meta,
            "the meta readers look again"
        );
    }
    assert_eq!(e.sim.tower.get_unit(id).unwrap().label, "Penthouse");
}

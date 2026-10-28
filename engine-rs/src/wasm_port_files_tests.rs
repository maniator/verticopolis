use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;

fn built(mode: GameMode) -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, mode));
    e.sim.money = 1e7;
    for x in 150..180 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(e.sim.tower.place(Kind::Office, 2, 160).ok);
    e
}

fn slot(names: &[&str], r: &[f64], name: &str) -> f64 {
    r[names.iter().position(|n| *n == name).unwrap()]
}

#[test]
fn a_stored_save_without_a_stamp_is_a_founders_and_a_restore_is_not() {
    let mut e = built(GameMode::Classic);
    let text = e.sim.serialize().to_string();
    assert_eq!(e.port_restore(&text)[0], 1.0);
    assert!(!e.sim.founder);
    assert_eq!(e.port_load_save(&text)[0], 1.0);
    assert!(e.sim.founder);
}

#[test]
fn a_vctower_round_trips_and_a_stamped_one_is_no_founders() {
    let mut e = built(GameMode::Modern);
    let text = e.port_export_vctower("3.0.0", 1.7e12).unwrap();
    assert_eq!(e.reason, None);
    let generation = e.generation;
    assert_eq!(
        e.port_load_vctower(&text),
        vec![1.0, (generation + 1) as f64]
    );
    assert!(!e.sim.founder);
    assert!(e.sim.tower.units.iter().any(|u| u.kind == Kind::Office));
    // A build name from before 2.0 would mark the tower as a founder's.
    assert_eq!(e.port_export_vctower("1.9.0", 1.7e12), None);
    assert!(e.reason.is_some());
    assert_eq!(e.port_load_vctower("not a file")[0], 0.0);
    assert_eq!(e.generation, generation + 1);
}

#[test]
fn a_tdt_round_trips_through_stage_and_adopt() {
    let mut e = built(GameMode::Classic);
    let r = e.port_tdt_export();
    assert_eq!(r.len(), TDT_EXPORT.len());
    assert_eq!(slot(&TDT_EXPORT, &r, "status"), 1.0);
    assert_eq!(slot(&TDT_EXPORT, &r, "topFloor"), 2.0);
    let bytes = e.port_tdt_file().unwrap();
    assert_eq!(e.port_tdt_file(), None);
    let generation = e.generation;
    let r = e.port_load_tdt(&bytes, "TOWER.TDT");
    assert_eq!(r.len(), LOAD_TDT.len());
    assert_eq!(slot(&LOAD_TDT, &r, "status"), 1.0);
    assert_eq!(slot(&LOAD_TDT, &r, "floors"), 2.0);
    let notes = (slot(&LOAD_TDT, &r, "notes") + slot(&LOAD_TDT, &r, "warnings")) as usize;
    assert!(e.port_tdt_note(notes as f64).is_none());
    // Staging leaves the live tower alone.
    assert_eq!(e.generation, generation);
    assert_eq!(e.port_adopt_tdt(), vec![1.0, (generation + 1) as f64]);
    assert!(!e.sim.founder);
    assert!(e.sim.tower.units.iter().any(|u| u.kind == Kind::Office));
    // Nothing is staged now.
    assert_eq!(e.port_adopt_tdt()[0], 0.0);
    assert_eq!(e.port_tdt_tower_name(), None);
}

#[test]
fn refused_tdt_files_and_towers_answer_a_bare_status() {
    let mut e = built(GameMode::Modern);
    assert_eq!(e.port_tdt_export(), vec![0.0]);
    assert!(e.reason.as_deref().unwrap().contains("Modern"));
    assert_eq!(e.port_tdt_file(), None);
    assert_eq!(e.port_load_tdt(b"junk", "X.TDT"), vec![0.0]);
    assert!(e.reason.is_some());
    assert_eq!(e.port_adopt_tdt()[0], 0.0);
}

#[test]
fn a_done_swap_drops_written_tdt_bytes_and_a_refused_one_keeps_them() {
    let mut e = built(GameMode::Classic);
    let text = e.sim.serialize().to_string();
    assert_eq!(e.port_tdt_export()[0], 1.0);
    assert_eq!(e.port_load_save("not a save")[0], 0.0);
    assert!(e.tdt_file.is_some());
    assert_eq!(e.port_load_save(&text)[0], 1.0);
    assert_eq!(e.port_tdt_file(), None);
}

#[test]
fn tdt_export_writes_the_bytes_the_referee_checks() {
    // The conformance lock pins the TypeScript exporter's bytes for the
    // legacy `exportTdt(serialize())` path; the port's path must write the
    // same bytes for the same tower.
    let mut e = built(GameMode::Classic);
    let legacy = crate::tdt::export_tdt(&e.sim.serialize().to_string()).unwrap();
    assert_eq!(e.port_tdt_export()[0], 1.0);
    assert_eq!(e.port_tdt_file().unwrap(), legacy);
}

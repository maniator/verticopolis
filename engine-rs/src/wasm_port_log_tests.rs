//! The log a loaded tower hands its host (`port_log_after`, `port_log_text`).
use super::*;

fn engine() -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    e.port_drain_events();
    e
}

/// The Bulletin after a load, an import or a page reload: the host asks for every
/// line after 0 and must get each line the save carried, newest last, then
/// nothing more until a new line is written.
#[test]
fn a_loaded_tower_hands_the_bulletin_every_line_its_save_carried() {
    let mut written = engine();
    for i in 1..=crate::sim::LOG_RING_CAP + 5 {
        assert_eq!(written.port_log_line(&format!("event {i}"), 1.0)[0], 1.0);
    }
    let saved: Vec<String> = written.sim.log.iter().map(|l| l.text.clone()).collect();
    let text = written.sim.save_text();
    let loads: [(&str, fn(&mut Engine, &str) -> Vec<f64>); 2] = [
        ("a stored save", |e, t| e.port_load_save(t)),
        ("a .vctower file", |e, t| {
            let file = crate::load::encode_vctower(&serde_json::from_str(t).unwrap()).unwrap();
            e.port_load_vctower(&String::from_utf8(file).unwrap())
        }),
    ];
    for (what, load) in loads {
        let mut e = engine();
        assert_eq!(load(&mut e, &text)[0], 1.0, "{what} loads");
        let after = e.port_log_after(0.0);
        let shown: Vec<String> = after
            .chunks(3)
            .map(|line| e.port_log_text(line[0]).unwrap())
            .collect();
        assert_eq!(shown, saved, "{what}: the Bulletin gets every line");
        let newest = after[after.len() - 3];
        assert!(
            e.port_log_after(newest).is_empty(),
            "{what}: nothing replays"
        );
        e.port_log_line("after the load", 1.0);
        let next = e.port_log_after(newest);
        assert_eq!(
            next.len(),
            3,
            "{what}: a new line follows the restored ones"
        );
        assert_eq!(e.port_log_text(next[0]).as_deref(), Some("after the load"));
    }
}

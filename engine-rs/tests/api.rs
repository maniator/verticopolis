//! The host API (tier 1 in `API.md`) by name. Each item a frontend calls is
//! named here, so renaming or removing one fails this test's build until
//! `API.md` and `consumer/` follow. The test builds with default features,
//! so tier 1 also stays reachable without the `conformance` harness or the
//! `wasm` binding. It pins names, not behavior: the consumer and the lock
//! own behavior.

use verticopolis_engine::canonical::digest;
use verticopolis_engine::catalog::{catalog, CATALOG_VERSION};
use verticopolis_engine::clock::GameMode;
use verticopolis_engine::facilities::Kind;
use verticopolis_engine::frame::{
    frame_view, header, log_since, person, CAR_RECORD, FRAME_HEADER, PERSON_FIXED, TRANSPORT_FIXED,
    UNIT_RECORD, UNKNOWN_ROUTINE,
};
use verticopolis_engine::gameplay::{check_event, GameplayEvent, CATALOG_JSON, GAMEPLAY_RING_CAP};
use verticopolis_engine::load::{
    decode_vctower, deserialize, encode_simulation_vctower, encode_vctower,
    mark_founder_from_loaded_file, stamp_save,
};
use verticopolis_engine::sim::Simulation;
use verticopolis_engine::snapshot::state_view;
use verticopolis_engine::{export_tdt, import_tdt};

#[test]
fn the_host_api_is_in_place() {
    // Starting a game, time, quotes and the player commands.
    let _ = Simulation::new_game;
    let _ = Simulation::new_game_with;
    let _ = Simulation::tick;
    let _ = Simulation::can_build;
    let _ = Simulation::can_build_transport;
    let _ = Simulation::build;
    let _ = Simulation::build_transport;
    let _ = Simulation::sell_at;
    let _ = Simulation::toggle_auto_bridge;
    let _ = Simulation::add_car;
    let _ = Simulation::remove_car;
    let _ = Simulation::extend_transport;
    let _ = Simulation::remove_facility;
    let _ = Simulation::adjust_rent;
    let _ = Simulation::set_no_rate;
    let _ = Simulation::price_unit;
    let _ = Simulation::apply_rent_batch;
    let _ = Simulation::resolve_choice;
    let _ = Simulation::set_film_policy;
    let _ = Simulation::population;
    let _ = Simulation::serialize;
    // Reads: the frame, the log, the hashed snapshot, events, the catalog.
    let _ = frame_view;
    let _ = log_since;
    let _ = state_view;
    let _ = digest;
    let _ = GameplayEvent::to_json;
    let _ = check_event;
    let _ = catalog;
    let _ = (CATALOG_VERSION, CATALOG_JSON, GAMEPLAY_RING_CAP);
    let _ = (
        FRAME_HEADER,
        PERSON_FIXED,
        UNIT_RECORD,
        TRANSPORT_FIXED,
        CAR_RECORD,
    );
    let _ = (UNKNOWN_ROUTINE, header::MONEY, person::ROUTINE);
    // Saves, old and new.
    let _ = decode_vctower;
    let _ = deserialize;
    let _ = mark_founder_from_loaded_file;
    let _ = encode_simulation_vctower;
    let _ = stamp_save;
    let _ = encode_vctower;
    let _ = import_tdt;
    let _ = export_tdt;
    // The handful of reads a host makes on the public fields, and the event
    // buffer it drains each frame.
    let mut sim = Simulation::new_game(1, GameMode::Classic);
    let _ = (sim.money, sim.star, sim.clock.minutes, sim.log_seq);
    let _ = (sim.tower.units.len(), sim.crowd.people.len(), sim.log.len());
    let _: Vec<GameplayEvent> = sim.gameplay.drain();
    let _ = sim.gameplay.dropped;
    let _ = Kind::Lobby;
}

use super::super::port_panels::CREW_COVERAGE;
use super::*;
use crate::clock::GameMode;
use crate::facilities::{Kind, FACILITIES};
use crate::panels::stats::TOWER_STATS;
use crate::sim::Simulation;

fn code(kind: Kind) -> f64 {
    FACILITIES.iter().position(|f| f.kind == kind).unwrap() as f64
}

fn built() -> Engine {
    let mut e = Engine::of(Simulation::new_game(7, GameMode::Modern));
    e.sim.money = 1e9;
    for x in 150..180 {
        assert!(e.sim.tower.place(Kind::Lobby, 1, x).ok);
        assert!(e.sim.tower.place(Kind::Floor, 2, x).ok);
    }
    assert!(e.sim.tower.place(Kind::Office, 2, 160).ok);
    e
}

#[test]
fn the_stats_sheet_matches_the_json_report() {
    let mut e = built();
    let json = e.sim.stats_report();
    let r = e.port_stats_sheet();
    let h = |name: &str| r[STATS_SHEET.iter().position(|n| *n == name).unwrap()];
    assert_eq!(
        h("ratingPopulation"),
        json["ratingPopulation"].as_f64().unwrap()
    );
    assert_eq!(
        h("parkingTotal"),
        json["parkingDemand"]["total"].as_f64().unwrap()
    );
    assert!(h("cleaned").is_nan());
    assert_eq!(h("milestones"), MILESTONE_IDS.len() as f64);
    assert_eq!(h("nextStar"), 1.0);
    let gates = h("gates") as usize;
    let (stranded, elevators, mix) = (
        h("stranded") as usize,
        h("elevators") as usize,
        h("mix") as usize,
    );
    let want = STATS_SHEET.len()
        + TOWER_STATS.len()
        + CREW_COVERAGE.len()
        + LEDGER_CATS.len()
        + NEXT_STAR.len()
        + gates * GATE_ROW.len()
        + stranded
        + MILESTONE_IDS.len()
        + elevators * ELEVATOR_ROW.len()
        + mix * MIX_ROW.len();
    assert_eq!(r.len(), want);
    let stats = &r[STATS_SHEET.len()..STATS_SHEET.len() + TOWER_STATS.len()];
    for (i, name) in TOWER_STATS.iter().enumerate() {
        assert_eq!(stats[i], json["stats"][*name].as_f64().unwrap(), "{name}");
    }
    let star = STATS_SHEET.len() + TOWER_STATS.len() + CREW_COVERAGE.len() + LEDGER_CATS.len();
    assert_eq!(r[star], json["nextStar"]["star"].as_f64().unwrap());
    assert_eq!(gates, json["nextStar"]["gates"].as_array().unwrap().len());
    assert_eq!(stranded, json["strandedFloors"].as_array().unwrap().len());
}

#[test]
fn unit_facts_cover_every_slot_and_refuse_strangers() {
    let mut e = built();
    let id = e
        .sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Office)
        .unwrap()
        .id;
    let facts = e.sim.diagnostic_facts(id).unwrap();
    let r = e.port_unit_facts(id as f64);
    assert_eq!(r.len(), UNIT_FACTS.len());
    let slot = |name: &str| r[UNIT_FACTS.iter().position(|n| *n == name).unwrap()];
    assert_eq!(slot("id"), id as f64);
    assert_eq!(slot("kindCode"), code(Kind::Office));
    assert_eq!(slot("modeCode"), code_of(&MODES, Some("modern")));
    assert_eq!(slot("access"), code_of(&ACCESS_LINES, facts.access));
    assert_eq!(slot("lobby"), flag(facts.lobby.is_some()));
    assert_eq!(slot("wontLease"), flag(facts.wont_lease.is_some()));
    assert_eq!(slot("notice"), 0.0);
    assert!(slot("noticeReason").is_nan());
    for bad in [0.0, -1.0, 1.5, f64::NAN, 1e300] {
        assert!(e.port_unit_facts(bad).is_empty());
    }
}

#[test]
fn keyed_service_diagnostics_return_typed_hotel_verdicts() {
    let mut engine = built();
    let placed = engine.sim.tower.place(Kind::HotelSingle, 2, 170);
    assert!(placed.ok);
    let id = engine
        .sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::HotelSingle)
        .unwrap()
        .id;
    let read = |engine: &mut Engine| {
        serde_json::from_str::<serde_json::Value>(
            &engine.port_service_diagnostics(id as f64).unwrap(),
        )
        .unwrap()
    };
    let initial = read(&mut engine);
    assert_eq!(initial["hotel"]["rating"], "counts");
    assert_eq!(initial["hotel"]["condition"], "other");
    engine.sim.star = 4;
    engine.sim.tower.get_unit_mut(id).unwrap().state = crate::tower::UnitState::Dirty;
    let dirty = read(&mut engine);
    assert_eq!(dirty["hotel"]["rating"], "excluded");
    assert_eq!(dirty["hotel"]["condition"], "dirty");
    assert_eq!(
        dirty["hotel"]["infestDays"],
        crate::housekeeping::INFEST_DAYS
    );
    engine.sim.tower.get_unit_mut(id).unwrap().state = crate::tower::UnitState::Infested;
    let infested = read(&mut engine);
    assert_eq!(infested["hotel"]["condition"], "infested");
    assert_eq!(infested["hotel"]["recovery"], true);
    assert!(engine.port_service_diagnostics(-1.0).is_none());
}

fn extend_floor_for_housekeeping_fixture(engine: &mut Engine) {
    // The base fixture stops at x=180. Housekeeping spans 15 tiles from
    // x=170, and the hotel beside it occupies x=185..189.
    for x in 180..190 {
        let lobby = engine.sim.tower.place(Kind::Lobby, 1, x);
        assert!(lobby.ok, "lobby at {x}: {:?}", lobby.reason);
        let floor = engine.sim.tower.place(Kind::Floor, 2, x);
        assert!(floor.ok, "floor at {x}: {:?}", floor.reason);
    }
}

#[test]
fn keyed_service_diagnostics_keep_housekeeping_decisions_in_rust() {
    let mut engine = built();
    extend_floor_for_housekeeping_fixture(&mut engine);
    let placed = engine.sim.tower.place(Kind::Housekeeping, 2, 170);
    assert!(placed.ok, "{:?}", placed.reason);
    let id = engine
        .sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::Housekeeping)
        .unwrap()
        .id;
    engine.sim.tower.get_unit_mut(id).unwrap().state = crate::tower::UnitState::Occupied;
    let read = |engine: &mut Engine| {
        serde_json::from_str::<serde_json::Value>(
            &engine.port_service_diagnostics(id as f64).unwrap(),
        )
        .unwrap()
    };
    let initial = read(&mut engine);
    assert_eq!(initial["housekeeping"]["status"], "adequate");
    assert_eq!(
        initial["housekeeping"]["maidsPerUnit"],
        crate::housekeeping::HK_MAIDS_PER_UNIT
    );
    assert_eq!(
        initial["housekeeping"]["roomsPerMaid"],
        crate::panels::coverage::HK_NOMINAL_ROOMS_PER_MAID
    );
    engine.sim.housekeeping.yesterday = Some((9, 4));
    let observed = read(&mut engine);
    // With no hotel rooms, the engine correctly suppresses the shortage.
    assert_eq!(observed["housekeeping"]["status"], "adequate");
    assert_eq!(observed["housekeeping"]["cleaned"], 9);
}

#[test]
fn keyed_service_diagnostics_parking_fixture_distinguishes_connected_and_dead_space() {
    let mut engine = built();
    for x in 150..235 {
        assert!(engine.sim.tower.place(Kind::Floor, 0, x).ok);
    }
    let ramp = engine.sim.tower.place(Kind::ParkingRamp, 0, 170);
    let connected = engine.sim.tower.place(Kind::Parking, 0, 186);
    let dead = engine.sim.tower.place(Kind::Parking, 0, 220);
    assert!(
        ramp.ok && connected.ok && dead.ok,
        "fixture must build all parking units"
    );
    let id_of = |engine: &Engine, x: i64| {
        engine
            .sim
            .tower
            .units
            .iter()
            .find(|u| u.kind == Kind::Parking && u.x == x)
            .unwrap()
            .id
    };
    let ramp_id = engine
        .sim
        .tower
        .units
        .iter()
        .find(|u| u.kind == Kind::ParkingRamp)
        .unwrap()
        .id;
    let connected_id = id_of(&engine, 186);
    let dead_id = id_of(&engine, 220);
    for id in [ramp_id, connected_id, dead_id] {
        engine.sim.tower.get_unit_mut(id).unwrap().state = crate::tower::UnitState::Occupied;
    }
    assert!(engine
        .sim
        .tower
        .functional_parking_set()
        .contains(&connected_id));
    assert!(!engine.sim.tower.functional_parking_set().contains(&dead_id));
    let read = |engine: &mut Engine, id: i64| -> serde_json::Value {
        serde_json::from_str(&engine.port_service_diagnostics(id as f64).unwrap()).unwrap()
    };
    assert_eq!(read(&mut engine, ramp_id)["parking"]["status"], "ramp");
    let connected_json = read(&mut engine, connected_id);
    assert_eq!(connected_json["parking"]["status"], "connected");
    assert_eq!(connected_json["parking"]["have"], 1);
    let disconnected_json = read(&mut engine, dead_id);
    assert_eq!(disconnected_json["parking"]["status"], "disconnected");
    assert!(disconnected_json["parking"]["have"].is_null());
    engine.sim.tower.get_unit_mut(ramp_id).unwrap().state = crate::tower::UnitState::Fire;
    assert_eq!(
        read(&mut engine, connected_id)["parking"]["status"],
        "disconnected"
    );
    engine.sim.tower.get_unit_mut(connected_id).unwrap().state = crate::tower::UnitState::Fire;
    assert_eq!(
        read(&mut engine, connected_id)["parking"]["status"],
        "notApplicable"
    );
}

#[test]
fn keyed_housekeeping_fixture_emits_observed_shortfall_only_with_hotel_rooms() {
    let mut engine = built();
    extend_floor_for_housekeeping_fixture(&mut engine);
    let hk = engine.sim.tower.place(Kind::Housekeeping, 2, 170);
    let hotel = engine.sim.tower.place(Kind::HotelSingle, 2, 185);
    assert!(hk.ok, "housekeeping placement: {:?}", hk.reason);
    assert!(hotel.ok, "hotel placement: {:?}", hotel.reason);
    let id_of = |engine: &Engine, kind: Kind| {
        engine
            .sim
            .tower
            .units
            .iter()
            .find(|u| u.kind == kind)
            .unwrap()
            .id
    };
    let hk_id = id_of(&engine, Kind::Housekeeping);
    let hotel_id = id_of(&engine, Kind::HotelSingle);
    for id in [hk_id, hotel_id] {
        engine.sim.tower.get_unit_mut(id).unwrap().state = crate::tower::UnitState::Occupied;
    }
    let read = |engine: &mut Engine| -> serde_json::Value {
        serde_json::from_str(&engine.port_service_diagnostics(hk_id as f64).unwrap()).unwrap()
    };
    assert_eq!(read(&mut engine)["housekeeping"]["status"], "adequate");
    engine.sim.housekeeping.yesterday = Some((8, 4));
    let active = read(&mut engine);
    assert_eq!(active["housekeeping"]["status"], "observedShortfall");
    assert_eq!(active["housekeeping"]["cleaned"], 8);
    assert_eq!(active["housekeeping"]["leftover"], 4);
    engine.sim.tower.get_unit_mut(hotel_id).unwrap().state = crate::tower::UnitState::Construction;
    assert_eq!(read(&mut engine)["housekeeping"]["status"], "adequate");
}

fn fixture(name: &str) -> Engine {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../conformance/fixtures/");
    let text = std::fs::read_to_string(format!("{dir}{name}")).unwrap();
    Engine::of(crate::load_stream::load_vctower_text(&text, None).unwrap())
}

/// A JSON number, NaN for null or absent, 0 or 1 for a boolean.
fn num(v: &serde_json::Value) -> f64 {
    match v {
        serde_json::Value::Bool(b) => flag(*b),
        v => v.as_f64().unwrap_or(f64::NAN),
    }
}

fn same(got: f64, want: f64, what: &str) {
    assert!(
        got == want || (got.is_nan() && want.is_nan()),
        "{what}: {got} vs {want}"
    );
}

fn kind_code(name: &str) -> f64 {
    code(Kind::parse(name).unwrap())
}

/// Every slot of `statsSheet` against `stats_report`, sections included.
fn check_stats_sheet(e: &mut Engine) {
    let j = e.sim.stats_report();
    let r = e.port_stats_sheet();
    let mut want: Vec<f64> = vec![
        num(&j["ratingPopulation"]),
        num(&j["hotelsCountTowardRating"]),
        num(&j["functionalParking"]),
        num(&j["parkingDemand"]["officePop"]),
        num(&j["parkingDemand"]["offices"]),
        num(&j["parkingDemand"]["suites"]),
        num(&j["parkingDemand"]["total"]),
        num(&j["housekeepingReport"]["cleaned"]),
        num(&j["housekeepingReport"]["leftover"]),
        num(&j["recycling"]["capacity"]),
        num(&j["recycling"]["demandMet"]),
        num(&j["nextStarThreshold"]),
        num(&j["vipVisits"]),
        num(&j["vipFavorable"]),
        num(&j["exterminationDueDay"]),
        num(&j["income"]["hasData"]),
        num(&j["households"]["households"]),
        num(&j["households"]["residents"]),
        num(&j["milestones"]["achieved"]),
    ];
    let next = &j["nextStar"];
    let gates = next["gates"].as_array().map_or(&[][..], Vec::as_slice);
    let stranded = j["strandedFloors"].as_array().unwrap();
    let milestones = j["milestones"]["list"].as_array().unwrap();
    let elevators = j["elevators"].as_array().unwrap();
    let mix = j["households"]["mix"].as_array().unwrap();
    want.extend([
        flag(!next.is_null()),
        gates.len() as f64,
        stranded.len() as f64,
        milestones.len() as f64,
        elevators.len() as f64,
        mix.len() as f64,
    ]);
    want.extend(TOWER_STATS.iter().map(|n| num(&j["stats"][*n])));
    want.extend(CREW_COVERAGE.iter().map(|n| num(&j["housekeeping"][*n])));
    want.extend(
        LEDGER_CATS
            .iter()
            .map(|n| num(&j["income"]["averages"][*n])),
    );
    if !next.is_null() {
        want.extend(NEXT_STAR.iter().map(|n| num(&next[*n])));
        for g in gates {
            want.extend([code_of(&STAR_GATES, g["id"].as_str()), num(&g["met"])]);
        }
    }
    want.extend(stranded.iter().map(num));
    want.extend(milestones.iter().map(|m| num(&m["done"])));
    for row in elevators {
        want.extend([
            num(&row["id"]),
            kind_code(row["kind"].as_str().unwrap()),
            num(&row["bottom"]),
            num(&row["top"]),
            num(&row["cars"]),
            num(&row["capacity"]),
            num(&row["utilization"]),
        ]);
    }
    for pair in mix {
        want.extend([num(&pair[0]), num(&pair[1])]);
    }
    assert_eq!(r.len(), want.len());
    for (i, (g, w)) in r.iter().zip(&want).enumerate() {
        same(*g, *w, &format!("statsSheet slot {i}"));
    }
}

fn gripe_want(g: &serde_json::Value) -> Vec<f64> {
    if g.is_null() {
        return vec![
            0.0,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
            f64::NAN,
        ];
    }
    vec![
        1.0,
        code_of(&VACATE_REASONS, g["cause"].as_str()),
        code_of(&BINDINGS, g["binding"].as_str()),
        num(&g["elevatorHere"]),
        num(&g["adjacent"]),
        num(&g["club"]),
        num(&g["coverage"]),
        num(&g["floorReachable"]),
    ]
}

/// Every slot of `unitFacts` against the facts' JSON, for each room; the
/// answer counts the rooms carrying each section (lobby, gripe, won't lease,
/// notice).
fn check_unit_facts(e: &mut Engine) -> [usize; 4] {
    let mut seen = [0; 4];
    let ids: Vec<i64> = e.sim.tower.room_units().map(|u| u.id).collect();
    for id in &ids {
        let f = serde_json::to_value(e.sim.diagnostic_facts(*id).unwrap()).unwrap();
        let r = e.port_unit_facts(*id as f64);
        let (l, s) = (&f["lobby"], &f["lobby"]["slot"]);
        let mut want = vec![
            num(&f["id"]),
            kind_code(f["kind"].as_str().unwrap()),
            code_of(&MODES, f["mode"].as_str()),
            code_of(&ACCESS_LINES, f["access"].as_str()),
            code_of(&NO_RATE_LINES, f["noRate"].as_str()),
            // `farWalk` is in the JSON only when it holds.
            flag(f.get("farWalk").is_some()),
            flag(!l.is_null()),
            num(&l["distance"]),
            num(&l["sinking"]),
            if l.is_null() { 0.0 } else { flag(!s.is_null()) },
            num(&s["floor"]),
            num(&s["onSlot"]),
            num(&s["needsSupport"]),
            num(&s["clearFirst"]),
        ];
        want.extend(gripe_want(&f["gripe"]));
        let w = &f["wontLease"];
        want.extend([flag(!w.is_null()), num(&w["carry"])]);
        want.extend(gripe_want(&w["gripe"]));
        let n = &f["notice"];
        want.extend([
            flag(!n.is_null()),
            code_of(&VACATE_REASONS, n["reason"].as_str()),
            num(&n["minutesLeft"]),
            num(&n["satisfaction"]),
            num(&n["keepAt"]),
        ]);
        assert_eq!(r.len(), want.len());
        for (i, (g, w)) in r.iter().zip(&want).enumerate() {
            same(*g, *w, &format!("unit {id} slot {}", UNIT_FACTS[i]));
        }
        for (k, key) in ["lobby", "gripe", "wontLease", "notice"].iter().enumerate() {
            seen[k] += usize::from(!f[*key].is_null());
        }
    }
    seen
}

#[test]
fn every_slot_matches_the_json_getters_on_real_towers() {
    let (mut rows, mut sections) = ([0.0; 3], [0; 4]);
    for name in [
        "towerone-star4.vctower",
        "split-tower-4.vctower",
        "sixseven_2.vctower",
    ] {
        let mut e = fixture(name);
        check_stats_sheet(&mut e);
        // A few hours of play fill the telemetry and move the tenants.
        for _ in 0..240 {
            e.sim.tick(1.0);
        }
        check_stats_sheet(&mut e);
        // A tenant on notice, as the eviction path leaves one.
        let now = e.sim.clock.minutes;
        if let Some(u) = e
            .sim
            .tower
            .units
            .iter_mut()
            .find(|u| u.kind == Kind::Office && u.is_present())
        {
            u.state = crate::tower::UnitState::Vacating;
            u.vacate_reason = Some("rent");
            u.vacate_at = Some(now + 90.0);
        }
        let r = e.port_stats_sheet();
        for (k, slot) in ["gates", "elevators", "mix"].iter().enumerate() {
            rows[k] += r[STATS_SHEET.iter().position(|n| n == slot).unwrap()];
        }
        for (k, n) in check_unit_facts(&mut e).into_iter().enumerate() {
            sections[k] += n;
        }
    }
    // The towers reach every row encoder and every facts section.
    assert!(rows.iter().all(|n| *n > 0.0), "{rows:?}");
    assert!(sections.iter().all(|n| *n > 0), "{sections:?}");
}

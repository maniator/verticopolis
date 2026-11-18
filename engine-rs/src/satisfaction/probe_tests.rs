//! The move-in gate reads a probe's placement once and steps only the
//! hourly part through its horizon. These tests hold that to the gate it
//! replaced, which ran the whole step every hour, decision for decision.

use super::*;
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::load::deserialize;
use crate::rule_tests::{at_time, fixture_save};

/// The gate as it ran before the placement was read once: the whole
/// `satisfaction_step` for every hour of the horizon.
fn stepwise_dooms(sim: &mut Simulation, u: &Unit, ctx: &mut SatisfactionContext) -> bool {
    let probe = sim.fresh_probe(u.clone(), ctx);
    let hour_now = ctx.hour;
    ctx.shortfalls.set_candidate(Some(fresh_tenant_need(u)));
    let mut s = 1.0;
    let now = sim.clock.hour();
    let mut doomed = true;
    for h in 0..GATE_HORIZON_HOURS {
        ctx.hour = (now + h) % 24;
        let prev = s;
        s = sim.satisfaction_step(&probe, s, ctx).next;
        if s < VACATE_RESCIND {
            break;
        }
        if s >= prev {
            doomed = false;
            break;
        }
    }
    ctx.shortfalls.set_candidate(None);
    ctx.hour = hour_now;
    doomed
}

#[test]
fn the_gate_decides_every_room_as_the_hourly_step_did() {
    let (mut doomed, mut kept) = (0, 0);
    for name in ["sixseven_2", "split-tower", "towerone_6"] {
        for mode in [GameMode::Classic, GameMode::Modern] {
            for hour in [7, 22] {
                let mut sim = deserialize(&fixture_save(name)).expect("the fixture loads");
                sim.mode = mode;
                at_time(&mut sim, 3, hour);
                let rooms: Vec<Unit> = sim.tower.room_units().cloned().collect();
                for neutral in [true, false] {
                    let mut gate = sim.build_satisfaction_context(neutral);
                    let mut stepwise = sim.build_satisfaction_context(neutral);
                    for u in &rooms {
                        let want = stepwise_dooms(&mut sim, u, &mut stepwise);
                        let got = sim.would_evict_fresh_tenant(u, &mut gate);
                        assert_eq!(got, want, "{name} {mode:?} {hour}:00 unit {}", u.id);
                        if got {
                            doomed += 1;
                        } else {
                            kept += 1;
                        }
                    }
                }
            }
        }
    }
    // Both answers come up, so the comparison covers each way out of the walk.
    assert!(doomed > 0 && kept > 0, "doomed {doomed}, kept {kept}");
}

/// A nightclub's halo is felt only in its open hours, so a gate that read
/// the hour once would hold every spot near a club by night (or let one by
/// day). The rooms here sit around a club on a small Modern tower, probed
/// by day and by night.
#[test]
fn the_gate_walks_the_club_hours_as_the_hourly_step_did() {
    use crate::rule_tests::{lot_tower, put, seat, MID};
    use crate::tower::UnitState;
    let mut sim = lot_tower(11, GameMode::Modern, 6);
    let club = put(&mut sim, Kind::Nightclub, 3, MID - 60);
    seat(&mut sim, club, UnitState::Occupied, 1.0);
    let club_width = Kind::Nightclub.facility().width;
    for (kind, floor, x) in [
        (Kind::Condo, 3, MID),
        (Kind::Condo, 3, MID - 60 - club_width - 4),
        (Kind::Condo, 2, MID - 60),
        (Kind::Condo, 4, MID - 60),
        (Kind::Office, 3, MID + 30),
        (Kind::Office, 4, MID),
    ] {
        put(&mut sim, kind, floor, x);
    }
    let rooms: Vec<Unit> = sim.tower.room_units().cloned().collect();
    let mut answers = Vec::new();
    for hour in [3, 12, 18, 22] {
        sim.clock.minutes = f64::from(hour) * 60.0;
        let mut gate = sim.build_satisfaction_context(false);
        let mut stepwise = sim.build_satisfaction_context(false);
        for u in rooms.iter().filter(|u| u.id != club) {
            let want = stepwise_dooms(&mut sim, u, &mut stepwise);
            let got = sim.would_evict_fresh_tenant(u, &mut gate);
            assert_eq!(got, want, "{hour}:00 {:?} unit {}", u.kind, u.id);
            answers.push(got);
        }
    }
    assert!(
        answers.contains(&true) && answers.contains(&false),
        "both answers come up: {answers:?}"
    );
}

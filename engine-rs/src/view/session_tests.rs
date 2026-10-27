//! The command corpus the view tests drive: seeded sessions on real towers.
//! Each step is one engine command, a few minutes of play, or a stretch of
//! up to a day (four hours on a large tower), picked by a seeded generator so a failure
//! replays. The checker runs after every command and after every piece of a
//! stretch, as a host reads once per rendered frame.
use crate::charges::ExtendEnd;
use crate::facilities::Kind;
use crate::gameplay::RemovalMethod;
use crate::rent::BatchTarget;
use crate::sim::Simulation;

/// A seeded xorshift generator: the corpus's only source of choice.
pub(super) struct Picker(u64);

impl Picker {
    pub(super) fn new(seed: u64) -> Picker {
        Picker(seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    /// A whole number in `0..n` (`n` at least 1).
    pub(super) fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    pub(super) fn pick<T: Copy>(&mut self, v: &[T]) -> T {
        v[self.below(v.len())]
    }
}

/// A scenario of the lock run up to one of its checkpoints.
pub(super) fn at(id: &str, label: &str) -> Simulation {
    let suite = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance");
    let text = std::fs::read_to_string(suite.join(format!("scenarios/{id}.json"))).unwrap();
    let s = crate::scenario::Scenario::parse(&text).unwrap();
    crate::scenario::run_scenario_until(&s, &suite, label).unwrap()
}

/// A fixture of the suite loaded as a save, as a scenario starts from it.
pub(super) fn fixture(name: &str, mode: Option<&str>) -> Simulation {
    let suite = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance");
    let text = std::fs::read_to_string(suite.join(format!("fixtures/{name}.vctower"))).unwrap();
    let mut raw = crate::load::decode_vctower(&text).unwrap();
    if let Some(m) = mode {
        raw["mode"] = serde_json::Value::String(m.to_owned());
    }
    crate::load::deserialize(&raw).unwrap()
}

/// The towers the sessions start from, each with its step count: a new
/// Modern game the session grows by its own commands, the medium fixture,
/// the owner's Modern save (its unit list gives floors in pieces), a hotel
/// tower, a tower with a VIP visit pending, a four-star tower with cinemas,
/// shops and an express shaft, and a small Classic tower on fire, which is
/// cheap to play and so gets the longest session.
pub(super) fn starts() -> Vec<(&'static str, Simulation, usize)> {
    vec![
        (
            "new game",
            Simulation::new_game(11, crate::clock::GameMode::Modern),
            120,
        ),
        ("sixseven", fixture("sixseven_2", None), 30),
        ("split-tower-4", fixture("split-tower-4", None), 16),
        ("hotel", fixture("towerone_6", Some("modern")), 30),
        ("vip", fixture("towerone-vip-pending", Some("modern")), 30),
        ("star4", fixture("towerone-star4", None), 30),
        ("fire", at("events-classic", "fire"), 200),
    ]
}

const ROOMS: [Kind; 10] = [
    Kind::Office,
    Kind::Condo,
    Kind::HotelSingle,
    Kind::HotelDouble,
    Kind::Shop,
    Kind::FastFood,
    Kind::Restaurant,
    Kind::Cinema,
    Kind::FitnessClub,
    Kind::Clinic,
];

/// Names a rename tries: blank ones fall back to the catalog name, and the
/// padded one trims to an earlier one.
const NAMES: [&str; 6] = [
    "",
    "   ",
    "Acme Corp",
    "  Acme Corp ",
    "Blue Room",
    "Office",
];

const SCHEDULES: [&str; 3] = [
    r#"{"activeCars":{"weekday":[1,1,1,1,1,1,2,3,4,4,4,4,4,4,4,4,4,4,3,2,1,1,1,1]},"waitingCarResponse":12}"#,
    r#"{"standardFloorDeparture":20,"homeFloors":[1,1,1,1,1,1,1,1]}"#,
    r#"{}"#,
];

/// A unit's id, any unit (tiles included), or `None` on an empty tower.
fn any_unit(sim: &Simulation, p: &mut Picker) -> Option<i64> {
    let units = &sim.tower.units;
    (!units.is_empty()).then(|| units[p.below(units.len())].id)
}

/// A room's id, from the rooms index, or `None` on a tower with no room.
fn any_room(sim: &Simulation, p: &mut Picker) -> Option<i64> {
    let rooms = sim.tower.room_index();
    (!rooms.is_empty()).then(|| sim.tower.units[rooms[p.below(rooms.len())]].id)
}

fn any_room_of(sim: &Simulation, p: &mut Picker, kinds: &[Kind]) -> Option<i64> {
    let ids: Vec<i64> = sim
        .tower
        .units
        .iter()
        .filter(|u| kinds.contains(&u.kind))
        .map(|u| u.id)
        .collect();
    (!ids.is_empty()).then(|| ids[p.below(ids.len())])
}

fn any_shaft(sim: &Simulation, p: &mut Picker) -> Option<(i64, i64, i64)> {
    let ts = &sim.tower.transports;
    (!ts.is_empty()).then(|| {
        let t = &ts[p.below(ts.len())];
        (t.id, t.bottom, t.top)
    })
}

/// A spot near the tower: a unit's floor and x, nudged.
fn near(sim: &Simulation, p: &mut Picker) -> (i64, i64) {
    let Some(id) = any_unit(sim, p) else {
        return (1, 100);
    };
    let u = sim.tower.get_unit(id).unwrap();
    let floor = u.floor + p.pick(&[-1, 0, 0, 1, 1, 2]);
    let x = (u.x + p.pick(&[-24, -8, 0, 4, 8, 24])).clamp(0, 370);
    (floor, x)
}

/// A spot that takes `kind`, from a few random tries over the lot between
/// the tower's lowest and highest floors, or the last try: a full tower
/// still gets builds that land.
fn open_spot(sim: &Simulation, p: &mut Picker, kind: Kind) -> (i64, i64) {
    let (low, high) = (sim.lowest_floor() - 1, sim.highest_floor() + 1);
    let mut spot = near(sim, p);
    for _ in 0..24 {
        if sim.can_build(kind, spot.0, spot.1).ok {
            break;
        }
        let floor = low + p.below((high - low + 1) as usize) as i64;
        spot = (floor, p.below(371) as i64);
    }
    spot
}

/// Run `steps` steps on `sim`, calling `check` with what the step was
/// after each command and after each piece of a stretch of play.
pub(super) fn run(
    sim: &mut Simulation,
    seed: u64,
    steps: usize,
    mut check: impl FnMut(&mut Simulation, &str),
) {
    let mut p = Picker::new(seed);
    sim.money = 1e10;
    for n in 0..steps {
        let what = step(sim, &mut p, &mut check);
        check(sim, &format!("step {n}: {what}"));
    }
}

/// One step: a command, or play. A stretch checks between its pieces.
fn step(
    sim: &mut Simulation,
    p: &mut Picker,
    check: &mut impl FnMut(&mut Simulation, &str),
) -> String {
    match p.below(24) {
        0..=5 => {
            let dt = p.pick(&[1.0, 2.0, 5.0, 15.0]);
            sim.tick(dt);
            format!("tick {dt}")
        }
        6 | 7 => {
            // Up to a day on a small tower, where a day is cheap to play;
            // up to four hours on a large one.
            let longest = if sim.tower.units.len() > 5000 { 8 } else { 48 };
            let pieces = 1 + p.below(longest);
            for k in 0..pieces {
                sim.tick(30.0);
                check(sim, &format!("stretch piece {k} of {pieces}"));
            }
            format!("stretch of {pieces} half hours")
        }
        8 | 9 => {
            let kind = p.pick(&ROOMS);
            let (floor, x) = open_spot(sim, p, kind);
            let r = sim.build(kind, floor, x);
            format!("build {kind:?} at {floor},{x}: {:?}", r.reason)
        }
        10 => {
            // A drag of floor or lobby tiles, rightward when it is odd in
            // length and leftward when even, so the unit list gets runs
            // built both ways.
            let kind = p.pick(&[Kind::Floor, Kind::Lobby]);
            let (floor, x) = open_spot(sim, p, kind);
            let n = 1 + p.below(12);
            let dir = if n % 2 == 1 { 1 } else { -1 };
            let ok = (0..n)
                .filter(|&k| sim.build(kind, floor, x + dir * k as i64).ok)
                .count();
            format!("build {n} {kind:?} from {floor},{x} by {dir}: {ok} placed")
        }
        11 => {
            let kind = p.pick(&[Kind::Stairs, Kind::ElevatorStandard, Kind::Escalator]);
            let mut span = (near(sim, p), 1);
            for _ in 0..16 {
                let ((floor, x), up) = span;
                if sim.can_build_transport(kind, x, floor, floor + up).ok {
                    break;
                }
                span = (near(sim, p), 1 + p.below(6) as i64);
            }
            let ((floor, x), up) = span;
            let r = sim.build_transport(kind, x, floor, floor + up);
            format!("build {kind:?} at x {x}, {floor}-{}: {}", floor + up, r.ok)
        }
        12 => match p.below(4) {
            0 => {
                let (floor, x) = near(sim, p);
                format!("sell at {floor},{x}: {}", sim.sell_at(floor, x))
            }
            1 => match any_unit(sim, p) {
                Some(id) => {
                    let method = p.pick(&[RemovalMethod::Sell, RemovalMethod::Bulldoze]);
                    let r = sim.remove_facility(id, method);
                    format!("remove unit {id} ({method:?}): {}", r.ok)
                }
                None => "remove: no unit".into(),
            },
            2 => match any_shaft(sim, p) {
                Some((id, _, _)) => {
                    let r = sim.remove_facility(id, RemovalMethod::Sell);
                    format!("remove shaft {id}: {}", r.ok)
                }
                None => "remove: no shaft".into(),
            },
            _ => match any_room(sim, p) {
                Some(id) => format!(
                    "tower remove unit {id}: {}",
                    sim.tower.remove_unit(id).is_some()
                ),
                None => "tower remove: no room".into(),
            },
        },
        13 | 14 => {
            let id = if p.below(4) == 0 {
                any_unit(sim, p)
            } else {
                any_room(sim, p)
            };
            let name = p.pick(&NAMES);
            match id {
                Some(id) => format!("rename {id} to {name:?}: {}", sim.tower.set_label(id, name)),
                None => "rename: no unit".into(),
            }
        }
        15 => match any_room_of(sim, p, &[Kind::Shop, Kind::FastFood, Kind::Restaurant]) {
            Some(id) => format!("reroll {id}: {:?}", sim.reroll_subtype(id)),
            None => "reroll: no retail".into(),
        },
        16 => match any_shaft(sim, p) {
            Some((id, _, _)) => match p.below(3) {
                0 => {
                    let cars = 1 + p.below(8) as i64;
                    format!("set cars {id} {cars}: {}", sim.set_cars(id, cars))
                }
                1 => format!("add car {id}: {}", sim.add_car(id).ok),
                _ => format!("remove car {id}: {}", sim.remove_car(id).ok),
            },
            None => "cars: no shaft".into(),
        },
        17 => match any_shaft(sim, p) {
            Some((id, bottom, top)) => match p.below(3) {
                0 => {
                    let floor = bottom + p.below((top - bottom + 1) as usize) as i64;
                    let stop = p.below(2) == 0;
                    let ok = sim.tower.set_stop(id, floor, stop);
                    format!("set stop {id} {floor} {stop}: {ok}")
                }
                1 => format!("clear stops {id}: {}", sim.tower.clear_stops(id)),
                _ => {
                    sim.tower.set_express_stops(id);
                    format!("express stops {id}")
                }
            },
            None => "stops: no shaft".into(),
        },
        18 => match any_room(sim, p) {
            Some(id) => match p.below(4) {
                0 => {
                    let dir = p.pick(&[1, -1]);
                    format!("adjust rent {id} {dir}: {:?}", sim.adjust_rent(id, dir))
                }
                1 => format!("no rate {id}: {}", sim.set_no_rate(id)),
                2 => {
                    let target = p.pick(&[1.0, 5000.0, 150000.0, 900000.0]);
                    format!("price {id} {target}: {:?}", sim.price_unit(id, target))
                }
                _ => {
                    let kind = p.pick(&ROOMS);
                    let target = p.pick(&[
                        BatchTarget::Default,
                        BatchTarget::NoRate,
                        BatchTarget::Price(20000.0),
                    ]);
                    let r = sim.apply_rent_batch(kind, target, p.below(2) == 0);
                    format!("rent batch {kind:?}: {:?}", r.map(|r| r.changed))
                }
            },
            None => "rent: no room".into(),
        },
        19 => match p.below(2) {
            0 => match any_room_of(sim, p, &[Kind::Cinema]) {
                Some(id) => {
                    let policy = p.pick(&["auto", "feature", "blockbuster"]);
                    format!(
                        "film policy {id} {policy}: {:?}",
                        sim.set_film_policy(id, policy)
                    )
                }
                None => "film policy: no cinema".into(),
            },
            _ => match any_shaft(sim, p) {
                Some((id, _, _)) => {
                    let text = p.pick(&SCHEDULES);
                    let raw: serde_json::Value = serde_json::from_str(text).unwrap();
                    format!("schedule {id}: {}", sim.tower.set_schedule(id, &raw))
                }
                None => "schedule: no shaft".into(),
            },
        },
        20 => match p.below(5) {
            0 => {
                sim.start_fire();
                "start fire".into()
            }
            1 => {
                sim.bomb_threat();
                "bomb threat".into()
            }
            2 => {
                let accept = p.below(2) == 0;
                sim.resolve_choice(accept);
                format!("resolve choice {accept}")
            }
            3 => format!("exterminator: {:?}", sim.call_exterminator().is_ok()),
            _ => {
                sim.evaluate_star();
                "evaluate star".into()
            }
        },
        21 => match any_shaft(sim, p) {
            Some((id, bottom, top)) => {
                let (b, t) = (bottom + p.pick(&[-1, 0, 1]), top + p.pick(&[-2, 0, 2]));
                let r = sim.resize_transport(id, b, t);
                format!("resize {id} to {b}-{t}: {}", r.ok)
            }
            None => "resize: no shaft".into(),
        },
        22 => match any_shaft(sim, p) {
            Some((id, bottom, top)) => {
                let (end, floor) = if p.below(2) == 0 {
                    (ExtendEnd::Up, top + 1 + p.below(3) as i64)
                } else {
                    (ExtendEnd::Down, bottom - 1)
                };
                let r = sim.extend_transport(id, end, floor);
                format!("extend {id} to {floor}: {}", r.charge.ok)
            }
            None => "extend: no shaft".into(),
        },
        _ => {
            let on = sim.toggle_auto_bridge();
            format!("auto bridge {on}")
        }
    }
}

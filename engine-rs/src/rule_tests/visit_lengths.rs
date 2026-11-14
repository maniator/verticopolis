//! A visit lasts as long as its venue keeps people (`dwell_seconds_range`):
//! a film 90 to 120 game minutes, a shop or a meal 30 to 60. Everyone who
//! visits comes in through the lobby or the Metro and goes back out the
//! same way, so no one appears or vanishes on a venue's floor. The case
//! that was reported: someone followed from the Metro to the cinema's floor
//! stood there about a game minute and was gone. That was one of the old
//! one-way venue trips, which `spawn_trips` no longer sends.
use std::collections::{HashMap, HashSet};

use crate::clock::GameMode;
use crate::crowd::PState;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::UnitState;

use super::at_time;
use super::metro_shoppers::{b, metro_tower};
use super::{put, MID};

const CINEMA_FLOOR: i64 = b(7);
const SHOP_FLOOR: i64 = b(8);

/// The Metro tower with offices on floor 2, a cinema alone on B7 and a shop
/// alone on B8, both open for business.
fn venue_tower(mode: GameMode) -> (Simulation, i64, i64) {
    let mut sim = metro_tower(mode, true);
    for x in [10, 30, 50, 70] {
        let id = put(&mut sim, Kind::Office, 2, x);
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    let cinema = put(&mut sim, Kind::Cinema, CINEMA_FLOOR, MID + 10);
    let shop = put(&mut sim, Kind::Shop, SHOP_FLOOR, MID + 10);
    for id in [cinema, shop] {
        sim.tower.get_unit_mut(id).unwrap().state = UnitState::Occupied;
    }
    (sim, cinema, shop)
}

/// What two days of play showed: each finished stay at a venue, in game
/// minutes, with the hour it ended; and every floor a person was first or
/// last seen on.
struct Seen {
    stays: HashMap<i64, Vec<(f64, i64)>>,
    first_floors: HashSet<i64>,
    last_floors: HashSet<i64>,
}

fn two_days(sim: &mut Simulation) -> Seen {
    let mut seen = Seen {
        stays: HashMap::new(),
        first_floors: HashSet::new(),
        last_floors: HashSet::new(),
    };
    let mut dwelling: HashMap<i64, (Option<i64>, f64)> = HashMap::new();
    let mut last_floor: HashMap<i64, i64> = HashMap::new();
    at_time(sim, 0, 10);
    for minute in 1..=(2 * 24 * 60) {
        sim.tick(1.0);
        let minute = minute as f64;
        let mut here = HashSet::new();
        // Staff (housekeepers, and the venues' own staff, who walk into the
        // venue they work at: `office_commute`-style tests cover them) are
        // left out: this counts the visitors.
        for p in sim.crowd.people.iter().filter(|p| !p.staff && !p.commuter) {
            here.insert(p.id);
            if last_floor.insert(p.id, p.floor).is_none() {
                seen.first_floors.insert(p.floor);
            }
            if p.state == PState::Dwelling {
                dwelling.entry(p.id).or_insert((p.meal_venue_id, minute));
            } else if let Some((venue, since)) = dwelling.remove(&p.id) {
                if let Some(venue) = venue {
                    let hour = sim.clock.hour();
                    seen.stays
                        .entry(venue)
                        .or_default()
                        .push((minute - since, hour));
                }
            }
        }
        last_floor.retain(|id, floor| {
            let stays = here.contains(id);
            if !stays {
                seen.last_floors.insert(*floor);
            }
            stays
        });
    }
    seen
}

#[test]
fn no_one_appears_or_vanishes_on_a_venues_floor() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, cinema, shop) = venue_tower(mode);
        let seen = two_days(&mut sim);
        assert!(!seen.stays[&cinema].is_empty(), "{mode:?}: filmgoers came");
        assert!(!seen.stays[&shop].is_empty(), "{mode:?}: shoppers came");
        for floor in [CINEMA_FLOOR, SHOP_FLOOR] {
            assert!(
                !seen.first_floors.contains(&floor),
                "{mode:?}: someone appeared on floor {floor}"
            );
            assert!(
                !seen.last_floors.contains(&floor),
                "{mode:?}: someone vanished on floor {floor}"
            );
        }
    }
}

#[test]
fn a_film_lasts_90_to_120_minutes_and_a_shop_visit_30_to_60() {
    for mode in [GameMode::Classic, GameMode::Modern] {
        let (mut sim, cinema, shop) = venue_tower(mode);
        let seen = two_days(&mut sim);
        // A venue that closes sends everyone home, so a stay that ends at
        // closing time may be cut short. A stay is read to the minute, so
        // each bound gives one minute either way.
        let while_open = |venue: i64, kind: Kind| -> Vec<f64> {
            seen.stays[&venue]
                .iter()
                .filter(|s| kind.is_open_at(s.1))
                .map(|s| s.0)
                .collect()
        };
        let full = while_open(cinema, Kind::Cinema);
        assert!(full.len() > 100, "{mode:?}: {} films", full.len());
        for len in &full {
            assert!(
                (89.0..=121.0).contains(len),
                "{mode:?}: a film of {len} minutes"
            );
        }
        // A shopper who finds the shop full turns straight back out; the
        // rest browse half an hour to an hour.
        let shopping = while_open(shop, Kind::Shop);
        let browsed: Vec<f64> = shopping.iter().copied().filter(|&l| l > 2.0).collect();
        assert!(
            browsed.len() * 2 > shopping.len(),
            "{mode:?}: most shoppers browse"
        );
        for len in &browsed {
            assert!(
                (29.0..=61.0).contains(len),
                "{mode:?}: a shop visit of {len} minutes"
            );
        }
    }
}

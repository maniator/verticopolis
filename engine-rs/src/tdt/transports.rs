//! Transport reconstruction for a `.TDT` import (`tdtTransports.ts`): the
//! decoded elevator and stairs tables mapped onto our transports, or a
//! deterministic layout synthesized from the floor map when the save's
//! transport blocks cannot be read.

use std::collections::{BTreeMap, HashMap};

use serde_json::{json, Value};

use super::format::{tdt_stair_stories, TDT_FLOOR_OFFSET};
use super::tables::elevator_kind;
use super::types::{TdtElevator, TdtStair};
use crate::facilities::{is_lobby_floor, Kind, LOBBY_INTERVAL, LOT_WIDTH, MAX_FLOOR, MIN_FLOOR};
use crate::jsmath::round;

/// A transport as the importer writes it into the save.
#[derive(Clone, Debug, PartialEq)]
pub struct OutTransport {
    pub id: i64,
    pub kind: Kind,
    pub x: i64,
    pub width: i64,
    pub bottom: i64,
    pub top: i64,
    pub cars: i64,
    pub car_positions: Vec<i64>,
    /// The waiting floor of each car the save names (the per-car home bytes
    /// of the elevator record). Written as the shaft's `schedule.homeFloors`
    /// so idle cars go back to them after their first trip, as in the 1994
    /// game. `None` for synthesized shafts, whose save names no homes.
    pub home_floors: Option<Vec<i64>>,
    /// `None` leaves `skipFloors` out of the save, as the synthesized
    /// standard and service shafts do.
    pub skip_floors: Option<Vec<i64>>,
}

impl OutTransport {
    pub fn to_json(&self) -> Value {
        let mut m = serde_json::Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("kind".into(), json!(self.kind.as_str()));
        m.insert("x".into(), json!(self.x));
        m.insert("width".into(), json!(self.width));
        m.insert("bottom".into(), json!(self.bottom));
        m.insert("top".into(), json!(self.top));
        m.insert("cars".into(), json!(self.cars));
        m.insert("carPositions".into(), json!(self.car_positions));
        m.insert("carDir".into(), json!(vec![0; self.car_positions.len()]));
        m.insert("load".into(), json!(0));
        if let Some(h) = &self.home_floors {
            m.insert("schedule".into(), json!({ "homeFloors": h }));
        }
        if let Some(s) = &self.skip_floors {
            m.insert("skipFloors".into(), json!(s));
        }
        Value::Object(m)
    }
}

/// What the decode-path mapping produced, with its loss accounting.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DecodedTransports {
    pub transports: Vec<OutTransport>,
    pub dropped_shafts: i64,
    pub adjusted_shafts: i64,
    pub dropped_flights: i64,
}

/// True when placing a transport would overlap one already placed; stacked
/// walkways of the same footprint may share their landing floor.
fn overlaps_placed(
    placed: &[OutTransport],
    kind: Kind,
    x: i64,
    width: i64,
    bottom: i64,
    top: i64,
) -> bool {
    let is_walkway = kind.is_walkway();
    for t in placed {
        if x >= t.x + t.width || t.x >= x + width {
            continue;
        }
        if bottom > t.top || t.bottom > top {
            continue;
        }
        if is_walkway
            && t.kind.is_walkway()
            && t.x == x
            && t.width == width
            && (bottom == t.top || top == t.bottom)
        {
            continue;
        }
        return true;
    }
    false
}

/// `transportsFromDecoded`.
pub fn transports_from_decoded(
    elevators: &[TdtElevator],
    stairs: &[TdtStair],
    first_id: i64,
) -> DecodedTransports {
    let mut out: Vec<OutTransport> = vec![];
    let mut dropped_shafts = 0;
    let mut adjusted_shafts = 0;
    let mut dropped_flights = 0;
    for e in elevators {
        let Some(kind) = elevator_kind(e.type_id) else {
            dropped_shafts += 1;
            continue;
        };
        let raw_bottom = e.bottom_floor - TDT_FLOOR_OFFSET;
        let raw_top = e.top_floor - TDT_FLOOR_OFFSET;
        if raw_top <= raw_bottom {
            dropped_shafts += 1;
            continue;
        }
        let bottom = raw_bottom.max(MIN_FLOOR);
        let mut top = raw_top.min(MAX_FLOOR);
        if top <= bottom {
            dropped_shafts += 1;
            continue;
        }
        let mut trimmed = bottom != raw_bottom || top != raw_top;
        if top - bottom > kind.max_span() {
            top = bottom + kind.max_span();
            trimmed = true;
        }
        let width = kind.facility().width;
        let x = e.x.min(LOT_WIDTH - width).max(0);
        if overlaps_placed(&out, kind, x, width, bottom, top) {
            dropped_shafts += 1;
            continue;
        }
        if trimmed {
            adjusted_shafts += 1;
        }
        let cars = e.cars.min(kind.max_cars()).max(1);
        let mut skip_floors = vec![];
        for fl in bottom + 1..top {
            if e.serviced[(fl + TDT_FLOOR_OFFSET) as usize] == 0 {
                skip_floors.push(fl);
            }
        }
        // Each car starts on its waiting floor and returns there when idle.
        // A home the shaft does not stop at snaps to the nearest stop (the
        // lower one on a tie), as an authored home does on a stop edit.
        let stops: Vec<i64> = (bottom..=top)
            .filter(|f| !skip_floors.contains(f))
            .collect();
        let car_positions: Vec<i64> = (0..cars as usize)
            .map(|i| {
                let home = e.car_homes[i] - TDT_FLOOR_OFFSET;
                *stops
                    .iter()
                    .min_by_key(|&&f| (f - home).abs())
                    .expect("bottom is a stop")
            })
            .collect();
        let home_floors = Some(car_positions.clone());
        out.push(OutTransport {
            id: first_id + out.len() as i64,
            kind,
            x,
            width,
            bottom,
            top,
            cars,
            car_positions,
            home_floors,
            skip_floors: Some(skip_floors),
        });
    }
    let mut walkways = 0;
    for s in stairs {
        if s.type_id > 5 {
            continue;
        }
        let kind = if s.type_id % 2 == 1 {
            Kind::Stairs
        } else {
            Kind::Escalator
        };
        let stories = tdt_stair_stories(s.type_id);
        let width = kind.facility().width;
        let x = s.x.min(LOT_WIDTH - width).max(0);
        let base = s.floor - TDT_FLOOR_OFFSET;
        for i in 0..stories {
            let bottom = base + i;
            if bottom < MIN_FLOOR || bottom + 1 > MAX_FLOOR {
                continue;
            }
            if walkways >= 64 {
                dropped_flights += 1;
                continue;
            }
            if overlaps_placed(&out, kind, x, width, bottom, bottom + 1) {
                dropped_flights += 1;
                continue;
            }
            walkways += 1;
            out.push(OutTransport {
                id: first_id + out.len() as i64,
                kind,
                x,
                width,
                bottom,
                top: bottom + 1,
                cars: 0,
                car_positions: vec![],
                home_floors: None,
                skip_floors: None,
            });
        }
    }
    DecodedTransports {
        transports: out,
        dropped_shafts,
        adjusted_shafts,
        dropped_flights,
    }
}

/// Built extent [left, right) per floor, in ascending floor order (the
/// order the importer's paving map is filled in).
pub type BuiltExtents = BTreeMap<i64, (i64, i64)>;

/// The fallback layout and the shafts it had no safe column for.
pub struct Synthesized {
    pub transports: Vec<OutTransport>,
    /// Shafts left out because every column held a room or an earlier shaft on
    /// a floor they serve; a shaft over a room would be an invalid tower.
    pub left_out: i64,
}

/// `synthesizeTransports`: the fallback layout from the floor map alone.
pub fn synthesize_transports(
    built_extents: &BuiltExtents,
    claimed: &HashMap<i64, Vec<u8>>,
    hotel_floors: &[i64],
    staff_floors: &[i64],
    first_id: i64,
) -> Synthesized {
    if built_extents.is_empty() {
        return Synthesized {
            transports: vec![],
            left_out: 0,
        };
    }
    let mut bottom = i64::MAX;
    let mut top = i64::MIN;
    let mut min_left = i64::MAX;
    let mut max_right = i64::MIN;
    for (&floor, &(left, right)) in built_extents {
        bottom = bottom.min(floor);
        top = top.max(floor);
        min_left = min_left.min(left);
        max_right = max_right.max(right);
    }
    let center = round((min_left + max_right) as f64 / 2.0) as i64;

    struct Spec {
        kind: Kind,
        bottom: i64,
        top: i64,
        skip_floors: Option<Vec<i64>>,
    }
    let mut specs: Vec<Spec> = vec![];
    let mut covered = i64::MIN;
    let ground_top = (bottom + 30).min(top);
    if ground_top > bottom {
        specs.push(Spec {
            kind: Kind::ElevatorStandard,
            bottom,
            top: ground_top,
            skip_floors: None,
        });
        covered = ground_top;
    }
    let mut anchor = LOBBY_INTERVAL;
    while anchor < top {
        let band_bottom = anchor.max(bottom);
        let band_top = (band_bottom + 30).min(top);
        if !(band_top <= covered || band_top <= band_bottom) {
            specs.push(Spec {
                kind: Kind::ElevatorStandard,
                bottom: band_bottom,
                top: band_top,
                skip_floors: None,
            });
            covered = band_top;
        }
        anchor += LOBBY_INTERVAL;
    }
    if top >= 30 {
        let ex_bottom = bottom.max(1);
        if top > ex_bottom {
            let skip: Vec<i64> = (ex_bottom + 1..top)
                .filter(|&fl| !is_lobby_floor(fl))
                .collect();
            specs.push(Spec {
                kind: Kind::ElevatorExpress,
                bottom: ex_bottom,
                top,
                skip_floors: Some(skip),
            });
        }
    }
    if !hotel_floors.is_empty() {
        let staff_range: Vec<i64> = hotel_floors
            .iter()
            .chain(staff_floors.iter())
            .copied()
            .chain(std::iter::once(1))
            .collect();
        let mut lo = staff_range.iter().copied().min().unwrap_or(1).max(bottom);
        let hi = staff_range.iter().copied().max().unwrap_or(1).min(top);
        while lo < hi {
            let t = (lo + 30).min(hi);
            specs.push(Spec {
                kind: Kind::ElevatorService,
                bottom: lo,
                top: t,
                skip_floors: None,
            });
            lo = t;
        }
    }
    specs.truncate(24);
    let total_width: i64 = specs.iter().map(|s| s.kind.facility().width).sum();
    let mut x = round(center as f64 - total_width as f64 / 2.0)
        .min((LOT_WIDTH - total_width) as f64)
        .max(0.0) as i64;
    let mut transports: Vec<OutTransport> = vec![];
    let mut left_out = 0;
    for s in specs {
        let width = s.kind.facility().width;
        let cars = 8;
        // The strip of shafts goes where the tower's middle is. A shaft whose
        // column holds a room, or another shaft, moves to the nearest column
        // that is free over every floor it serves; with none free it is left out.
        let free = |at: i64| {
            at >= 0
                && at + width <= LOT_WIDTH
                && !(s.bottom..=s.top).any(|floor| {
                    claimed.get(&floor).is_some_and(|row| {
                        row[at as usize..(at + width) as usize]
                            .iter()
                            .any(|&c| c != 0)
                    })
                })
                && !transports.iter().any(|t| {
                    at < t.x + t.width && t.x < at + width && s.bottom <= t.top && t.bottom <= s.top
                })
        };
        let placed = (0..=LOT_WIDTH)
            .flat_map(|step| [x + step, x - step])
            .find(|&at| free(at));
        x += width;
        let Some(placed) = placed else {
            left_out += 1;
            continue;
        };
        transports.push(OutTransport {
            id: first_id + transports.len() as i64,
            kind: s.kind,
            x: placed,
            width,
            bottom: s.bottom,
            top: s.top,
            cars,
            car_positions: (0..cars).map(|i| (s.bottom + i).min(s.top)).collect(),
            home_floors: None,
            skip_floors: s.skip_floors,
        });
    }
    Synthesized {
        transports,
        left_out,
    }
}

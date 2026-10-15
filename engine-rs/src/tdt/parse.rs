//! The `.TDT` parse pass (`tdtParse.ts`): the raw `TdtTower` the binary
//! walker produces, mapped into the serialized game the engine loads.

use std::collections::{BTreeMap, HashMap};

use serde_json::{json, Map, Value};

use super::format::{parse_tdt_binary, view_from_view_words, TDT_FLOOR_OFFSET};
use super::import::{hash_seed, tower_name_from_filename};
use super::import_report::{DecodeStats, ImportCounts};
use super::pacing::minute_of_day_for_frame;
use super::part_merge::{merge_parts, PartRecord};
use super::tables::*;
use super::transports::{
    synthesize_transports, transports_from_decoded, BuiltExtents, OutTransport,
};
use super::types::{TdtTenant, TdtTower};
use super::LegacyImportError;
use crate::facilities::{is_lobby_floor, Kind, LOT_WIDTH, MAX_FLOOR};
use crate::sim::SAVE_VERSION;

/// Result of a successful parse: the save, the binary walk's warnings and the
/// tally the report is built from.
#[derive(Clone, Debug)]
pub struct ParsedLegacyTower {
    pub save: Value,
    pub warnings: Vec<String>,
    pub counts: ImportCounts,
    pub decode_stats: DecodeStats,
    pub decoded: bool,
    pub header_notes: Vec<String>,
    pub tower: TdtTower,
}

/// A number as JavaScript would serialize it: an integer when whole.
pub fn jnum(x: f64) -> Value {
    if x.fract() == 0.0 && x.abs() < 9007199254740992.0 {
        json!(x as i64)
    } else {
        json!(x)
    }
}

/// A unit as the importer writes it into the save.
struct OutUnit {
    id: i64,
    kind: Kind,
    floor: i64,
    x: i64,
    width: i64,
    state: &'static str,
    occupants: i64,
    ever_occupied: bool,
    rent: Option<f64>,
    no_rate: bool,
    subtype: Option<&'static str>,
    complete_at: Option<i64>,
}

impl OutUnit {
    fn to_json(&self) -> Value {
        let mut m = Map::new();
        m.insert("id".into(), json!(self.id));
        m.insert("kind".into(), json!(self.kind.as_str()));
        m.insert("floor".into(), json!(self.floor));
        m.insert("x".into(), json!(self.x));
        m.insert("width".into(), json!(self.width));
        m.insert("state".into(), json!(self.state));
        m.insert("satisfaction".into(), json!(1));
        m.insert("occupants".into(), json!(self.occupants));
        m.insert("everOccupied".into(), json!(self.ever_occupied));
        m.insert("pendingIncome".into(), json!(0));
        m.insert("label".into(), json!(self.kind.facility().name));
        if let Some(r) = self.rent {
            m.insert("rent".into(), jnum(r));
        }
        if self.no_rate {
            m.insert("noRate".into(), json!(true));
        }
        if let Some(s) = self.subtype {
            m.insert("subtype".into(), json!(s));
        }
        if let Some(c) = self.complete_at {
            m.insert("completeAt".into(), json!(c));
        }
        Value::Object(m)
    }
}

/// `parseTDT`: an original SimTower `.TDT` buffer into our save schema.
pub fn parse_tdt(bytes: &[u8], filename: &str) -> Result<ParsedLegacyTower, LegacyImportError> {
    let tdt = parse_tdt_binary(bytes)?;

    let mut header_notes: Vec<String> = vec![];
    let star = tdt.header.level.clamp(1, 6);
    if tdt.header.level < 1 || tdt.header.level > 6 {
        header_notes.push(format!(
            "The save's star rating ({}) was out of range and was clamped.",
            tdt.header.level
        ));
    }
    let money = tdt.header.balance * 100;
    let day = tdt.header.current_day.clamp(0, MAX_IMPORT_DAY);
    if tdt.header.current_day < 0 {
        header_notes.push(
            "The save's day counter was negative (a known quirk of the format) and was reset to day 1."
                .into(),
        );
    } else if tdt.header.current_day > MAX_IMPORT_DAY {
        header_notes.push(
            "The save's day counter was impossibly far in the future and was clamped.".into(),
        );
    }
    let frame = tdt.header.frame_time.clamp(0, 2599);
    if tdt.header.frame_time > 2599 {
        header_notes.push(
            "The save's clock was out of range and was reset to the end of the night.".into(),
        );
    }
    let minutes = day * 1440 + minute_of_day_for_frame(frame as f64) as i64;

    let mut counts = ImportCounts::default();
    let width = LOT_WIDTH as usize;
    // Paved tiles per floor, in ascending floor order (the TypeScript map is
    // filled in floor-index order, so insertion order and floor order agree).
    let mut paved: BTreeMap<i64, Vec<u8>> = BTreeMap::new();
    let pave_range = |paved: &mut BTreeMap<i64, Vec<u8>>, floor: i64, left: i64, right: i64| {
        let lo = left.clamp(0, LOT_WIDTH) as usize;
        let hi = right.clamp(0, LOT_WIDTH) as usize;
        if hi <= lo {
            return;
        }
        let row = paved.entry(floor).or_insert_with(|| vec![0; width]);
        for cell in &mut row[lo..hi] {
            *cell = 1;
        }
    };
    let mut room_claimed: HashMap<i64, Vec<u8>> = HashMap::new();
    let claim_room = |claimed: &mut HashMap<i64, Vec<u8>>,
                      kind: Kind,
                      floor: i64,
                      left: i64,
                      right: i64|
     -> bool {
        let stories = kind.floors();
        for f in floor..floor + stories {
            let row = claimed.entry(f).or_insert_with(|| vec![0; width]);
            if row[left as usize..right as usize].iter().any(|&c| c != 0) {
                return false;
            }
        }
        for f in floor..floor + stories {
            let row = claimed.entry(f).or_insert_with(|| vec![0; width]);
            for cell in &mut row[left as usize..right as usize] {
                *cell = 1;
            }
        }
        true
    };
    // Clamp a tenant's extents onto the lot; `None` (counted) for a degenerate
    // or fully off-lot extent.
    let clamp_extent = |counts: &mut ImportCounts, t: &TdtTenant| -> Option<(i64, i64)> {
        let x = t.left;
        let mut right = t.right;
        if right <= x || x >= LOT_WIDTH {
            counts.off_lot += 1;
            return None;
        }
        if right > LOT_WIDTH {
            right = LOT_WIDTH;
            counts.clamped += 1;
        }
        Some((x, right))
    };

    let mut next_id = 1;
    let mut units: Vec<OutUnit> = vec![];
    let mut part_records: Vec<PartRecord> = vec![];
    let push_unit =
        |units: &mut Vec<OutUnit>, counts: &mut ImportCounts, next_id: &mut i64, unit: OutUnit| {
            counts.rooms += 1;
            if unit.width != unit.kind.facility().width {
                counts.width_mismatch += 1;
            }
            if unit.state == "construction" {
                counts.construction += 1;
            }
            *next_id += 1;
            units.push(unit);
        };

    for fl in &tdt.floors {
        let ours = fl.index - TDT_FLOOR_OFFSET;
        if ours > MAX_FLOOR {
            if !fl.tenants.is_empty() || fl.right_edge > fl.left_edge {
                counts.dropped_floors += 1;
            }
            continue;
        }
        pave_range(&mut paved, ours, fl.left_edge, fl.right_edge);
        for t in &fl.tenants {
            let under_construction = t.type_id < 0;
            let type_id = t.type_id.abs();
            if type_id == TDT_FLOOR || type_id == TDT_LOBBY {
                pave_range(&mut paved, ours, t.left, t.right);
                continue;
            }
            if type_id == TDT_BURNED {
                pave_range(&mut paved, ours, t.left, t.right);
                counts.burned += 1;
                continue;
            }
            if type_id == TDT_METRO_TUNNEL {
                pave_range(&mut paved, ours, t.left, t.right);
                continue;
            }
            if let Some(part_kind) = part_family(type_id) {
                let Some((x, right)) = clamp_extent(&mut counts, t) else {
                    continue;
                };
                pave_range(&mut paved, ours, x, right);
                part_records.push(PartRecord {
                    kind: part_kind,
                    type_id,
                    floor: ours,
                    left: x,
                    right,
                    construction: under_construction,
                });
                continue;
            }
            let Some(kind) = tenant_kind(type_id) else {
                counts.unknown += 1;
                continue;
            };
            let Some((x, right)) = clamp_extent(&mut counts, t) else {
                continue;
            };
            if misplaced_on_floor(kind, ours) {
                counts.misplaced += 1;
                continue;
            }
            if !claim_room(&mut room_claimed, kind, ours, x, right) {
                counts.overlapping += 1;
                continue;
            }
            pave_range(&mut paved, ours, x, right);

            let mut state = if under_construction {
                "construction"
            } else {
                "empty"
            };
            let mut ever_occupied = false;
            let mut occupants = 0;
            if !under_construction && (kind == Kind::Office || kind == Kind::Condo) && t.status != 0
            {
                state = "occupied";
                ever_occupied = true;
                occupants = kind.facility().population;
            } else if !under_construction && kind.is_hotel() && t.status != 0 {
                if t.status & HOTEL_INFESTED_FLAG != 0 {
                    state = "dirty";
                    ever_occupied = true;
                    counts.infested += 1;
                    counts.hotel_dirty += 1;
                } else if t.status & HOTEL_DIRTY_FLAG != 0 {
                    state = "dirty";
                    ever_occupied = true;
                    counts.hotel_dirty += 1;
                } else if t.status & HOTEL_ASLEEP_FLAG != 0 {
                    ever_occupied = true;
                    let minute_of_day = ((minutes % 1440) + 1440) % 1440;
                    if (8 * 60..20 * 60).contains(&minute_of_day) {
                        state = "dirty";
                        counts.hotel_dirty += 1;
                        counts.asleep_converted += 1;
                    } else {
                        state = "asleep";
                        occupants = (t.status & HOTEL_OCCUPANT_MASK).max(1);
                        counts.hotel_asleep += 1;
                    }
                } else {
                    ever_occupied = true;
                    counts.hotel_booked += 1;
                }
            } else if !under_construction
                && matches!(kind, Kind::FastFood | Kind::Restaurant | Kind::Shop)
            {
                state = "occupied";
                ever_occupied = true;
            }
            let rent = rent_from_class(kind, t.rent_rate).or_else(|| {
                if t.rent_rate != 4 && is_priced(kind) {
                    rent_from_class(kind, 2)
                } else {
                    None
                }
            });
            if rent.is_some() {
                counts.rents_applied += 1;
            }
            let no_rate = t.rent_rate == 4 && is_priced(kind);
            let subtype = match kind {
                Kind::Shop | Kind::FastFood | Kind::Restaurant => kind
                    .subtype_list()
                    .and_then(|list| usize::try_from(t.variant).ok().and_then(|i| list.get(i)))
                    .copied(),
                _ => None,
            };
            let unit = OutUnit {
                id: next_id,
                kind,
                floor: ours,
                x,
                width: right - x,
                state,
                occupants,
                ever_occupied,
                rent,
                no_rate,
                subtype,
                complete_at: under_construction.then(|| minutes + kind.build_minutes() as i64),
            };
            push_unit(&mut units, &mut counts, &mut next_id, unit);

            if kind == Kind::Office {
                counts.offices += 1;
                if state == "occupied" {
                    counts.occupied_offices += 1;
                }
            } else if kind == Kind::Condo {
                counts.condos += 1;
                if state == "occupied" {
                    counts.sold_condos += 1;
                }
            } else if kind.is_hotel() {
                counts.hotel_rooms += 1;
            } else if matches!(kind, Kind::FastFood | Kind::Restaurant | Kind::Shop) {
                counts.venues += 1;
            } else {
                counts.services += 1;
                if kind == Kind::Parking {
                    counts.parking_stalls += 1;
                }
            }
            if type_id == 4 {
                counts.twin_rooms += 1;
            }
            if type_id == 17 {
                counts.secom += 1;
            }
        }
    }

    for m in merge_parts(&part_records) {
        let floor = if m.kind == Kind::WeddingHall {
            m.top_floor
        } else {
            m.floor
        };
        if floor + m.kind.floors() - 1 > MAX_FLOOR {
            counts.off_lot += 1;
            continue;
        }
        if misplaced_on_floor(m.kind, floor) {
            counts.misplaced += 1;
            continue;
        }
        if !claim_room(&mut room_claimed, m.kind, floor, m.left, m.right) {
            counts.overlapping += 1;
            continue;
        }
        let unit = OutUnit {
            id: next_id,
            kind: m.kind,
            floor,
            x: m.left,
            width: m.right - m.left,
            state: if m.construction {
                "construction"
            } else {
                "empty"
            },
            occupants: 0,
            ever_occupied: false,
            rent: None,
            no_rate: false,
            subtype: None,
            complete_at: m
                .construction
                .then(|| minutes + m.kind.build_minutes() as i64),
        };
        push_unit(&mut units, &mut counts, &mut next_id, unit);
        if m.kind == Kind::Cinema || m.kind == Kind::PartyHall {
            counts.venues += 1;
        } else {
            counts.services += 1;
        }
        if m.kind == Kind::WeddingHall {
            counts.cathedral += 1;
        }
    }

    // The paving pass: width-1 tiles, lobby on lobby floors.
    let mut unit_values: Vec<Value> = units.iter().map(OutUnit::to_json).collect();
    let mut built_extents: BuiltExtents = BTreeMap::new();
    for (&floor, row) in &paved {
        let kind = if is_lobby_floor(floor) {
            Kind::Lobby
        } else {
            Kind::Floor
        };
        let mut left = -1;
        let mut right = -1;
        for (x_tile, &cell) in row.iter().enumerate() {
            if cell == 0 {
                continue;
            }
            if left == -1 {
                left = x_tile as i64;
            }
            right = x_tile as i64 + 1;
            unit_values.push(json!({
                "id": next_id,
                "kind": kind.as_str(),
                "floor": floor,
                "x": x_tile,
                "width": 1,
                "state": "empty",
                "satisfaction": 1,
                "occupants": 0,
                "everOccupied": false,
                "pendingIncome": 0,
                "label": kind.facility().name,
            }));
            next_id += 1;
        }
        if left != -1 {
            built_extents.insert(floor, (left, right));
        }
    }

    let mut excavated: Vec<String> = vec![];
    for (&floor, row) in &paved {
        if floor > 0 {
            continue;
        }
        for (x_tile, &cell) in row.iter().enumerate() {
            if cell != 0 {
                excavated.push(format!("{floor}:{x_tile}"));
            }
        }
    }

    let decoded = tdt.tail.elevators.is_some();
    let mut decode_stats = DecodeStats::default();
    let transports: Vec<OutTransport> = match &tdt.tail.elevators {
        Some(elevators) => {
            let d = transports_from_decoded(
                elevators,
                tdt.tail.stairs.as_deref().unwrap_or(&[]),
                next_id,
            );
            decode_stats = DecodeStats {
                dropped_shafts: d.dropped_shafts,
                adjusted_shafts: d.adjusted_shafts,
                dropped_flights: d.dropped_flights,
            };
            d.transports
        }
        None => {
            let hotel_floors: Vec<i64> = units
                .iter()
                .filter(|u| u.kind.is_hotel())
                .map(|u| u.floor)
                .collect();
            let staff_floors: Vec<i64> = units
                .iter()
                .filter(|u| u.kind == Kind::Housekeeping)
                .map(|u| u.floor)
                .collect();
            synthesize_transports(&built_extents, &hotel_floors, &staff_floors, next_id)
        }
    };
    next_id += transports.len() as i64;

    let tower_name = tower_name_from_filename(filename);
    let has_wedding_hall = units.iter().any(|u| u.kind == Kind::WeddingHall);
    let vip_visit_day = if has_wedding_hall && star < 6 {
        minutes.div_euclid(1440) + 3
    } else {
        -1
    };
    let mut save = Map::new();
    save.insert("version".into(), json!(SAVE_VERSION));
    save.insert("seed".into(), json!(hash_seed(bytes)));
    save.insert("money".into(), json!(money));
    save.insert("star".into(), json!(star));
    save.insert("minutes".into(), json!(minutes));
    save.insert("mode".into(), json!("classic"));
    save.insert("units".into(), Value::Array(unit_values));
    save.insert(
        "transports".into(),
        Value::Array(transports.iter().map(OutTransport::to_json).collect()),
    );
    save.insert("nextId".into(), json!(next_id));
    save.insert("towerName".into(), json!(tower_name));
    save.insert("builtWeddingHall".into(), json!(has_wedding_hall));
    save.insert("evaluatedTower".into(), json!(star >= 6));
    save.insert("vipVisitDay".into(), json!(vip_visit_day));
    save.insert("vipFavorable".into(), json!(star >= 4));
    save.insert("excavated".into(), json!(excavated));
    if let Some((tile, floor)) = view_from_view_words(tdt.header.view_x, tdt.header.view_y) {
        save.insert(
            "view".into(),
            json!({ "tile": jnum(tile), "floor": jnum(floor) }),
        );
    }

    Ok(ParsedLegacyTower {
        save: Value::Object(save),
        warnings: tdt.tail.warnings.clone(),
        counts,
        decode_stats,
        decoded,
        header_notes,
        tower: tdt,
    })
}

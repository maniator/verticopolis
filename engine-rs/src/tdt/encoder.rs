//! The encode pass of the `.TDT` export (`tdtEncoder.ts`): the gathered
//! tower into the binary layout through a `ByteWriter`, plus the transport
//! loss and collision stats the report needs.

use serde_json::Value;

use super::byte_writer::{to_int32, ByteWriter};
use super::export_gather::{js_finite, js_max, js_min, js_num, FloorKey, GatheredTower};
use super::export_parking::connected_stall_count;
use super::export_tables::OutTenant;
use super::format::*;
use super::pacing::frame_for_minute_of_day;
use super::stamp::write_format_stamp;
use super::tables::elevator_type;
use super::LegacyExportError;
use crate::facilities::{Kind, LOT_WIDTH, MAX_FLOOR, MIN_FLOOR};
use crate::jsmath::round;

/// Numbers the report reads from the encode pass (`EncodeStats`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EncodeStats {
    pub balance: i64,
    pub money: f64,
    pub star: i64,
    pub shafts_dropped: i64,
    pub shafts_colliding: i64,
    pub flights_dropped: i64,
    pub transports_dropped: i64,
    pub elevators_len: i64,
    pub walkways_len: i64,
    pub express_len: i64,
}

pub struct EncodeResult {
    pub bytes: Vec<u8>,
    pub stats: EncodeStats,
}

struct OutElevator {
    kind: Kind,
    x: f64,
    bottom: f64,
    top: f64,
    /// `cars` as `Number.isFinite` reads it: `None` for anything that is not
    /// a finite number, which the encoder then writes as one car.
    cars: Option<f64>,
    car_positions: Vec<Value>,
    /// The numbers in `skipFloors`: a `Set` matches a floor by
    /// SameValueZero, so a `null` or a string member can never match one.
    skip_floors: Vec<f64>,
}

struct OutWalkway {
    kind: Kind,
    x: f64,
    bottom: f64,
}

struct StairRecord {
    type_id: i64,
    x: f64,
    floor: f64,
}

struct OutRect {
    x: f64,
    w: f64,
    bottom: f64,
    top: f64,
    walkway: bool,
}

/// `Math.max(lo, Math.min(hi, v))`, NaN propagating.
fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    js_max(lo, js_min(hi, v))
}

/// The record-extent clamp the encoder applies to every tile it writes.
fn clamp_tile(v: Option<f64>) -> f64 {
    match v {
        Some(v) if v.is_finite() => clamp(v, 0.0, LOT_WIDTH as f64),
        _ => 0.0,
    }
}

pub fn encode_tower(
    save: &Value,
    gathered: &GatheredTower,
) -> Result<EncodeResult, LegacyExportError> {
    let GatheredTower {
        tenants_by_tdt,
        extents,
        header,
        has_ground_lobby,
        people_pop,
        counts,
        retail_rows,
        rooms,
    } = gathered;

    for tenants in tenants_by_tdt.values() {
        if tenants.len() as i64 > TDT_MAX_TENANTS_PER_FLOOR {
            return Err(LegacyExportError(
                "One floor holds more rooms than a SimTower (1994) save can carry.".into(),
            ));
        }
    }

    let mut w = ByteWriter::new();

    // `Number.isFinite(save.money)` and its siblings never coerce: a string
    // or a `null` is not a finite number there, so it writes the fallback.
    let money = js_finite(save.get("money")).unwrap_or(0.0);
    let balance = clamp(round(money / 100.0), -2147483648.0, 2147483647.0) as i64;
    let last_quarter_raw = js_finite(save.get("lastQuarterMoney")).unwrap_or(0.0);
    let last_quarter_money =
        clamp(round(last_quarter_raw / 100.0), -2147483648.0, 2147483647.0) as i64;
    let star = match js_finite(save.get("star")) {
        Some(star_raw) => clamp(round(star_raw), 1.0, 6.0) as i64,
        None => 1,
    };
    // `save.minutes % 1440` is arithmetic, so this one does coerce.
    let minutes = js_num(save.get("minutes"));
    let minute_of_day = ((minutes % 1440.0) + 1440.0) % 1440.0;
    w.u16(TDT_MAGIC);
    w.u16(star);
    w.i32(balance);
    w.i32(0);
    w.i32(0);
    w.i32(last_quarter_money);
    w.u16(to_int32(frame_for_minute_of_day(minute_of_day)));
    w.i32(to_int32(js_max(0.0, (minutes / 1440.0).floor())));
    w.pad(TDT_HEADER_SIZE - w.len());

    w.set_u16(0x1c, if *has_ground_lobby { 1 } else { 0 });
    w.set_u16(0x2a, header.recycling.min(0xffff));
    w.set_u16(0x2e, header.commercial.min(512));
    w.set_u16(0x30, header.security.min(10));
    w.set_u16(0x32, counts.parking_stalls.min(512));
    w.set_u16(0x36, header.hall_cinema.min(0xffff));
    // `viewWordsFromView` keeps the default words unless both members are
    // finite numbers (`Number.isFinite`, no coercion).
    let view_words = match save.get("view") {
        Some(view) if js_truthy_value(view) => {
            match (js_finite(view.get("tile")), js_finite(view.get("floor"))) {
                (Some(tile), Some(floor)) => view_words_from_view(tile, floor),
                _ => (TDT_DEFAULT_VIEW_X, TDT_DEFAULT_VIEW_Y),
            }
        }
        _ => (TDT_DEFAULT_VIEW_X, TDT_DEFAULT_VIEW_Y),
    };
    w.set_u16(0x26, view_words.0);
    w.set_u16(0x28, view_words.1);

    let empty: Vec<OutTenant> = vec![];
    for index in 0..TDT_FLOOR_COUNT {
        let ours = index - TDT_FLOOR_OFFSET;
        let tenants = tenants_by_tdt
            .get(&FloorKey::of(index as f64))
            .unwrap_or(&empty);
        let ext = if ours <= MAX_FLOOR {
            extents.get(&FloorKey::of(ours as f64)).copied()
        } else {
            None
        };
        let ext_left = clamp_tile(ext.map(|e| e.0));
        let ext_right = ext_left.max(clamp_tile(ext.map(|e| e.1)));
        w.u16(tenants.len() as i64);
        w.u16(to_int32(ext_left));
        w.u16(to_int32(ext_right));
        let mut ordered: Vec<&OutTenant> = tenants.iter().collect();
        ordered.sort_by(|a, b| {
            clamp_tile(Some(a.left))
                .partial_cmp(&clamp_tile(Some(b.left)))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        for t in ordered {
            let left = clamp_tile(Some(t.left));
            w.u16(to_int32(left));
            w.u16(to_int32(left.max(clamp_tile(Some(t.right)))));
            w.u8(t.type_id);
            w.u8(t.status);
            w.u8(t.subtype_idx.unwrap_or(0));
            w.pad(9);
            w.u8(t.rent_class);
            w.u8(0);
        }
        w.pad(TDT_FLOOR_INDEX_ENTRIES * 2);
    }

    let finite_pop = if people_pop.is_finite() {
        round(*people_pop)
    } else {
        0.0
    };
    let people_count = js_max(0.0, js_min(finite_pop, TDT_MAX_CENSUS)) as i64;
    w.i32(people_count);
    w.pad(people_count as usize * TDT_PERSON_RECORD_SIZE);

    for slot in 0..TDT_RETAIL_SLOTS {
        match retail_rows.get(slot) {
            None => {
                w.u8(0xff);
                w.pad(TDT_RETAIL_RECORD_SIZE - 1);
            }
            Some(&(floor, variant)) => {
                w.u8(to_int32(floor));
                w.u8(0);
                w.u8(variant);
                w.pad(TDT_RETAIL_RECORD_SIZE - 3);
            }
        }
    }

    // Transports, sanitized into elevators and walkways.
    let Some(raw_transports) = save.get("transports").and_then(Value::as_array) else {
        return Err(LegacyExportError("save.transports is not an array".into()));
    };
    let mut elevators: Vec<OutElevator> = vec![];
    let mut walkways: Vec<OutWalkway> = vec![];
    let mut transports_dropped = 0;
    for t in raw_transports {
        let kind = t.get("kind").and_then(Value::as_str).and_then(Kind::parse);
        let width = kind.map(|k| k.facility().width as f64).unwrap_or(0.0);
        // Every coordinate here sits behind a `Number.isFinite` guard in the
        // TypeScript, so a `null` (a NaN that crossed JSON) or a string is
        // simply absent: `x` falls back to 0 and a missing `bottom` or `top`
        // drops the transport.
        let t_x = js_finite(t.get("x")).unwrap_or(0.0);
        let t_bottom = js_finite(t.get("bottom"));
        let t_top = js_finite(t.get("top"));
        if matches!(kind, Some(Kind::Stairs | Kind::Escalator)) {
            let Some(bottom) = t_bottom.map(round) else {
                transports_dropped += 1;
                continue;
            };
            if bottom < MIN_FLOOR as f64 || bottom + 1.0 > MAX_FLOOR as f64 {
                transports_dropped += 1;
                continue;
            }
            let x = clamp(round(t_x), 0.0, LOT_WIDTH as f64 - width);
            walkways.push(OutWalkway {
                kind: kind.expect("matched"),
                x,
                bottom,
            });
            continue;
        }
        let Some(kind) = kind.filter(|k| elevator_type(*k).is_some()) else {
            transports_dropped += 1;
            continue;
        };
        let (Some(t_bottom), Some(t_top)) = (t_bottom, t_top) else {
            transports_dropped += 1;
            continue;
        };
        let bottom = (MIN_FLOOR as f64).max(round(t_bottom));
        let mut top = (MAX_FLOOR as f64).min(round(t_top));
        if top <= bottom {
            transports_dropped += 1;
            continue;
        }
        if top - bottom > kind.max_span() as f64 {
            top = bottom + kind.max_span() as f64;
        }
        let x = clamp(round(t_x), 0.0, LOT_WIDTH as f64 - width);
        elevators.push(OutElevator {
            kind,
            x,
            bottom,
            top,
            cars: js_finite(t.get("cars")),
            car_positions: t
                .get("carPositions")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
            skip_floors: t
                .get("skipFloors")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(|v| js_finite(Some(v))).collect())
                .unwrap_or_default(),
        });
    }
    let shafts_dropped = (elevators.len() as i64 - TDT_ELEVATOR_SLOTS as i64).max(0);
    elevators.truncate(TDT_ELEVATOR_SLOTS);
    elevators.sort_by_key(|e| e.kind == Kind::ElevatorExpress);
    let schedule = tdt_elevator_schedule_default();
    for slot in 0..TDT_ELEVATOR_SLOTS {
        let Some(e) = elevators.get(slot) else {
            w.pad(TDT_ELEVATOR_HEADER_SIZE);
            continue;
        };
        let type_id = elevator_type(e.kind).expect("elevator kind");
        let raw_cars = e.cars.map(round).unwrap_or(1.0);
        let cars = clamp(raw_cars, 1.0, e.kind.max_cars() as f64);
        w.u8(1);
        w.u8(type_id);
        w.u8(e.kind.car_capacity() as i64);
        w.u8(to_int32(cars));
        for &v in &schedule {
            w.u8(v);
        }
        w.u8(1);
        w.u8(0);
        w.u16(to_int32(e.x));
        w.u8(to_int32(e.top + TDT_FLOOR_OFFSET as f64));
        w.u8(to_int32(e.bottom + TDT_FLOOR_OFFSET as f64));
        for fl in 0..TDT_FLOOR_COUNT {
            let ours = (fl - TDT_FLOOR_OFFSET) as f64;
            let stops = ours >= e.bottom
                && ours <= e.top
                && (!e.skip_floors.contains(&ours) || ours == e.bottom || ours == e.top);
            w.u8(if stops { 1 } else { 0 });
        }
        for c in 0..8 {
            let home = js_finite(e.car_positions.get(c))
                .map(round)
                .unwrap_or(e.bottom);
            w.u8(to_int32(
                clamp(home, e.bottom, e.top) + TDT_FLOOR_OFFSET as f64,
            ));
        }
        let size = built_shaft_payload_size(
            e.bottom as i64 + TDT_FLOOR_OFFSET,
            e.top as i64 + TDT_FLOOR_OFFSET,
        )
        .map_err(LegacyExportError)?;
        w.pad(size as usize);
    }

    w.pad(TDT_FINANCE_SIZE);

    let stalls = connected_stall_count(rooms).min(((TDT_PARKING_SIZE - 2) / 2) as i64);
    w.u16(stalls);
    w.pad(TDT_PARKING_SIZE - 2);

    let mut stair_records: Vec<StairRecord> = vec![];
    let mut sorted: Vec<&OutWalkway> = walkways.iter().collect();
    sorted.sort_by(|a, b| {
        a.kind
            .as_str()
            .cmp(b.kind.as_str())
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
            .then(
                a.bottom
                    .partial_cmp(&b.bottom)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    let mut i = 0;
    while i < sorted.len() {
        let first = sorted[i];
        let mut run = 1;
        while i + run < sorted.len()
            && sorted[i + run].kind == first.kind
            && sorted[i + run].x == first.x
            && sorted[i + run].bottom == first.bottom + run as f64
        {
            run += 1;
        }
        let is_stairs = first.kind == Kind::Stairs;
        let mut base = first.bottom;
        let mut left = run as i64;
        while left > 0 {
            let stories = left.min(3);
            let type_id = (stories - 1) * 2 + if is_stairs { 1 } else { 0 };
            stair_records.push(StairRecord {
                type_id,
                x: first.x,
                floor: base + TDT_FLOOR_OFFSET as f64,
            });
            base += stories as f64;
            left -= stories;
        }
        i += run;
    }
    let mut flights_dropped = 0;
    for s in stair_records.iter().skip(TDT_STAIR_SLOTS) {
        flights_dropped += tdt_stair_stories(s.type_id);
    }
    let mut out_rects: Vec<OutRect> = elevators
        .iter()
        .take(TDT_ELEVATOR_SLOTS)
        .map(|e| OutRect {
            x: e.x,
            w: e.kind.facility().width as f64,
            bottom: e.bottom,
            top: e.top,
            walkway: false,
        })
        .collect();
    for s in stair_records.iter().take(TDT_STAIR_SLOTS) {
        let stories = tdt_stair_stories(s.type_id);
        let kind = if s.type_id % 2 == 1 {
            Kind::Stairs
        } else {
            Kind::Escalator
        };
        let bottom = s.floor - TDT_FLOOR_OFFSET as f64;
        out_rects.push(OutRect {
            x: s.x,
            w: kind.facility().width as f64,
            bottom,
            top: bottom + stories as f64,
            walkway: true,
        });
    }
    let mut shafts_colliding = 0;
    let mut surviving: Vec<&OutRect> = vec![];
    for r in &out_rects {
        let clash = surviving.iter().any(|p| {
            r.x < p.x + p.w
                && p.x < r.x + r.w
                && r.bottom <= p.top
                && p.bottom <= r.top
                && !(r.walkway
                    && p.walkway
                    && r.x == p.x
                    && r.w == p.w
                    && (r.bottom == p.top || r.top == p.bottom))
        });
        if clash {
            shafts_colliding += 1;
        } else {
            surviving.push(r);
        }
    }
    for slot in 0..TDT_STAIR_SLOTS {
        let Some(s) = stair_records.get(slot) else {
            w.pad(TDT_STAIR_RECORD_SIZE);
            continue;
        };
        w.u8(1);
        w.u8(s.type_id);
        w.u16(to_int32(s.x));
        w.u16(to_int32(s.floor));
        w.u16(0);
        w.u16(0);
    }

    w.pad_ff(TDT_ROUTING_TAIL_SIZE);
    write_format_stamp(&mut w);

    let express_len = elevators
        .iter()
        .filter(|e| e.kind == Kind::ElevatorExpress)
        .count() as i64;
    Ok(EncodeResult {
        bytes: w.to_bytes(),
        stats: EncodeStats {
            balance,
            money,
            star,
            shafts_dropped,
            shafts_colliding,
            flights_dropped,
            transports_dropped,
            elevators_len: elevators.len() as i64 + shafts_dropped,
            express_len,
            walkways_len: walkways.len() as i64,
        },
    })
}

fn js_truthy_value(v: &Value) -> bool {
    super::export_gather::js_truthy(Some(v))
}

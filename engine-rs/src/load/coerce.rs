//! Coercion of loose saved fields into the types the game holds.

use super::*;

pub(super) fn coerce_log(v: Option<&Value>) -> Vec<LogEntry> {
    let Some(arr) = v.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out: Vec<LogEntry> = Vec::new();
    for e in arr.iter().rev() {
        if out.len() >= LOG_RING_CAP {
            break;
        }
        let Some(o) = e.as_object() else { continue };
        let Some(text) = o.get("text").and_then(Value::as_str) else {
            continue;
        };
        let mut t: Vec<u16> = text.encode_utf16().collect();
        if t.len() > LOG_TEXT_CAP {
            t.truncate(LOG_TEXT_CAP);
        }
        if t.len() == LOG_TEXT_CAP && t.last().is_some_and(|&c| (0xD800..=0xDBFF).contains(&c)) {
            t.pop();
        }
        let text = String::from_utf16_lossy(&t);
        let minute = match finite_num(o.get("minute")) {
            Some(m) => m.max(0.0),
            None => 0.0,
        };
        let kind = match o.get("kind").and_then(Value::as_str) {
            Some("good") => LogKind::Good,
            Some("bad") => LogKind::Bad,
            Some("money") => LogKind::Money,
            _ => LogKind::Info,
        };
        out.push(LogEntry { minute, text, kind });
    }
    out.reverse();
    out
}

pub(super) const VIEW_ZOOM_MIN: f64 = 0.06;
pub(super) const VIEW_ZOOM_MAX: f64 = 3.0;

pub(super) fn coerce_view(v: Option<&Value>) -> Option<Value> {
    let o = v?.as_object()?;
    let tile = finite_num(o.get("tile"))?;
    let floor = finite_num(o.get("floor"))?;
    let mut out = Map::new();
    out.insert("tile".into(), json!(tile.min(LOT as f64).max(0.0)));
    out.insert(
        "floor".into(),
        json!(floor.min(MAX_FLOOR as f64).max(MIN_FLOOR as f64)),
    );
    match o.get("zoom") {
        None | Some(Value::Null) => {}
        Some(z) => {
            let z = finite_num(Some(z))?;
            out.insert(
                "zoom".into(),
                json!(z.min(VIEW_ZOOM_MAX).max(VIEW_ZOOM_MIN)),
            );
        }
    }
    Some(Value::Object(out))
}

pub(super) fn coerce_dirty_days(state: UnitState, kind: Kind, raw: Option<&Value>) -> Option<i64> {
    if state != UnitState::Dirty || !kind.is_hotel() {
        return None;
    }
    let raw = raw?;
    let n = match raw.as_f64() {
        Some(x) if x.is_finite() => x.floor().max(0.0) as i64,
        _ => 0,
    };
    Some(n.min(crate::housekeeping::INFEST_DAYS - 1))
}

pub(super) fn parse_state(v: Option<&Value>) -> Option<UnitState> {
    Some(match v?.as_str()? {
        "construction" => UnitState::Construction,
        "empty" => UnitState::Empty,
        "occupied" => UnitState::Occupied,
        "moving_in" => UnitState::MovingIn,
        "vacating" => UnitState::Vacating,
        "asleep" => UnitState::Asleep,
        "dirty" => UnitState::Dirty,
        "infested" => UnitState::Infested,
        "fire" => UnitState::Fire,
        "gutted" => UnitState::Gutted,
        _ => return None,
    })
}

pub(super) fn vacate_reason(v: Option<&Value>) -> Option<&'static str> {
    Some(match v?.as_str()? {
        "access" => "access",
        "noTransport" => "noTransport",
        "congestion" => "congestion",
        "rent" => "rent",
        "noise" => "noise",
        "transportFar" => "transportFar",
        "lobbyFar" => "lobbyFar",
        "unmetDemand" => "unmetDemand",
        "relocation" => "relocation",
        _ => return None,
    })
}

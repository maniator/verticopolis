//! Coercion of loose saved fields into the types the game holds.

use super::*;
use crate::economy::tickets::NORMAL_TICKET_PRICE;

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

/// A theatre's film age (#1932): a whole number of days, held to a byte as
/// the original keeps it. Any other kind, or a value that is not a finite
/// number, carries none.
pub(super) fn film_days(kind: Kind, raw: Option<&Value>) -> Option<u8> {
    if kind != Kind::Cinema {
        return None;
    }
    let days = raw?.as_f64().filter(|x| x.is_finite())?;
    Some(days.floor().clamp(0.0, f64::from(u8::MAX)) as u8)
}

/// Whether a theatre shows a classic film (#1932): `true` on a theatre, and
/// anything else reads as a new film.
pub(super) fn cinema_flag(kind: Kind, raw: Option<&Value>) -> bool {
    kind == Kind::Cinema && raw == Some(&Value::Bool(true))
}

/// A Modern theater's ticket price step (#1950): a step Modern lists, other
/// than Normal, on a theater. Normal, an unknown step, a Classic save and any
/// other room read as none.
pub(super) fn ticket_price(kind: Kind, modern: bool, raw: Option<&Value>) -> Option<&'static str> {
    if kind != Kind::Cinema || !modern {
        return None;
    }
    let step = GameMode::Modern.ticket_price(raw?.as_str()?)?.key;
    (step != NORMAL_TICKET_PRICE).then_some(step)
}

pub(super) fn parse_state(v: Option<&Value>) -> Option<UnitState> {
    UnitState::from_name(v?.as_str()?)
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
        "trash" => "trash",
        "parking" => "parking",
        "relocation" => "relocation",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The web keeps the same pair in `src/shared/viewZoom.ts` and pins it in
    /// `src/shared/viewZoom.test.ts`. Change all three together.
    #[test]
    fn view_zoom_range_matches_the_web_copy() {
        assert_eq!(VIEW_ZOOM_MIN, 0.06);
        assert_eq!(VIEW_ZOOM_MAX, 3.0);
    }

    fn view(v: Value) -> Option<Value> {
        coerce_view(Some(&v))
    }

    /// A save's camera view crosses the load boundary as written, with or
    /// without a zoom (a TDT import carries none, and a null zoom is absent).
    #[test]
    fn a_view_loads_as_written() {
        let stamped = json!({ "tile": 123.5, "floor": 42.25, "zoom": 1.7 });
        assert_eq!(view(stamped.clone()), Some(stamped));
        let zoomless = json!({ "tile": 10, "floor": 5 });
        assert_eq!(
            view(zoomless.clone()),
            Some(json!({ "tile": 10.0, "floor": 5.0 }))
        );
        assert_eq!(
            view(json!({ "tile": 10, "floor": 5, "zoom": null })),
            Some(json!({ "tile": 10.0, "floor": 5.0 }))
        );
        assert_eq!(
            coerce_view(None),
            None,
            "a save without a view loads viewless"
        );
    }

    /// A malformed view is dropped whole, so the camera falls back to the
    /// tower's center: the wrong container, a missing or non-numeric member,
    /// or a member a JSON writer turned to null (NaN and Infinity).
    #[test]
    fn a_malformed_view_is_dropped_whole() {
        for bad in [
            json!("over there"),
            json!(42),
            json!({}),
            json!({ "tile": "12", "floor": 5 }),
            json!({ "tile": null, "floor": 5 }),
            json!({ "tile": 12, "floor": null }),
            json!({ "tile": 12, "floor": 5, "zoom": "big" }),
        ] {
            assert_eq!(view(bad.clone()), None, "{bad}");
        }
    }

    /// Out-of-range numbers clamp onto the lot, the floor range and the zoom
    /// range (a TDT view word can decode to a floor above the grid).
    #[test]
    fn an_out_of_range_view_clamps() {
        let high = json!({ "tile": 1e9, "floor": -1e9, "zoom": 1e308 });
        assert_eq!(
            view(high),
            Some(json!({ "tile": LOT as f64, "floor": MIN_FLOOR as f64, "zoom": VIEW_ZOOM_MAX }))
        );
        let low = json!({ "tile": -5, "floor": 1e9, "zoom": 0 });
        assert_eq!(
            view(low),
            Some(json!({ "tile": 0.0, "floor": MAX_FLOOR as f64, "zoom": VIEW_ZOOM_MIN }))
        );
    }
}

//! The bomb search in a save: the `bomb` object, written and read back.

use serde_json::{json, Value};

use super::{BombSearch, Guard, Swept, STAIR_MINUTES_PER_FLOOR};

impl BombSearch {
    /// The save's `bomb` object. `searched` keeps the floors with a stretch
    /// swept, so an older engine reads the search; `swept` names each
    /// stretch.
    pub fn save_state(&self) -> Value {
        let mut floors: Vec<i64> = Vec::new();
        for &(f, _) in &self.searched {
            if !floors.contains(&f) {
                floors.push(f);
            }
        }
        json!({
            "floor": self.floor,
            "x": self.x,
            "deadline": self.deadline,
            "guards": self.guards.iter().map(|g| json!({
                "floor": g.floor, "x": g.x, "doneAt": g.done_at, "from": g.from,
                "fromX": g.from_x, "turn": g.turn, "start": g.start, "arrive": g.arrive,
            })).collect::<Vec<_>>(),
            "searched": floors,
            "swept": self.searched.iter().map(|&(f, x)| json!([f, x])).collect::<Vec<_>>(),
            "seq": self.seq,
        })
    }

    /// The save's `bomb` object read back; `None` for anything malformed, so
    /// a damaged save loads without a bomb instead of failing. A save from
    /// before towers were searched one by one has whole floors: its guards
    /// sweep, and its `searched` clears, every stretch of a floor.
    pub fn from_save(v: &Value) -> Option<BombSearch> {
        let o = v.as_object()?;
        let finite = |k: &str| o.get(k).and_then(Value::as_f64).filter(|n| n.is_finite());
        let floor = finite("floor")?.trunc() as i64;
        let x = finite("x")?;
        let deadline = finite("deadline")?;
        let mut guards = Vec::new();
        for g in o.get("guards").and_then(Value::as_array)? {
            guards.push(guard(g.as_object()?)?);
        }
        let mut searched: Vec<Swept> = Vec::new();
        if let Some(swept) = o.get("swept") {
            for s in swept.as_array()? {
                let s = s.as_array()?;
                let f = tile(s.first()?)??;
                searched.push((f, tile(s.get(1)?)?));
            }
        } else {
            for f in o.get("searched").and_then(Value::as_array)? {
                searched.push((tile(f)??, None));
            }
        }
        let seq = (finite("seq").unwrap_or(1.0).trunc() as i64).max(1);
        Some(BombSearch {
            floor,
            x,
            deadline,
            guards,
            searched,
            seq,
        })
    }
}

/// A whole number read from the save: `Some(None)` for `null`, `None` for
/// anything else that is not a finite number.
fn tile(v: &Value) -> Option<Option<i64>> {
    match v {
        Value::Null => Some(None),
        v => Some(Some(v.as_f64().filter(|n| n.is_finite())?.trunc() as i64)),
    }
}

/// One guard read back. Keys an older save does not have take what that
/// save meant: no stretch (the whole floor), no turn, and a climb straight
/// from where it set off.
fn guard(g: &serde_json::Map<String, Value>) -> Option<Guard> {
    let done_at = g
        .get("doneAt")
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite())?;
    let opt = |k: &str| g.get(k).map_or(Some(None), tile);
    let floor = opt("floor")?;
    // A save from before the climb was drawn starts the guard where it
    // already is.
    let num = |k: &str| match g.get(k) {
        None => Some(None),
        Some(v) => v.as_f64().filter(|n| n.is_finite()).map(Some),
    };
    let from = num("from")?.map_or(floor.unwrap_or(0), |n| n.trunc() as i64);
    let start = num("start")?.unwrap_or(done_at);
    let turn = opt("turn")?.unwrap_or(from);
    let climb = floor.map_or(0, |f| (f - turn).abs() + (turn - from).abs());
    let arrive = num("arrive")?.unwrap_or(start + climb as f64 * STAIR_MINUTES_PER_FLOOR);
    Some(Guard {
        floor,
        x: opt("x")?,
        done_at,
        from,
        from_x: opt("fromX")?,
        turn,
        start,
        arrive,
    })
}

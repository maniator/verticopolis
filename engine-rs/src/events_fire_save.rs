//! The answer to a fire in a save: the `fire` object, written while guards
//! or the helicopter are out and read back. A save without one (every save
//! from before #1889, or one made while no fire burns) loads without it; a
//! fire such a save left burning gets its guards on the next step.

use serde_json::{json, Map, Value};

use super::{FireGuard, FireResponse, Helicopter};

impl FireResponse {
    /// The save's `fire` object.
    pub fn save_state(&self) -> Value {
        json!({
            "floor": self.floor,
            "x": self.x,
            "width": self.width,
            "guards": self.guards.iter().map(|g| json!({
                "from": g.from,
                "route": g.route.iter().map(|&(f, x)| json!([f, x])).collect::<Vec<_>>(),
                "left": g.left, "at": g.at, "start": g.start, "arrive": g.arrive,
                "done": g.done, "floors": g.floors,
            })).collect::<Vec<_>>(),
            "helicopter": self.helicopter.as_ref().map(|h| json!({
                "called": h.called, "arrive": h.arrive, "leave": h.leave,
            })),
            "out": self.out,
            "seq": self.seq,
        })
    }

    /// The save's `fire` object read back; `None` for anything malformed,
    /// so a damaged save loads as one with no answer yet (its guards set out
    /// again on the next step) instead of failing.
    pub fn from_save(v: &Value) -> Option<FireResponse> {
        let o = v.as_object()?;
        let mut guards = Vec::new();
        for g in o.get("guards")?.as_array()? {
            guards.push(guard(g.as_object()?)?);
        }
        let helicopter = match o.get("helicopter") {
            None | Some(Value::Null) => None,
            Some(h) => {
                let h = h.as_object()?;
                Some(Helicopter {
                    called: number(h, "called")?,
                    arrive: number(h, "arrive")?,
                    leave: number(h, "leave")?,
                })
            }
        };
        Some(FireResponse {
            floor: whole(o, "floor")?,
            x: whole(o, "x")?,
            width: whole(o, "width")?,
            guards,
            helicopter,
            out: o.get("out")?.as_bool()?,
            seq: whole(o, "seq")?.max(1),
        })
    }
}

/// A finite number under `k`.
fn number(o: &Map<String, Value>, k: &str) -> Option<f64> {
    o.get(k)?.as_f64().filter(|n| n.is_finite())
}

/// A whole number under `k`, cut toward zero. A save is outside input: a
/// value too large for a tile or a floor makes it unreadable, never a wrap.
fn whole(o: &Map<String, Value>, k: &str) -> Option<i64> {
    tile(o.get(k)?)
}

fn tile(v: &Value) -> Option<i64> {
    let n = v.as_f64().filter(|n| n.is_finite() && n.abs() < 1e12)?;
    Some(n.trunc() as i64)
}

/// One guard read back.
fn guard(g: &Map<String, Value>) -> Option<FireGuard> {
    let route = g
        .get("route")?
        .as_array()?
        .iter()
        .map(|p| match p.as_array()?.as_slice() {
            [f, x] => Some((tile(f)?, tile(x)?)),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    Some(FireGuard {
        from: whole(g, "from")?,
        route,
        left: whole(g, "left")?,
        at: whole(g, "at")?,
        start: number(g, "start")?,
        arrive: number(g, "arrive")?,
        done: number(g, "done")?,
        floors: whole(g, "floors")?,
    })
}

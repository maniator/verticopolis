//! No engine write of a room's frame fields or residents gets past the
//! setters in `view/marks.rs`, and the frame and the census read no other
//! field, so a room the setters did not mark has nothing new to send.
use super::marks_tests::served;
use super::source_scan_tests::{
    assigned_value, assigns, closing, engine_sources, field_writes, is_ident, receiver, squeeze,
    Calls,
};
use super::unit_scan_tests::{new_list_aside, top_level, unit_writes};
use super::write_cases_tests::{MORE_WRITES, WRITES};
use crate::frame::unit_fields;
use crate::tower::Unit;

/// The frame fields and the census share read no field but the six the
/// setters mark and the kind, which no engine code writes in place
/// (`no_engine_code_writes_a_kind`). Every other field is bound by name and
/// changed from its own value through its binding, so a new `Unit` field
/// fails to compile here until it is named, and an unused binding fails
/// `cargo clippy --all-targets -- -D warnings` (`engine-rs.yml`), until it is
/// sorted into one side or the other. The pattern's own text is checked
/// below: no `..`, the six and the kind as `_`, every other field written.
#[test]
fn the_frame_and_the_census_read_only_marked_fields() {
    let sim = served();
    for &i in sim.tower.room_index().iter() {
        let u = &sim.tower.units[i];
        let mut v = u.clone();
        let Unit {
            id,
            kind: _,
            floor,
            x,
            width,
            state: _,
            satisfaction,
            occupants: _,
            customers_in: _,
            hotel_customers_in: _,
            out_for_meal: _,
            residents: _,
            ever_occupied,
            pending_income,
            rent,
            no_rate,
            label,
            vacate_reason,
            vacate_at,
            film_policy,
            subtype,
            patronage_today,
            patronage_yest,
            profit_today,
            profit_yest,
            complete_at,
            complete_at_raw,
            dirty_days,
        } = &mut v;
        let other = |s: Option<&'static str>| Some(if s == Some("a") { "b" } else { "a" });
        *id += 1;
        *floor += 1;
        *x += 1;
        *width += 1;
        *satisfaction += 0.5;
        *ever_occupied = !*ever_occupied;
        *pending_income += 9.0;
        *rent = Some(rent.unwrap_or(0.0) + 7.0);
        *no_rate = !*no_rate;
        label.push('x');
        *vacate_reason = other(*vacate_reason);
        *vacate_at = Some(vacate_at.unwrap_or(0.0) + 1.0);
        *film_policy = other(*film_policy);
        *subtype = other(*subtype);
        *patronage_today = Some(patronage_today.unwrap_or(0.0) + 1.0);
        *patronage_yest = Some(patronage_yest.unwrap_or(0.0) + 1.0);
        *profit_today = Some(profit_today.unwrap_or(0.0) + 1.0);
        *profit_yest = Some(profit_yest.unwrap_or(0.0) + 1.0);
        *complete_at = Some(complete_at.unwrap_or(0.0) + 1.0);
        *complete_at_raw = Some(serde_json::json!(format!("{complete_at_raw:?}!")));
        *dirty_days = Some(dirty_days.unwrap_or(0) + 1);
        let bits = |u: &Unit| unit_fields(u).map(f64::to_bits);
        assert_eq!(bits(&v), bits(u), "unit {}", u.id);
        assert_eq!(v.census_share(), u.census_share(), "unit {}", u.id);
    }
    // The pattern names every field, with no `..`; the ones it leaves
    // unchanged (`_`) are exactly the marked ones and the kind; and every
    // other one is written after it, by `*name =` or `name.push`.
    let own = squeeze("x.rs".into(), include_str!("marks_guard_tests.rs")).code;
    let pattern = own.find("let Unit{id,").unwrap() + "let Unit{".len();
    let close = closing(&own, pattern - 1).unwrap();
    let body = &own[close..];
    let mut left = Vec::new();
    for entry in top_level(&own[pattern..close]) {
        assert!(
            entry.chars().all(is_ident) || entry.ends_with(":_"),
            "{entry}"
        );
        match entry.strip_suffix(":_") {
            Some(name) => left.push(name),
            None => assert!(
                body.match_indices(&format!("*{entry}"))
                    .any(|(at, m)| assigns(&body[at + m.len()..]))
                    || body.contains(&format!("{entry}.push(")),
                "{entry} is not written"
            ),
        }
    }
    let mut expected = FIELDS.to_vec();
    expected.push("kind");
    left.sort_unstable();
    expected.sort_unstable();
    assert_eq!(left, expected);
}

/// The fields the setters in `view/marks.rs` write.
const FIELDS: [&str; 6] = [
    "state",
    "occupants",
    "customers_in",
    "hotel_customers_in",
    "out_for_meal",
    "residents",
];

/// The methods that only read a frame field (a `UnitState`, an `i64` or an
/// `Option<i64>`); a call of any other method on one counts as a write.
const READS: [&str; 22] = [
    "as_str",
    "unwrap_or",
    "unwrap_or_default",
    "unwrap_or_else",
    "unwrap",
    "expect",
    "is_some",
    "is_none",
    "is_some_and",
    "is_none_or",
    "map",
    "map_or",
    "filter",
    "max",
    "min",
    "clamp",
    "abs",
    "signum",
    "cmp",
    "partial_cmp",
    "eq",
    "to_string",
];

/// Where `code` (of the file `rel`) writes a room's frame field or residents
/// past the setters, as each write's field and byte offset. A person's
/// `state` (a value that is a `PState`), the RNG's own `state`, and the
/// satisfaction pass's local copy (`let mut probe = u.clone()`) are not a
/// room's, and the loader's list is a new tower's.
fn frame_field_writes(rel: &str, code: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for field in FIELDS {
        let skip = |dot: usize| {
            let value = assigned_value(code, dot + field.len() + 1);
            (field == "state" && value.is_some_and(person_state))
                || (rel == "rng.rs" && field == "state")
                || (rel == "satisfaction.rs" && local_copy(code, dot, "probe"))
        };
        for at in field_writes(code, field, &Calls::Reading(&READS), &skip) {
            out.push((field.to_string(), at));
        }
    }
    for at in new_list_aside(rel, code, unit_writes(code, &FIELDS)) {
        out.push(("unit".to_string(), at));
    }
    out
}

/// Whether the field at `dot` belongs to `name`, a local the same function
/// copied from a unit (`let mut probe = u.clone();`), so a write to it
/// reaches no room.
fn local_copy(code: &str, dot: usize, name: &str) -> bool {
    let binding = format!("let mut {name}=");
    receiver(code, dot) == name
        && code[..dot].rfind(&binding).is_some_and(|at| {
            let value = &code[at + binding.len()..dot];
            value.find(';').is_some_and(|end| {
                let copy = &value[..end];
                copy.ends_with(".clone()") && !copy.contains(['{', '}'])
            })
        })
}

/// Whether `value` is a person's state: a `PState` variant (on any path,
/// with or without fields), or an `if` or a `match` that ends at its last
/// block and gives one in every branch. A room's state is a `UnitState`, so
/// the value's type tells the two apart where the receiver's name cannot. A
/// person's state assigned from a variable or a call counts as a room's.
fn person_state(value: &str) -> bool {
    variant(value) || branches(value).is_some_and(|b| b.iter().all(|v| person_state(v)))
}

/// Whether `v` is a `PState` variant, `PState::Done`, `person::PState::
/// Riding { car }` or `PState::Walking(n)`.
fn variant(v: &str) -> bool {
    let Some(at) = v.find("PState::") else {
        return false;
    };
    let path = &v[..at];
    let path_ok = path.is_empty()
        || path.ends_with("::") && path.split("::").all(|s| s.chars().all(is_ident));
    let rest = &v[at + "PState::".len()..];
    let name = rest.len() - rest.trim_start_matches(is_ident).len();
    let fields = &rest[name..];
    path_ok
        && name > 0
        && (fields.is_empty()
            || fields.starts_with(['(', '{']) && closing(fields, 0) == Some(fields.len() - 1))
}

/// The values of an `if` (`if c{a}else if d{b}else{c}`) or a `match`
/// (`match x{A=>a,B=>{b}}`) that ends at its last block, or `None` for any
/// other value.
fn branches(value: &str) -> Option<Vec<&str>> {
    let close = value
        .len()
        .checked_sub(1)
        .filter(|_| value.ends_with('}'))?;
    let keyword = |word: &str| {
        value
            .strip_prefix(word)
            .is_some_and(|rest| !rest.starts_with(is_ident))
    };
    if keyword("match") {
        let open = value.find('{')?;
        (closing(value, open) == Some(close)).then_some(())?;
        let mut out = Vec::new();
        for arm in top_level(&value[open + 1..close])
            .into_iter()
            .filter(|a| !a.is_empty())
        {
            let (_, v) = arm.split_once("=>")?;
            out.push(
                v.strip_prefix('{')
                    .and_then(|v| v.strip_suffix('}'))
                    .unwrap_or(v),
            );
        }
        return Some(out);
    }
    if !keyword("if") {
        return None;
    }
    let mut out = Vec::new();
    let mut i = 0;
    // An `if` without a final `else` gives `()`.
    let mut last_else = false;
    loop {
        let open = i + value[i..].find('{')?;
        let end = closing(value, open)?;
        out.push(&value[open + 1..end]);
        if end == close {
            return last_else.then_some(out);
        }
        let rest = value[end + 1..].strip_prefix("else")?;
        last_else = rest.starts_with('{');
        let next_if = rest
            .strip_prefix(" if")
            .is_some_and(|r| !r.starts_with(is_ident));
        if !last_else && !next_if {
            return None;
        }
        i = value.len() - rest.len();
    }
}

/// The setters in `view/marks.rs` are the only engine writes of a room's
/// frame fields and residents, a new unit's struct literal aside: a write
/// anywhere else would leave the room unmarked, and a frame reader would
/// keep showing its old value. The loaders (`load.rs`, `tdt/`) are scanned
/// like any other file, with one exemption: `load.rs` fills a new tower's
/// list (`the_loader_fills_only_a_new_tower`). `save_delta.rs` lends the
/// list out and puts it straight back, which is no write (`lent`).
#[test]
fn only_the_setters_write_the_frame_fields() {
    let mut writers = Vec::new();
    for source in engine_sources() {
        for (field, at) in frame_field_writes(&source.rel, &source.code) {
            writers.push(format!("{}:{} {field}", source.rel, source.line(at)));
        }
    }
    let room = |rel: &str, line: &str| {
        let code = squeeze(rel.into(), line).code;
        !frame_field_writes(rel, &code).is_empty()
    };
    for (line, writes) in WRITES.iter().chain(MORE_WRITES) {
        assert_eq!(room("x.rs", line), *writes, "{line}");
    }
    // A person's state is told by its value, in the crowd's files too.
    for line in [
        "p.state = s;",
        "p.state = if go { a } else { b };",
        "self.tower.units[self.people[k].home].state = UnitState::Occupied;",
    ] {
        assert!(room("crowd/motion.rs", line), "{line}");
    }
    assert!(!room("crowd/motion.rs", "p.state = PState::Riding;"));
    assert!(!room("rng.rs", "self.state = next;"), "the RNG");
    let copy = "let mut probe = u.clone(); probe.residents = None;";
    assert!(!room("satisfaction.rs", copy), "the local copy");
    assert!(room("satisfaction.rs", "probe.residents = None;"));
    assert!(room(
        "satisfaction.rs",
        "let mut probe = &mut self.units[i]; probe.residents = None;"
    ));
    assert!(
        !room("load.rs", "sim.tower.units = units;"),
        "the new tower"
    );
    assert!(room("load.rs", "self.tower.units = rebuilt;"));
    assert!(room("x.rs", "sim.tower.units = units;"));
    assert!(
        writers.iter().all(|w| w.starts_with("view/marks.rs:")),
        "{writers:?}"
    );
    assert_eq!(writers.len(), 6, "{writers:?}");
}

/// `load.rs`'s one fill of a unit list, one of the list half's two
/// exemptions, is of the tower `assemble` (the rest of `deserialize` and of
/// the streamed reader) has just made with `Simulation::new`, whose mark log
/// is new. The other, a list lent out and put back, is pinned by its cases.
#[test]
fn the_loader_fills_only_a_new_tower() {
    let sources = engine_sources();
    let load = sources.iter().find(|s| s.rel == "load.rs").unwrap();
    let fills: Vec<usize> = load
        .code
        .match_indices("sim.tower.units=units;")
        .map(|(at, _)| at)
        .collect();
    assert_eq!(fills.len(), 1, "{fills:?}");
    let body = &load.code[load.code[..fills[0]].rfind("fn ").unwrap()..fills[0]];
    assert!(body.starts_with("fn assemble("), "{}", &body[..40]);
    assert_eq!(body.matches("let mut sim=").count(), 1);
    assert!(body.contains("let mut sim=Simulation::new("));
    // Only that statement: another receiver or list, or another file, counts.
    let flagged = |rel: &str, line: &str| {
        let code = squeeze(rel.into(), line).code;
        !new_list_aside(rel, &code, unit_writes(&code, &[])).is_empty()
    };
    assert!(!flagged("load.rs", "sim.tower.units = units;"));
    assert!(flagged("load.rs", "self.tower.units = units;"));
    assert!(flagged("load.rs", "sim.tower.units = rebuilt;"));
    assert!(flagged("x.rs", "sim.tower.units = units;"));
    // A list lent out and put straight back (`save_delta.rs`), in any file:
    // the take, what comes between, the return, and whether it is flagged.
    const TAKE: &str = "let units = std::mem::take(&mut sim.tower.units);";
    const BACK: &str = "sim.tower.units = units;";
    for (take, between, back, writes) in [
        (TAKE, "let rest = sim.serialize();", BACK, false),
        (
            "let units = mem::take(&mut sim.tower.units);",
            "",
            BACK,
            false,
        ),
        (
            "let mut units = mem::take(&mut sim.tower.units);",
            "",
            BACK,
            true,
        ),
        (TAKE, "let units = sorted(units);", BACK, true),
        (TAKE, "drop(units);", BACK, true),
        (TAKE, "sim.tower.units.push(u);", BACK, true),
        (TAKE, "} fn g() {", BACK, true),
        (TAKE, "", "", true),
        (TAKE, "", "old_sim.tower.units = units;", true),
        (TAKE, "", "sim.tower.units = other;", true),
        (
            "let units = std::mem::take(&mut sims[i].tower.units);",
            "i += 1;",
            "sims[i].tower.units = units;",
            true,
        ),
    ] {
        let body = format!("fn f() {{ {take} {between} {back} }}");
        assert_eq!(flagged("x.rs", &body), writes, "{body}");
    }
}

/// No engine code writes a unit's kind in place (nor any other `kind`, so
/// the scan needs no exemption): a unit's kind is set when it is built, and
/// changes only by a removal and a new unit, which move the revision and
/// send a full frame. `Kind` is `Copy` and its own methods take `self`, so
/// only `clone_from` and the operator traits' `*_assign` can write one
/// through a method.
#[test]
fn no_engine_code_writes_a_kind() {
    const KIND: Calls = Calls::Writing(&["clone_from"]);
    let kind_writes = |rel: &str, code: &str| {
        let mut found = field_writes(code, "kind", &KIND, &|_| false);
        found.extend(new_list_aside(rel, code, unit_writes(code, &["kind"])));
        found
    };
    let mut writers = Vec::new();
    for source in engine_sources() {
        for at in kind_writes(&source.rel, &source.code) {
            writers.push(format!("{}:{}", source.rel, source.line(at)));
        }
        if source.rel == "facilities.rs" {
            let code = &source.code;
            let impls = code.match_indices("impl Kind{").collect::<Vec<_>>();
            assert!(!impls.is_empty());
            for (at, m) in impls {
                let close = closing(code, at + m.len() - 1).unwrap();
                assert!(!code[at..close].contains("&mut self"), "Kind's own methods");
            }
        }
    }
    for (line, writes) in [
        ("u.kind = Kind::Office;", true),
        ("let k = &mut u.kind;", true),
        ("u.kind.clone_from(&k);", true),
        ("u.kind.add_assign(k);", true),
        ("let Unit { kind, .. } = u; *kind = x;", true),
        ("let Unit { kind: k, .. } = u; *k = x;", true),
        ("*u = Unit { kind: k, ..base };", true),
        ("u.kind == Kind::Office", false),
        ("u.kind.is_hotel()", false),
        ("let f = u.kind.facility();", false),
    ] {
        let code = squeeze("x.rs".into(), line).code;
        assert_eq!(!kind_writes("x.rs", &code).is_empty(), writes, "{line}");
    }
    assert!(writers.is_empty(), "{writers:?}");
}

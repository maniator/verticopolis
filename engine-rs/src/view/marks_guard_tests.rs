//! No engine write of a room's frame fields or residents gets past the
//! setters in `view/marks.rs`, and the frame and the census read no other
//! field, so a room the setters did not mark has nothing new to send.
use super::marks_tests::served;
use super::source_scan_tests::{
    assigned_value, blocks, closing, engine_sources, field_writes, is_ident, receiver, squeeze,
};
use super::unit_scan_tests::{new_list_aside, unit_writes};
use crate::frame::unit_fields;
use crate::tower::Unit;

/// The frame fields and the census share read no field but the six the
/// setters mark and the kind, which no engine code writes in place
/// (`no_engine_code_writes_a_kind`). Every other field is bound by name and
/// changed through its binding, so a new `Unit` field fails to compile here
/// until it is named, and an unused binding fails clippy, until it is
/// sorted into one side or the other.
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
        *vacate_reason = Some("probe");
        *vacate_at = Some(1.0);
        *film_policy = Some("probe");
        *subtype = Some("probe");
        *patronage_today = Some(3.0);
        *patronage_yest = Some(3.0);
        *profit_today = Some(3.0);
        *profit_yest = Some(3.0);
        *complete_at = Some(5.0);
        *complete_at_raw = Some(serde_json::json!("probe"));
        *dirty_days = Some(4);
        let bits = |u: &Unit| unit_fields(u).map(f64::to_bits);
        assert_eq!(bits(&v), bits(u), "unit {}", u.id);
        assert_eq!(v.census_share(), u.census_share(), "unit {}", u.id);
    }
    // The fields left unchanged above are exactly the marked ones and the
    // kind.
    let own = squeeze("x.rs".into(), include_str!("marks_guard_tests.rs")).code;
    let pattern = own.find("letUnit{id,").unwrap() + "letUnit{".len();
    let inside = &own[pattern..closing(&own, pattern - 1).unwrap()];
    let mut left: Vec<&str> = inside
        .split(',')
        .filter_map(|entry| entry.strip_suffix(":_"))
        .collect();
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

/// The mutating methods of an optional counter.
const METHODS: [&str; 9] = [
    "take(",
    "replace(",
    "insert(",
    "get_or_insert",
    "as_mut",
    "as_deref_mut(",
    "iter_mut(",
    "take_if(",
    "clone_from(",
];

/// Where `src` writes a room's frame field or residents past the setters,
/// as `field@line`: a person's `state` (a value that is a `PState`), the
/// RNG's own `state`, and the satisfaction pass's local `probe` copy are
/// not a room's, and the loader's list is a new tower's.
fn frame_field_writes(rel: &str, code: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for field in FIELDS {
        let skip = |dot: usize| {
            let value = assigned_value(code, dot + field.len() + 1);
            (field == "state" && value.is_some_and(person_state))
                || (rel == "rng.rs" && field == "state")
                || (rel == "satisfaction.rs" && receiver(code, dot) == "probe")
        };
        for at in field_writes(code, field, &METHODS, &skip) {
            out.push((field.to_string(), at));
        }
    }
    for at in new_list_aside(rel, code, unit_writes(code, &FIELDS)) {
        out.push(("unit".to_string(), at));
    }
    out
}

/// Whether `value` is a person's state: a `PState` variant, or an `if`
/// whose every branch is one. A room's state is a `UnitState`, so the
/// value's type tells the two apart where the receiver's name cannot.
fn person_state(value: &str) -> bool {
    let variant = |v: &str| {
        v.strip_prefix("PState::")
            .is_some_and(|name| !name.is_empty() && name.chars().all(is_ident))
    };
    let branches = blocks(value);
    variant(value)
        || value.starts_with("if") && !branches.is_empty() && branches.iter().all(|b| variant(b))
}

/// The setters in `view/marks.rs` are the only engine writes of a room's
/// frame fields and residents, a new unit's struct literal aside: a write
/// anywhere else would leave the room unmarked, and a frame reader would
/// keep showing its old value. The loaders (`load.rs`, `tdt/`) are scanned
/// like any other file: they build units from struct literals and write no
/// field after.
#[test]
fn only_the_setters_write_the_frame_fields() {
    let mut writers = Vec::new();
    for source in engine_sources() {
        for (field, at) in frame_field_writes(&source.rel, &source.code) {
            writers.push(format!("{}:{} {field}", source.rel, source.line(at)));
        }
    }
    for (line, writes) in [
        ("u.state = UnitState::Empty;", true),
        ("u.occupants=0;", true),
        ("u.occupants += 1;", true),
        ("u.occupants *= 2;", true),
        ("u.occupants <<= 1;", true),
        ("venue.customers_in = Some(n - 1);", true),
        ("v.hotel_customers_in.take()", true),
        ("o.out_for_meal.as_mut()", true),
        ("o.out_for_meal.iter_mut().for_each(|n| *n -= 1)", true),
        ("u.residents = None;", true),
        ("sim.tower.units[i].state = UnitState::Occupied;", true),
        (
            "self.tower.units[self.people[k].home].state = UnitState::Occupied;",
            true,
        ),
        ("let n = &mut u.occupants;", true),
        ("let n = &mut self.units[pos(id, 2)].occupants;", true),
        ("if let Some(n) = &mut u.customers_in { *n -= 1 }", true),
        ("match &mut u.state { s => *s = x }", true),
        ("if let Some(ref mut c) = u.customers_in { *c += 1 }", true),
        (
            "match u.residents { Some(ref mut r) => *r = 0, None => {} }",
            true,
        ),
        ("std::mem::replace(&mut u.customers_in, None)", true),
        (
            "let n = &mut self\n    .tower\n    .units[i]\n    .occupants;",
            true,
        ),
        ("(u.occupants, u.state) = (0, x);", true),
        ("((n, u.residents), m) = ((1, None), 2);", true),
        ("let Unit { occupants, .. } = u; *occupants = 0;", true),
        ("let Unit { occupants: n, .. } = u; *n = 0;", true),
        (
            "if let Unit { customers_in: Some(n), .. } = u { *n = 0 }",
            true,
        ),
        ("match u { Unit { state, .. } => *state = x }", true),
        (
            "units.iter_mut().for_each(|Unit { occupants, .. }| *occupants = 0)",
            true,
        ),
        ("for Unit { residents, .. } in units.iter_mut() {}", true),
        ("self.tower.units[i] = fresh;", true),
        ("self.units[i].clone_from(&fresh);", true),
        ("self.units.swap(a, b);", true),
        ("self.tower.units.sort_by_key(|u| u.x);", true),
        ("self.units.reverse();", true),
        ("let (a, b) = self.units.split_at_mut(i);", true),
        ("self.tower.units = rebuilt;", true),
        ("*u = Unit::default();", true),
        ("let Some(n) = &mut u.customers_in else { return };", true),
        (
            "let Some(ref mut n) = u.customers_in else { return };",
            true,
        ),
        ("for n in [&mut u.occupants] { *n = 0 }", true),
        ("let p = &mut u.occupants as *mut i64;", true),
        ("let p = &raw mut u.occupants;", true),
        ("(u.occupants) = 0;", true),
        ("u.customers_in.as_mut_slice()[0] = 1;", true),
        ("*u = Unit { state: x, ..u.clone() };", true),
        ("Some(u) => *u = Unit { state: x, ..base },", true),
        ("std::mem::swap(&mut self.units[a], &mut spare);", true),
        ("std::mem::take(&mut self.units[pos(a, b)])", true),
        (
            "u.state = if p.state == PState::Done { a } else { b };",
            true,
        ),
        ("p.state = if go { a } else { b };", true),
        ("u.state == UnitState::Empty", false),
        ("u.occupants <= 3", false),
        ("let n = u.occupants;", false),
        ("let s = u.states;", false),
        ("let s = \"u.state = x\";", false),
        ("// u.state = x", false),
        ("/* u.state = x */", false),
        ("p.state = PState::Riding;", false),
        ("crowd.people[i].state = PState::Done;", false),
        (
            "p.state = if go { PState::Walking } else { PState::Done };",
            false,
        ),
        (
            "self.units.push(Unit { state: UnitState::Empty, occupants: 0 });",
            false,
        ),
        (
            "match u { Unit { state: UnitState::Fire, .. } => 1, _ => 0 }",
            false,
        ),
        ("if let Unit { occupants: 0, .. } = u {}", false),
        ("impl From<Unit> for Unit {}", false),
        ("hk_units[i] = 3;", false),
        ("units.sort_by_key(|&i| rooms[i].x0);", false),
        ("let n = self.units.len();", false),
        ("let s = StaffUnit { occupants: 0 };", false),
    ] {
        let code = squeeze("x.rs".into(), &line.replace("\\n", "\n")).code;
        let found = frame_field_writes("x.rs", &code);
        assert_eq!(!found.is_empty(), writes, "{line}: {found:?}");
    }
    let rng = squeeze("rng.rs".into(), "self.state = next;").code;
    assert!(frame_field_writes("rng.rs", &rng).is_empty(), "the RNG");
    let probe = squeeze("satisfaction.rs".into(), "probe.residents = None;").code;
    assert!(
        frame_field_writes("satisfaction.rs", &probe).is_empty(),
        "the local probe"
    );
    assert!(
        writers.iter().all(|w| w.starts_with("view/marks.rs:")),
        "{writers:?}"
    );
    assert_eq!(writers.len(), 6, "{writers:?}");
}

/// No engine code writes a unit's kind in place (nor any other `kind`, so
/// the scan needs no exemption): a unit changes kind only by being replaced,
/// which moves the revision and sends a full frame.
#[test]
fn no_engine_code_writes_a_kind() {
    let mut writers = Vec::new();
    for source in engine_sources() {
        let mut found = field_writes(&source.code, "kind", &[], &|_| false);
        let units = unit_writes(&source.code, &["kind"]);
        found.extend(new_list_aside(&source.rel, &source.code, units));
        for at in found {
            writers.push(format!("{}:{}", source.rel, source.line(at)));
        }
    }
    for (line, writes) in [
        ("u.kind = Kind::Office;", true),
        ("let k = &mut u.kind;", true),
        ("let Unit { kind, .. } = u; *kind = x;", true),
        ("let Unit { kind: k, .. } = u; *k = x;", true),
        ("u.kind == Kind::Office", false),
    ] {
        let code = squeeze("x.rs".into(), line).code;
        let mut found = field_writes(&code, "kind", &[], &|_| false);
        found.extend(unit_writes(&code, &["kind"]));
        assert_eq!(!found.is_empty(), writes, "{line}");
    }
    assert!(writers.is_empty(), "{writers:?}");
}

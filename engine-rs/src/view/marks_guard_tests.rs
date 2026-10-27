//! No engine write of a room's frame fields or residents gets past the
//! setters in `view/marks.rs`, and the frame and the census read no other
//! field, so a room the setters did not mark has nothing new to send.
use super::marks_tests::served;
use super::source_scan_tests::{engine_sources, field_writes, receiver, squeeze, unit_writes};
use crate::frame::unit_fields;
use crate::tower::Unit;

/// The frame fields and the census share read no field but the six the
/// setters mark (and the kind, which moves only with the revision).
/// Destructuring every field makes a new `Unit` field fail to compile here
/// until it is sorted into one side or the other.
#[test]
fn the_frame_and_the_census_read_only_marked_fields() {
    let sim = served();
    for &i in sim.tower.room_index().iter() {
        let u = &sim.tower.units[i];
        let Unit {
            id: _,
            kind: _,
            floor: _,
            x: _,
            width: _,
            state: _,
            satisfaction: _,
            occupants: _,
            customers_in: _,
            hotel_customers_in: _,
            out_for_meal: _,
            residents: _,
            ever_occupied: _,
            pending_income: _,
            rent: _,
            no_rate: _,
            label: _,
            vacate_reason: _,
            vacate_at: _,
            film_policy: _,
            subtype: _,
            patronage_today: _,
            patronage_yest: _,
            profit_today: _,
            profit_yest: _,
            complete_at: _,
            complete_at_raw: _,
            dirty_days: _,
        } = u;
        let mut v = u.clone();
        v.id += 1;
        v.floor += 1;
        v.x += 1;
        v.width += 1;
        v.satisfaction += 0.5;
        v.ever_occupied = !v.ever_occupied;
        v.pending_income += 9.0;
        v.rent = Some(v.rent.unwrap_or(0.0) + 7.0);
        v.no_rate = !v.no_rate;
        v.label.push('x');
        v.vacate_reason = Some("probe");
        v.vacate_at = Some(1.0);
        v.film_policy = Some("probe");
        v.subtype = Some("probe");
        v.patronage_today = Some(3.0);
        v.patronage_yest = Some(3.0);
        v.profit_today = Some(3.0);
        v.profit_yest = Some(3.0);
        v.complete_at = Some(5.0);
        v.complete_at_raw = Some(serde_json::json!("probe"));
        v.dirty_days = Some(4);
        let bits = |u: &Unit| unit_fields(u).map(f64::to_bits);
        assert_eq!(bits(&v), bits(u), "unit {}", u.id);
        assert_eq!(v.census_share(), u.census_share(), "unit {}", u.id);
    }
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
    "as_mut(",
    "as_deref_mut(",
    "iter_mut(",
    "take_if(",
    "clone_from(",
];

/// Where `src` writes a room's frame field or residents past the setters,
/// as `field@line`: a person's `state` (a `PState`, or the crowd's `p` and
/// `people[..]`), the RNG's own `state`, and the satisfaction pass's local
/// `probe` copy are not a room's.
fn frame_field_writes(rel: &str, code: &str) -> Vec<(String, usize)> {
    let mut out = Vec::new();
    for field in FIELDS {
        let skip = |dot: usize| {
            let rest = &code[dot + field.len() + 1..];
            let on = receiver(code, dot);
            let person = field == "state"
                && (rest.starts_with("=PState::")
                    || rel.starts_with("crowd/") && (on == "p" || on.contains("people[")));
            person
                || (rel == "rng.rs" && field == "state")
                || (rel == "satisfaction.rs" && on == "probe")
        };
        for at in field_writes(code, field, &METHODS, &skip) {
            out.push((field.to_string(), at));
        }
    }
    for at in unit_writes(code, &FIELDS) {
        out.push(("unit".to_string(), at));
    }
    out
}

/// The setters in `view/marks.rs` are the only engine writes of a room's
/// frame fields and residents, a new unit's struct literal aside: a write
/// anywhere else would leave the room unmarked, and a frame reader would
/// keep showing its old value. The loaders (`load.rs`, `tdt/`) are scanned
/// too: they build a tower from struct literals and write no field after.
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
        ("let n = &mut u.occupants;", true),
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
        ("let Unit { occupants, .. } = u; *occupants = 0;", true),
        ("self.tower.units[i] = fresh;", true),
        ("*u = Unit { state: x, ..u.clone() };", true),
        ("std::mem::swap(&mut self.units[a], &mut spare);", true),
        (
            "u.state = if p.state == PState::Done { a } else { b };",
            true,
        ),
        ("u.state == UnitState::Empty", false),
        ("u.occupants <= 3", false),
        ("let n = u.occupants;", false),
        ("let s = u.states;", false),
        ("p.state = PState::Riding;", false),
        ("crowd.people[i].state = PState::Done;", false),
        (
            "self.units.push(Unit { state: UnitState::Empty, occupants: 0 });",
            false,
        ),
        ("hk_units[i] = 3;", false),
    ] {
        let code = squeeze("x.rs".into(), &line.replace("\\n", "\n")).code;
        let found = frame_field_writes("x.rs", &code);
        assert_eq!(!found.is_empty(), writes, "{line}: {found:?}");
    }
    let crowd = squeeze(
        "crowd/motion.rs".into(),
        "p.state = if go { a } else { b };",
    )
    .code;
    assert!(
        frame_field_writes("crowd/motion.rs", &crowd).is_empty(),
        "a person in the crowd"
    );
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

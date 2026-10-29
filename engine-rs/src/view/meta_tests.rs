//! Tests for `meta.rs`: the setters move the meta revision exactly when a
//! value changes, `meta_since` answers from the log or with a full
//! listing, and every engine write of a label or subtype goes through the
//! setters.
use serde_json::{json, Value};

use super::meta::{FIRST_META_REVISION, LOG_CAP};
use super::session_tests::at;
use super::source_scan_tests::{engine_sources, field_writes, squeeze, Calls};
use super::unit_scan_tests::{new_list_aside, unit_writes};
use super::*;
use crate::facilities::Kind;
use crate::tower::Tower;

fn tower() -> Tower {
    at("events-classic", "built").tower
}

fn room(tower: &Tower, k: usize) -> i64 {
    tower.units[tower.room_index()[k]].id
}

fn ids(doc: &Value) -> Vec<i64> {
    doc["units"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r[0].as_i64().unwrap())
        .collect()
}

#[test]
fn a_setter_bumps_the_revision_only_on_a_change() {
    let mut t = tower();
    let i = t.room_index()[0];
    let id = t.units[i].id;
    let (rev, revision) = (t.meta_revision, t.revision);
    assert!(!t.set_unit_subtype(-5, Some("Shop")), "unknown id");
    let same = t.units[i].label.clone();
    assert!(!t.set_unit_label_at(i, same));
    let subtype = t.units[i].subtype;
    assert!(!t.set_unit_subtype(id, subtype));
    assert_eq!(t.meta_revision, rev);
    assert!(t.set_unit_label_at(i, "Acme".into()));
    assert_eq!(
        (t.meta_revision, t.get_unit(id).unwrap().label.as_str()),
        (rev + 1, "Acme")
    );
    assert!(t.set_unit_subtype(id, Some("Acme Goods")));
    assert!(t.set_unit_subtype(id, None));
    assert_eq!(t.meta_revision, rev + 3);
    assert_eq!(
        t.revision, revision,
        "metadata never moves the tower revision"
    );
}

/// The editor's rename trims as JavaScript does and falls back to the
/// catalog name; it answers true for any known id, a rename to the same
/// name included, which leaves the revision alone.
#[test]
fn a_rename_trims_and_falls_back_to_the_catalog_name() {
    let mut t = tower();
    let id = room(&t, 2);
    let name = t.get_unit(id).unwrap().kind.facility().name;
    assert!(!t.set_label(-1, "x"));
    assert!(t.set_label(id, "  Blue Room\u{a0}"));
    assert_eq!(t.get_unit(id).unwrap().label, "Blue Room");
    let rev = t.meta_revision;
    assert!(t.set_label(id, "Blue Room "));
    assert_eq!(t.meta_revision, rev);
    assert!(t.set_label(id, " \t "));
    assert_eq!(t.get_unit(id).unwrap().label, name);
    assert_eq!(t.meta_revision, rev + 1);
}

/// A full listing names every unit with a subtype or a label that is not
/// its catalog name, in unit-list order, and nothing else.
#[test]
fn a_full_listing_names_the_units_off_their_defaults() {
    let mut t = tower();
    let id = room(&t, 1);
    t.set_label(id, "Corner Office");
    let doc = meta_since(&t, None);
    assert_eq!(doc["full"], true);
    assert_eq!(doc["revision"], t.meta_revision);
    let want: Vec<i64> = t
        .units
        .iter()
        .filter(|u| u.subtype.is_some() || u.label != u.kind.facility().name)
        .map(|u| u.id)
        .collect();
    assert!(want.contains(&id) && want.len() > 1, "{want:?}");
    assert_eq!(ids(&doc), want);
    for r in doc["units"].as_array().unwrap() {
        let u = t.get_unit(r[0].as_i64().unwrap()).unwrap();
        assert_eq!(r[1], u.label.as_str());
        assert_eq!(r[2], json!(u.subtype));
    }
}

/// An incremental read lists the units changed after `since`, each once,
/// oldest change first, with their values now; a unit removed since is
/// left out. Reading at the current revision lists nothing.
#[test]
fn an_incremental_read_lists_the_changed_units_once() {
    let mut t = tower();
    let (a, b, c) = (room(&t, 0), room(&t, 1), room(&t, 2));
    let since = t.meta_revision;
    t.set_label(b, "One");
    t.set_label(a, "Two");
    t.set_label(b, "Three");
    t.set_label(c, "Four");
    t.remove_unit(c).unwrap();
    let doc = meta_since(&t, Some(since));
    assert_eq!(doc["full"], false);
    assert_eq!(ids(&doc), [b, a]);
    assert_eq!(doc["units"][0][1], "Three");
    let now = meta_since(&t, Some(t.meta_revision));
    assert_eq!((now["full"].clone(), ids(&now)), (json!(false), vec![]));
    let mid = meta_since(&t, Some(since + 2));
    assert_eq!(ids(&mid), [b]);
}

/// A raw number is a revision only when it is a whole number in exact
/// range; and a `since` the log cannot answer gets a full listing: none, 0
/// (a host that has read nothing), a revision this tower never reached.
#[test]
fn an_unanswerable_since_gets_a_full_listing() {
    for raw in [
        None,
        Some(0.5),
        Some(-1.0),
        Some(f64::NAN),
        Some(f64::INFINITY),
        Some(-f64::INFINITY),
        Some(2f64.powi(60)),
    ] {
        assert_eq!(whole_revision(raw), None, "{raw:?}");
    }
    assert_eq!(whole_revision(Some(-0.0)), Some(0));
    assert_eq!(whole_revision(Some(7.0)), Some(7));
    let mut t = tower();
    t.set_label(room(&t, 0), "Acme");
    let rev = t.meta_revision;
    for since in [None, Some(0), Some(-3), Some(rev + 1)] {
        assert_eq!(meta_since(&t, since)["full"], true, "{since:?}");
    }
    assert_eq!(meta_since(&t, Some(FIRST_META_REVISION))["full"], false);
    assert_eq!(meta_since(&t, Some(rev))["full"], false);
}

/// A load starts the metadata over: the new tower is at the first meta
/// revision with an empty log, so a host's first read (no `since`, or 0)
/// lists the labels and subtypes the save carried, and a `since` the old
/// tower had reached gets a full listing too. The tower signature reads the
/// same fields before and after.
#[test]
fn a_load_starts_the_metadata_over() {
    let mut sim = at("events-classic", "built");
    let id = room(&sim.tower, 1);
    for k in 0..5 {
        sim.tower.set_label(id, &format!("Corner Office {k}"));
    }
    let reached = sim.tower.meta_revision;
    let signature = sim.tower_signature();
    let loaded = crate::load::deserialize(&sim.serialize()).unwrap();
    let t = &loaded.tower;
    assert_eq!(t.meta_revision, FIRST_META_REVISION);
    assert!(reached > t.meta_revision);
    for since in [None, Some(0), Some(reached)] {
        let doc = meta_since(t, since);
        assert_eq!(doc["full"], true, "{since:?}");
        assert!(ids(&doc).contains(&id), "{since:?}");
    }
    assert_eq!(meta_since(t, Some(FIRST_META_REVISION))["units"], json!([]));
    assert_eq!(loaded.tower_signature(), signature);
}

/// The log drops its older half when full, and a `since` older than what
/// it still holds gets a full listing; one it still reaches stays exact.
#[test]
fn a_full_log_drops_its_older_half() {
    let mut t = tower();
    let (a, b) = (room(&t, 0), room(&t, 1));
    let start = t.meta_revision;
    for k in 0..LOG_CAP + 10 {
        t.set_label(if k % 2 == 0 { a } else { b }, &format!("Name {k}"));
    }
    assert_eq!(meta_since(&t, Some(start))["full"], true);
    let recent = t.meta_revision - 3;
    let doc = meta_since(&t, Some(recent));
    assert_eq!(doc["full"], false);
    assert_eq!(ids(&doc).len(), 2);
    let floor = t.view.meta_log.floor;
    assert!(floor > start && floor < recent);
    assert_eq!(meta_since(&t, Some(floor))["full"], false);
    assert_eq!(meta_since(&t, Some(floor - 1))["full"], true);
}

/// Building a retail room gives it a subtype through the setter, so the
/// meta revision moves with the build.
#[test]
fn a_new_retail_room_moves_the_meta_revision() {
    let mut sim = at("events-classic", "built");
    sim.money = 1e10;
    let rev = sim.tower.meta_revision;
    assert!(sim.build(Kind::FastFood, 4, 190).ok);
    let shop = sim
        .tower
        .units
        .iter()
        .rev()
        .find(|u| u.kind == Kind::FastFood)
        .unwrap();
    assert!(shop.subtype.is_some());
    assert!(sim.tower.meta_revision > rev);
    let doc = meta_since(&sim.tower, Some(rev));
    assert!(ids(&doc).contains(&shop.id));
}

/// Outside a new unit's struct literal, which the loaders build with too,
/// only the setters in `view/meta.rs` write a label or a subtype: a write
/// anywhere else in the library would leave the meta revision behind it.
#[test]
fn only_the_setters_write_labels_and_subtypes() {
    let mut writers = Vec::new();
    for source in engine_sources() {
        for at in metadata_writes(&source.rel, &source.code) {
            writers.push(format!("{}:{}", source.rel, source.line(at)));
        }
    }
    for (line, writes) in [
        ("u.label = x;", true),
        ("u.label=x;", true),
        ("u.label == x", false),
        ("u.subtype.take()", true),
        ("u.label.push_str(\"x\")", true),
        ("u.label.clear()", true),
        ("*label = x;", true),
        ("std::mem::replace(&mut u.label, x)", true),
        ("std::mem::take(&mut self.units[i].subtype)", true),
        ("u.label += \"x\";", true),
        ("u.label.extend(chars)", true),
        ("u.label.pop()", true),
        ("u.subtype.as_mut()", true),
        ("u.label.make_ascii_uppercase()", true),
        ("let tail = u.label.split_off(3);", true),
        ("let n = &mut u.label;", true),
        ("if let Some(s) = &mut u.subtype { *s = \"x\" }", true),
        ("match &mut u.label { l => l.clear() }", true),
        ("if let Some(ref mut s) = u.subtype { *s = \"x\" }", true),
        ("write!(&mut u.label, \"x\")", true),
        ("f(&mut self.units[i].subtype, x)", true),
        ("let Some(s) = &mut u.subtype else { return };", true),
        ("let Some(ref mut s) = u.subtype else { return };", true),
        ("let Unit { label, .. } = u; label.push('x');", true),
        ("let Unit { label: l, .. } = u; l.clear();", true),
        ("u.label.get_mut(0..1)", true),
        ("write!(u.label, \"x\")", true),
        ("writeln!(self.units[i].label)", true),
        ("u.label[..1].make_ascii_uppercase();", true),
        ("u.label.split_at_mut(1).0.make_ascii_uppercase();", true),
        ("u.label.deref_mut().make_ascii_uppercase()", true),
        ("u.subtype.get_or_insert(\"x\");", true),
        (
            "if let Some(Unit { label, .. }) = self.units.get_mut(i) {}",
            true,
        ),
        ("let first = &u.label[..1];", false),
        ("let s = u.label.as_str();", false),
        ("let t = u.subtype.unwrap_or(\"x\");", false),
        ("self.units.swap(a, b);", true),
        ("let n = u.label.len();", false),
        ("f(&mut u.label.len())", false),
        ("let l = u.labels;", false),
    ] {
        let code = squeeze("x.rs".into(), line).code;
        assert_eq!(!metadata_writes("x.rs", &code).is_empty(), writes, "{line}");
    }
    assert!(
        writers.iter().all(|w| w.starts_with("view/meta.rs:")),
        "{writers:?}"
    );
    assert_eq!(writers.len(), 2, "{writers:?}");
}

/// The methods that only read a label (a `String`) or a subtype (an
/// `Option<&str>`); a call of any other method on one counts as a write.
const META_READS: [&str; 18] = [
    "as_str",
    "as_deref",
    "as_ref",
    "clone",
    "len",
    "is_empty",
    "is_some",
    "is_none",
    "unwrap_or",
    "chars",
    "starts_with",
    "ends_with",
    "contains",
    "trim",
    "to_string",
    "to_owned",
    "eq",
    "map",
];

/// Where `rel`'s `code` writes a label or a subtype in place: the shared
/// scan's field writes (assignments, calls of methods off `META_READS`,
/// `&mut` borrows, `ref mut` bindings, writes through a binding of that
/// name) and its whole-unit writes. A new unit gets its metadata in a struct literal
/// (`Tower::place`, the loaders), which the scan does not count, and the
/// loader fills a new tower's list (`load/assemble.rs`, a new log and revision); the
/// session oracle's metadata comparison covers both.
fn metadata_writes(rel: &str, code: &str) -> Vec<usize> {
    let reads = Calls::Reading(&META_READS);
    let mut out = field_writes(code, "label", &reads, &|_| false);
    out.extend(field_writes(code, "subtype", &reads, &|_| false));
    out.extend(new_list_aside(
        rel,
        code,
        unit_writes(code, &["label", "subtype"]),
    ));
    out
}

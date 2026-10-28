//! Tests for `signature.rs`, and the port of undo's `towerStateSig`
//! (`src/engine/UndoHistory.ts`) that the seeded sessions in
//! `oracle_tests.rs` hold the signature to: two states have the same
//! signature exactly when they have the same `towerStateSig` tower half.
//! `engineView.integration.test.ts` checks the port against the real
//! TypeScript.
use super::session_tests::at;
use crate::jsmath::number_to_string;
use crate::schedule::Schedule;
use crate::tower::Tower;

fn join<T: Copy>(v: Option<&[T]>, sep: &str, f: impl Fn(T) -> String) -> String {
    v.unwrap_or(&[])
        .iter()
        .map(|&x| f(x))
        .collect::<Vec<_>>()
        .join(sep)
}

/// `schedSig`.
fn sched_sig(s: Option<&Schedule>) -> String {
    let Some(s) = s else {
        return String::new();
    };
    let int = |n: i64| n.to_string();
    let num = |n: Option<f64>| n.map(number_to_string).unwrap_or_default();
    format!(
        "{}/{}~{}~{}~{}",
        join(s.weekday.as_deref(), ",", int),
        join(s.weekend.as_deref(), ",", int),
        num(s.waiting_car_response),
        num(s.standard_floor_departure),
        join(s.home_floors.as_deref(), ",", int),
    )
}

/// `towerStateSig(tower, money)` without the money: the units, then the
/// transports, each as the TypeScript prints them.
pub(super) fn ts_sig(tower: &Tower) -> String {
    let units: Vec<String> = tower
        .units
        .iter()
        .map(|u| {
            format!(
                "{}@{},{}:{}:{}:{}:{}:{}",
                u.kind.as_str(),
                u.floor,
                u.x,
                u.label,
                u.rent.map(number_to_string).unwrap_or_default(),
                if u.no_rate { "N" } else { "" },
                u.film_policy.unwrap_or(""),
                u.subtype.unwrap_or(""),
            )
        })
        .collect();
    let shafts: Vec<String> = tower
        .transports
        .iter()
        .map(|t| {
            format!(
                "{}@{}:{}-{}:{}:{}:{}",
                t.kind.as_str(),
                t.x,
                t.bottom,
                t.top,
                t.cars,
                join(t.skip_floors.as_deref(), ".", number_to_string),
                sched_sig(t.schedule.as_ref()),
            )
        })
        .collect();
    format!("{}|{}", units.join(";"), shafts.join(";"))
}

/// The cases a signature compare is most likely to miss or to invent:
/// a rent of `-0` prints as `0`, a NaN rent as `NaN`; money is not part of
/// it; reading it changes nothing, so a change undone between two reads
/// reads as no change, as the string compare does.
#[test]
fn the_signature_reads_numbers_as_the_string_prints_them() {
    let mut sim = at("events-classic", "built");
    let first = sim.tower_signature();
    assert_eq!(sim.tower_signature(), first);
    sim.money += 12345.0;
    assert_eq!(
        sim.tower_signature(),
        first,
        "money is compared beside the signature"
    );
    let i = sim.tower.room_index()[0];
    let rent = sim.tower.units[i].rent;
    sim.tower.units[i].rent = Some(0.0);
    let zero = sim.tower_signature();
    assert_ne!(zero, first);
    sim.tower.units[i].rent = Some(-0.0);
    assert_eq!(sim.tower_signature(), zero, "-0 prints as 0");
    sim.tower.units[i].rent = Some(f64::NAN);
    let nan = sim.tower_signature();
    assert_ne!(nan, zero);
    sim.tower.units[i].rent = Some(-f64::NAN);
    assert_eq!(sim.tower_signature(), nan, "every NaN prints as NaN");
    sim.tower.units[i].rent = rent;
    assert_eq!(sim.tower_signature(), first, "back where it started");
    sim.tower.units[i].occupants += 3;
    sim.tower.units[i].satisfaction = 0.25;
    assert_eq!(
        sim.tower_signature(),
        first,
        "fields the signature leaves out"
    );
}

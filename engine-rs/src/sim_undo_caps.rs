//! The caps a step keeps to (`sim_undo_check.rs`): the units and shafts a
//! step puts back keep the tower within each kind's cap and each shared
//! pool, as building them again would (`Tower::cap_reason`).
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use crate::facilities::{build_cap, Kind, FACILITIES, POOLED_CAPS};
use crate::tower::Tower;
use crate::undo::{Step, TransportChange, UnitChange};

/// A cap a step can take the tower up against: one kind's own (`build_cap`)
/// or a shared pool's (`POOLED_CAPS`, by its place in that list).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CapKey {
    Kind(Kind),
    Pool(usize),
}

/// How many units and shafts under one cap the tower held when a step was
/// made (`Step::caps_held`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CapHeld {
    pub(crate) cap: CapKey,
    pub(crate) count: i64,
}

/// A cap applying a step adds units or shafts under: its limit, how many
/// the tower holds under it now and how many the step adds.
struct Raised {
    cap: CapKey,
    limit: i64,
    now: i64,
    added: i64,
}

/// How many units and shafts of each kind applying `step` adds to `tower`,
/// by `Kind`: one it takes out counts against its kind.
fn kinds_added(tower: &Tower, step: &Step) -> Vec<i64> {
    let mut added = vec![0; FACILITIES.len()];
    for img in &step.units {
        match &img.change {
            UnitChange::PutBack(u) => added[u.kind as usize] += 1,
            UnitChange::TakeOut(_) => {
                if let Some(u) = tower.get_unit(img.id) {
                    added[u.kind as usize] -= 1;
                }
            }
            UnitChange::Restore { .. } => {}
        }
    }
    for img in &step.transports {
        match &img.change {
            TransportChange::PutBack(t) => added[t.kind as usize] += 1,
            TransportChange::TakeOut { left } => added[left.kind as usize] -= 1,
            TransportChange::Restore { .. } => {}
        }
    }
    added
}

/// The caps applying `step` to `tower` adds under (`Tower::cap_reason`).
fn caps_raised(tower: &Tower, step: &Step) -> Vec<Raised> {
    let added = kinds_added(tower, step);
    let own = FACILITIES.iter().filter_map(|f| {
        let n = added[f.kind as usize];
        let limit = build_cap(f.kind).filter(|_| n > 0)?;
        Some(Raised {
            cap: CapKey::Kind(f.kind),
            limit,
            now: tower.count_kind(f.kind),
            added: n,
        })
    });
    let pooled = POOLED_CAPS.iter().enumerate().filter_map(|(i, pool)| {
        let n: i64 = pool.kinds.iter().map(|&k| added[k as usize]).sum();
        (n > 0).then(|| Raised {
            cap: CapKey::Pool(i),
            limit: pool.cap,
            now: pool.kinds.iter().map(|&k| tower.count_kind(k)).sum(),
            added: n,
        })
    });
    own.chain(pooled).collect()
}

/// What `step`, made on `tower` as it is now, records of the caps it adds
/// under.
pub(crate) fn caps_held(tower: &Tower, step: &Step) -> Vec<CapHeld> {
    caps_raised(tower, step)
        .into_iter()
        .map(|r| CapHeld {
            cap: r.cap,
            count: r.now,
        })
        .collect()
}

/// Whether the units and shafts `step` puts back keep the tower within its
/// caps, as building them again would. A tower can hold more than a cap
/// (an older save): a step may then leave it as far over as the edit found
/// it, and is refused only when the tower has gained under that cap since
/// the step was made.
pub(crate) fn within_caps(tower: &Tower, step: &Step) -> bool {
    caps_raised(tower, step).iter().all(|r| {
        let held = step.caps_held.iter().find(|h| h.cap == r.cap);
        r.now + r.added <= r.limit || held.is_some_and(|h| r.now <= h.count)
    })
}

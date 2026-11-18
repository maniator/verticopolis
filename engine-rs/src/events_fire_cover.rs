//! The rooms of each kind, gathered once per daily fire pass, so each
//! burning room's control chance and spread roll read only the rooms of the
//! kind they ask about (#1158 A16).

use crate::facilities::{Kind, FACILITIES};
use crate::tower::Tower;

/// Positions in `units` of the rooms of each kind, each group in unit
/// order. It stays good while no unit is added or removed, which holds for
/// a fire pass: gutting and igniting rewrite a unit in place.
pub(super) struct RoomsByKind(Vec<Vec<usize>>);

impl RoomsByKind {
    pub(super) fn of(tower: &Tower) -> RoomsByKind {
        let mut groups = vec![Vec::new(); FACILITIES.len()];
        for &i in tower.room_index().iter() {
            groups[tower.units[i].kind as usize].push(i);
        }
        RoomsByKind(groups)
    }

    /// The rooms of `kind`, in unit order.
    pub(super) fn of_kind(&self, kind: Kind) -> &[usize] {
        &self.0[kind as usize]
    }
}

#[cfg(test)]
mod tests {
    use super::RoomsByKind;
    use crate::facilities::Kind;
    use crate::facilities::FACILITIES;
    use crate::load::deserialize;
    use crate::rule_tests::fixture_save;
    use crate::tower::UnitState;

    #[test]
    fn each_room_sits_once_under_its_own_kind_in_unit_order() {
        for name in ["sixseven_2", "towerone_6", "split-tower"] {
            let sim = deserialize(&fixture_save(name)).unwrap();
            let rooms = RoomsByKind::of(&sim.tower);
            let mut seen = 0;
            for f in FACILITIES.iter() {
                let kind = f.kind;
                let walked: Vec<usize> = (0..sim.tower.units.len())
                    .filter(|&i| {
                        let u = &sim.tower.units[i];
                        !u.kind.is_structural() && u.kind == kind
                    })
                    .collect();
                assert_eq!(rooms.of_kind(kind), walked.as_slice(), "{name} {kind:?}");
                seen += walked.len();
            }
            assert!(seen > 0, "{name} has no rooms");
        }
    }

    #[test]
    fn a_medical_room_that_catches_fire_mid_pass_stops_counting() {
        let mut sim = deserialize(&fixture_save("sixseven_2")).unwrap();
        sim.events.fire = None;
        let mut medical: Vec<usize> = (0..sim.tower.units.len())
            .filter(|&i| sim.tower.units[i].kind == Kind::Medical)
            .collect();
        if medical.is_empty() {
            let room = sim.tower.room_index()[0];
            sim.tower.units[room].kind = Kind::Medical;
            sim.tower.units[room].state = UnitState::Occupied;
            medical.push(room);
        }
        let floor = sim.tower.units[medical[0]].floor;
        let rooms = RoomsByKind::of(&sim.tower);
        let before = sim.control_chance_in(&rooms, floor);
        for &i in &medical {
            let (u, at) = sim.tower.marked(i);
            u.set_state(at, UnitState::Fire);
        }
        let after = sim.control_chance_in(&rooms, floor);
        assert!((before - after - 0.3).abs() < 1e-9, "{before} then {after}");
        assert!((after - sim.control_chance(floor)).abs() < 1e-9);
    }
}

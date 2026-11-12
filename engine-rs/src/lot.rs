//! The lot a tower stands on, and the floor rules that follow from its top
//! floor.
//!
//! Every tower today stands on [`Lot::STANDARD`], whose top floor is
//! [`MAX_FLOOR`], the 1994 game's floor 100. A tower asks
//! [`crate::tower::Tower::lot`] for its lot, so a later lot shape (the tall
//! lot, #1983) changes the top in that one place. A 1994 TDT file and a save
//! that names no lot describe the standard lot.
//!
//! `MAX_FLOOR` itself stays the capacity bound: the grids, slot tables and
//! size caps sized for every tower keep reading it, since no lot's top floor
//! rises above it.

use crate::facilities::{Kind, MAX_FLOOR, MIN_FLOOR};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// A tower's lot: today its top floor alone.
pub(crate) struct Lot {
    top_floor: i64,
}

impl Lot {
    /// The lot every tower has today and the one a 1994 TDT describes: top
    /// floor 100.
    pub(crate) const STANDARD: Lot = Lot {
        top_floor: MAX_FLOOR,
    };

    /// The top floor: the highest floor slab and the floor the wedding hall
    /// stands on.
    pub(crate) fn top_floor(self) -> i64 {
        self.top_floor
    }

    /// Whether a room, a floor tile or a shaft end may sit on `floor`.
    pub(crate) fn holds_floor(self, floor: i64) -> bool {
        (MIN_FLOOR..=self.top_floor).contains(&floor)
    }

    /// Whether the wedding hall may stand on `floor`: it crowns the tower, on
    /// the top floor and nowhere else.
    pub(crate) fn crowns_with_wedding_hall(self, floor: i64) -> bool {
        floor == self.top_floor
    }

    /// The highest story a unit of `kind` may occupy: the top floor, except
    /// the wedding hall, which stands on the top floor and rises above it.
    pub(crate) fn highest_story(self, kind: Kind) -> i64 {
        if kind == Kind::WeddingHall {
            self.top_floor + kind.floors() - 1
        } else {
            self.top_floor
        }
    }

    /// The highest floor a unit of `kind` may stand on (its bottom story).
    pub(crate) fn highest_base_floor(self, kind: Kind) -> i64 {
        self.highest_story(kind) - (kind.floors() - 1)
    }

    /// How many stories of a `kind` unit standing on `floor` rest on floor
    /// slabs: all of them, except the wedding hall's upper stories, which
    /// stand above the top floor's slab.
    pub(crate) fn slab_stories(self, kind: Kind, floor: i64) -> i64 {
        kind.floors().min(self.top_floor + 1 - floor)
    }

    /// The highest story of a unit standing on `floor` that `stories` tall
    /// rests on a slab: its top story, or the top floor for the wedding hall.
    pub(crate) fn highest_slab_story(self, floor: i64, stories: i64) -> i64 {
        (floor + stories - 1).min(self.top_floor)
    }

    /// Whether a `kind` unit standing on `floor` would reach the top floor.
    pub(crate) fn touches_top_floor(self, kind: Kind, floor: i64) -> bool {
        floor <= self.top_floor && floor + kind.floors() > self.top_floor
    }

    /// The most floors a shaft of `kind` may span: stairs and escalators
    /// link two floors, standard and service elevators 30, and an express
    /// elevator the whole lot, lowest basement to the top floor.
    pub(crate) fn max_span(self, kind: Kind) -> i64 {
        match kind {
            Kind::Stairs | Kind::Escalator => 1,
            Kind::ElevatorExpress => self.top_floor - MIN_FLOOR,
            _ => 30,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;

    #[test]
    fn the_standard_lot_tops_out_at_floor_100() {
        let lot = Lot::STANDARD;
        assert_eq!(lot.top_floor(), 100);
        assert!(lot.holds_floor(MIN_FLOOR) && lot.holds_floor(100));
        assert!(!lot.holds_floor(MIN_FLOOR - 1) && !lot.holds_floor(101));
        assert!(lot.crowns_with_wedding_hall(100) && !lot.crowns_with_wedding_hall(99));
    }

    #[test]
    fn the_standard_lot_keeps_the_1994_heights_and_spans() {
        let lot = Lot::STANDARD;
        let hall = Kind::WeddingHall;
        assert_eq!(lot.highest_story(hall), 100 + hall.floors() - 1);
        assert_eq!(lot.highest_base_floor(hall), 100);
        assert_eq!(lot.highest_story(Kind::PartyHall), 100);
        assert_eq!(lot.highest_base_floor(Kind::PartyHall), 99);
        assert_eq!(lot.max_span(Kind::ElevatorExpress), 100 - MIN_FLOOR);
        assert_eq!(lot.max_span(Kind::ElevatorStandard), 30);
        assert_eq!(lot.max_span(Kind::ElevatorService), 30);
        assert_eq!(lot.max_span(Kind::Stairs), 1);
        assert_eq!(lot.max_span(Kind::Escalator), 1);
    }

    #[test]
    fn only_the_wedding_hall_rises_above_the_top_slab() {
        let lot = Lot::STANDARD;
        let hall = Kind::WeddingHall;
        assert_eq!(lot.slab_stories(hall, 100), 1);
        assert_eq!(
            lot.highest_slab_story(100, lot.slab_stories(hall, 100)),
            100
        );
        assert_eq!(lot.slab_stories(Kind::PartyHall, 99), 2);
        assert_eq!(lot.highest_slab_story(99, 2), 100);
        assert_eq!(lot.slab_stories(Kind::Office, 50), 1);
    }

    #[test]
    fn touching_the_top_floor_means_any_story_on_it() {
        let lot = Lot::STANDARD;
        assert!(lot.touches_top_floor(Kind::Office, 100));
        assert!(lot.touches_top_floor(Kind::PartyHall, 99));
        assert!(!lot.touches_top_floor(Kind::PartyHall, 98));
        assert!(!lot.touches_top_floor(Kind::Office, 101));
    }

    #[test]
    fn a_taller_lot_moves_every_answer_with_its_top() {
        let tall = Lot { top_floor: 120 };
        assert!(tall.holds_floor(120) && !tall.holds_floor(121));
        assert!(tall.crowns_with_wedding_hall(120) && !tall.crowns_with_wedding_hall(100));
        assert_eq!(tall.highest_story(Kind::Office), 120);
        assert_eq!(
            tall.highest_story(Kind::WeddingHall),
            120 + Kind::WeddingHall.floors() - 1
        );
        assert_eq!(tall.max_span(Kind::ElevatorExpress), 120 - MIN_FLOOR);
        assert_eq!(tall.max_span(Kind::ElevatorStandard), 30);
        assert!(tall.touches_top_floor(Kind::Office, 120));
        assert!(!tall.touches_top_floor(Kind::Office, 100));
    }

    #[test]
    fn classic_keeps_whichever_floor_tops_the_lot_for_the_wedding_hall() {
        let tall = Lot { top_floor: 120 };
        for (lot, top) in [(Lot::STANDARD, 100), (tall, 120)] {
            let classic = GameMode::Classic;
            assert!(classic.refuses_room_on_reserved_top_floor(lot, Kind::Office, top));
            assert!(classic.refuses_room_on_reserved_top_floor(lot, Kind::PartyHall, top - 1));
            assert!(!classic.refuses_room_on_reserved_top_floor(lot, Kind::Office, top - 1));
            assert!(!classic.refuses_room_on_reserved_top_floor(lot, Kind::WeddingHall, top));
            assert!(!GameMode::Modern.refuses_room_on_reserved_top_floor(lot, Kind::Office, top));
        }
        // Floor 100 is an ordinary floor on a taller lot.
        assert!(!GameMode::Classic.refuses_room_on_reserved_top_floor(tall, Kind::Office, 100));
    }
}

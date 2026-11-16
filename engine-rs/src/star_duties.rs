//! What a new star rating starts asking of a tower: each duty names the
//! rating it begins at, read from the engine rule that starts it, so the
//! catalog can tell a frontend what changes on a star-up (Modern's heads-up
//! in the star-up message box) without the frontend deciding it.

use serde::Serialize;

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::satisfaction::shortfall::SHORTFALL_MIN_STAR;
use crate::star::{
    BOMB_THREATS_FROM_STAR, EMERGENCIES_FROM_STAR, HOTEL_GUESTS_UNCOUNTED_FROM_STAR,
    VIP_VISITS_FROM_STAR,
};

/// One duty: the rating it begins at and its stable id. The words stay with
/// the frontend.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct StarDuty {
    pub star: i64,
    pub id: &'static str,
}

/// Fires can break out and thieves can strike.
pub const EMERGENCIES: &str = "emergencies";
/// Each hotel suite needs a working parking space of its own.
pub const SUITE_PARKING: &str = "suiteParking";
/// Offices need parking, and their ratings fall without it.
pub const OFFICE_PARKING: &str = "officeParking";
/// Homes need parking too (Modern).
pub const HOME_PARKING: &str = "homeParking";
/// The tower's trash needs enough Recycling Centers, or ratings fall.
pub const RECYCLING: &str = "recycling";
/// A VIP may come to stay in a hotel suite.
pub const VIP_VISITS: &str = "vipVisits";
/// Hotel guests stop counting toward the rating.
pub const HOTEL_GUESTS_UNCOUNTED: &str = "hotelGuestsUncounted";
/// A caller can threaten the tower with a bomb.
pub const BOMB_THREATS: &str = "bombThreats";

/// Every duty of `mode`, by the rating it begins at, then in a fixed order.
pub fn star_duties(mode: GameMode) -> Vec<StarDuty> {
    // Parking is demanded once it can be built, and offices feel a shortfall
    // only once the service shortfalls apply, so their duty starts at the
    // later of the two.
    let parking = Kind::Parking.facility().min_star;
    let office_parking = parking.max(SHORTFALL_MIN_STAR);
    let mut duties = vec![
        StarDuty {
            star: EMERGENCIES_FROM_STAR,
            id: EMERGENCIES,
        },
        StarDuty {
            star: parking,
            id: SUITE_PARKING,
        },
        StarDuty {
            star: office_parking,
            id: OFFICE_PARKING,
        },
    ];
    if mode.homes_need_parking() {
        duties.push(StarDuty {
            star: office_parking,
            id: HOME_PARKING,
        });
    }
    duties.extend([
        StarDuty {
            star: SHORTFALL_MIN_STAR,
            id: RECYCLING,
        },
        StarDuty {
            star: VIP_VISITS_FROM_STAR,
            id: VIP_VISITS,
        },
        StarDuty {
            star: HOTEL_GUESTS_UNCOUNTED_FROM_STAR,
            id: HOTEL_GUESTS_UNCOUNTED,
        },
        StarDuty {
            star: BOMB_THREATS_FROM_STAR,
            id: BOMB_THREATS,
        },
    ]);
    // A stable sort keeps the fixed order within one rating.
    duties.sort_by_key(|d| d.star);
    duties
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::Simulation;

    fn at(mode: GameMode, star: i64) -> Vec<&'static str> {
        star_duties(mode)
            .into_iter()
            .filter(|d| d.star == star)
            .map(|d| d.id)
            .collect()
    }

    /// The ratings each duty begins at, per mode: parking, recycling and the
    /// VIP from three stars (homes in Modern only), hotel guests and bombs
    /// from four, fires and thieves from two.
    #[test]
    fn duties_by_rating() {
        for mode in [GameMode::Classic, GameMode::Modern] {
            assert!(at(mode, 1).is_empty(), "{mode:?}");
            assert_eq!(at(mode, 2), vec![EMERGENCIES], "{mode:?}");
            assert_eq!(
                at(mode, 4),
                vec![HOTEL_GUESTS_UNCOUNTED, BOMB_THREATS],
                "{mode:?}"
            );
            assert!(at(mode, 5).is_empty(), "{mode:?}");
        }
        assert_eq!(
            at(GameMode::Classic, 3),
            vec![SUITE_PARKING, OFFICE_PARKING, RECYCLING, VIP_VISITS]
        );
        assert_eq!(
            at(GameMode::Modern, 3),
            vec![
                SUITE_PARKING,
                OFFICE_PARKING,
                HOME_PARKING,
                RECYCLING,
                VIP_VISITS
            ]
        );
    }

    /// The parking duties begin where the engine starts asking for parking:
    /// a two-star tower has no parking demand, a three-star one does.
    #[test]
    fn parking_duty_matches_parking_demand() {
        let mut sim = Simulation::new_game(7, GameMode::Modern);
        sim.money = 1.0e9;
        for x in 150..230 {
            assert!(sim.build(Kind::Lobby, 1, x).ok);
        }
        for x in 151..229 {
            assert!(sim.build(Kind::Floor, 2, x).ok);
        }
        assert!(sim.build_transport(Kind::ElevatorStandard, 151, 1, 2).ok);
        assert!(sim.build(Kind::Office, 2, 160).ok);
        for _ in 0..(3 * 24) {
            sim.tick(60.0);
        }
        let start = star_duties(GameMode::Modern)
            .iter()
            .find(|d| d.id == OFFICE_PARKING)
            .map(|d| d.star)
            .unwrap();
        sim.star = start - 1;
        assert_eq!(sim.parking_demand().offices, 0.0, "no parking asked below");
        sim.star = start;
        assert!(
            sim.parking_demand().offices > 0.0,
            "parking asked from {start}"
        );
    }
}

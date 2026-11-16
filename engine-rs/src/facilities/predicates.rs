// What each kind does in the simulation: transport capacity, staff
// access, opening hours, demand and households. Internal to the engine; a
// host reads these facts from the catalog.

use super::*;

/// Whether shop and restaurant customers come in person from outside the
/// tower (`crowd::walk_ins`). Off for now (owner, 2026-11-14): at full
/// demand they jammed the elevators of towers built before 3.12.0 and
/// tenants moved out over congestion. While it is off, those venues count
/// their customers from demand as 3.11 did, with nobody shown arriving.
pub const WALK_INS_ON: bool = false;

/// A per-thread stand-in for [`WALK_INS_ON`] in tests.
#[cfg(test)]
fn walk_ins_switch() -> &'static std::thread::LocalKey<std::cell::Cell<bool>> {
    thread_local! {
        static ON: std::cell::Cell<bool> = const { std::cell::Cell::new(WALK_INS_ON) };
    }
    &ON
}

/// Turns walk-ins on or off for the calling test's thread, so their own
/// tests keep running while [`WALK_INS_ON`] is off.
#[cfg(test)]
pub fn set_walk_ins_for_test(on: bool) {
    walk_ins_switch().with(|w| w.set(on));
}

#[cfg(test)]
fn walk_ins_on() -> bool {
    walk_ins_switch().with(std::cell::Cell::get)
}

#[cfg(not(test))]
fn walk_ins_on() -> bool {
    WALK_INS_ON
}

/// How many hours before a venue opens its crew is called in
/// (`Kind::staffed_at`).
const CREW_CALL_AHEAD: i64 = 4;

#[doc(hidden)]
impl Kind {
    #[doc(hidden)]
    /// `transportCarCapacity`.
    pub fn car_capacity(self) -> f64 {
        match self {
            Kind::ElevatorStandard => 21.0,
            Kind::ElevatorService => 17.0,
            Kind::ElevatorExpress => 42.0,
            Kind::Escalator => 30.0,
            Kind::Stairs => 8.0,
            _ => 0.0,
        }
    }

    #[doc(hidden)]
    /// The capacity byte the `.TDT` exporter writes in an elevator header. The
    /// byte is unreliable (a real save's service shaft carried 21), so the
    /// service value the exporter always wrote stays: the referee pins it.
    pub fn tdt_header_capacity(self) -> i64 {
        match self {
            Kind::ElevatorService => 10,
            other => other.car_capacity() as i64,
        }
    }

    #[doc(hidden)]
    /// `isStaffOnlyTransport`.
    pub fn is_staff_only_transport(self) -> bool {
        self.facility().staff_only
    }

    #[doc(hidden)]
    /// `isStaffTransportKind`: staff-only elevators plus stairs.
    pub fn is_staff_transport(self) -> bool {
        self.is_staff_only_transport() || self == Kind::Stairs
    }

    #[doc(hidden)]
    pub fn is_walkway(self) -> bool {
        matches!(self, Kind::Stairs | Kind::Escalator)
    }

    #[doc(hidden)]
    /// `WALKWAY_WILLINGNESS`.
    pub fn walkway_willingness(self) -> Option<i64> {
        match self {
            Kind::Stairs => Some(4),
            Kind::Escalator => Some(7),
            _ => None,
        }
    }

    #[doc(hidden)]
    /// `attendanceCap`.
    pub fn attendance_cap(self) -> Option<i64> {
        self.facility().attendance
    }

    #[doc(hidden)]
    /// A kind a meal trip can be sent to (every `MealWindow::venues` list),
    /// so the customers inside it are people who walked or rode in.
    pub fn is_meal_venue(self) -> bool {
        matches!(
            self,
            Kind::FastFood | Kind::Restaurant | Kind::FoodHall | Kind::Cinema
        )
    }

    #[doc(hidden)]
    /// A shop or restaurant whose customers come in from outside the tower
    /// at the rate its demand sets (`crowd::walk_ins`): every kind with a
    /// spend per customer but the daycare, whose children are not shoppers.
    /// Each walk-in comes through the lobby or the Metro and rides the cars
    /// like anyone else, and the day's patronage counts the ones who got
    /// there. None does while [`WALK_INS_ON`] is off.
    pub fn takes_walk_ins(self) -> bool {
        walk_ins_on()
            && matches!(
                self,
                Kind::FastFood
                    | Kind::Restaurant
                    | Kind::FoodHall
                    | Kind::Amusements
                    | Kind::BoutiqueBay
                    | Kind::Nightclub
                    | Kind::Spa
                    | Kind::SkyBar
                    | Kind::Shop
            )
    }

    #[doc(hidden)]
    /// A kind whose head count mirrors the visitors inside it (an
    /// attendance venue, a [`Kind::is_meal_venue`] or a kind that
    /// [`Kind::takes_walk_ins`]). The count lives
    /// in the unsaved `customers_in`, which a load counts again from the
    /// visitors the save's crowd carries (`crowd::save`) and an undo starts
    /// at 0, and the dispatch estimate skips it, since those visitors ride
    /// as real people.
    pub fn counts_visitors(self) -> bool {
        self.attendance_cap().is_some() || self.is_meal_venue() || self.takes_walk_ins()
    }

    #[doc(hidden)]
    /// The staff a room of this kind keeps at work while it is open, who
    /// come in and go home as people in a Modern tower (`crowd::commuters`);
    /// 0 for a kind with no staff of its own. The original draws no venue
    /// staff, so these are our own.
    pub fn staff_size(self) -> i64 {
        match self {
            Kind::Shop | Kind::BoutiqueBay => 2,
            Kind::FastFood | Kind::Amusements | Kind::Spa | Kind::SkyBar => 3,
            Kind::Restaurant | Kind::Nightclub | Kind::Daycare => 4,
            Kind::Cinema | Kind::PartyHall => 4,
            Kind::FoodHall | Kind::AquaticCenter => 6,
            _ => 0,
        }
    }

    #[doc(hidden)]
    /// Whether this kind keeps staff of its own ([`Kind::staff_size`]).
    pub fn has_staff(self) -> bool {
        self.staff_size() > 0
    }

    #[doc(hidden)]
    /// Whether a venue's staff should be at work at `hour`: while it is
    /// open, and from four hours before it opens (`CREW_CALL_AHEAD`), so a
    /// shop that opens at 10 has its crew ride in at 6, before the office
    /// rush. A break of four hours or less, such as a restaurant's between
    /// lunch and dinner, keeps them in.
    pub fn staffed_at(self, hour: i64) -> bool {
        self.has_staff()
            && (0..=CREW_CALL_AHEAD).any(|d| self.is_open_at((hour + d).rem_euclid(24)))
    }

    #[doc(hidden)]
    /// Whether a room of this kind in a `mode` tower opens only once its
    /// staff have come in (`crowd::commuters`): a venue with staff, in a
    /// tower whose staff commute in person.
    pub fn waits_for_staff(self, mode: crate::clock::GameMode) -> bool {
        self.has_staff() && mode.venue_staff_commute_in_person()
    }

    #[doc(hidden)]
    /// A kind whose workers come in and go home as people in a `mode` tower
    /// (`crowd::commuters`): its head count is the workers who got there,
    /// and the dispatch estimate skips it, since they ride the cars
    /// themselves. Offices in Modern today.
    pub fn commutes_in_person(self, mode: crate::clock::GameMode) -> bool {
        self == Kind::Office && mode.office_workers_commute_in_person()
    }

    #[doc(hidden)]
    /// A home whose residents leave for the day and come home as people in a
    /// `mode` tower (`crowd::commuters`): a condo, apartment or studio. Its
    /// head count is the residents at home, and the dispatch estimate skips
    /// it, since they ride the cars themselves. Modern homes today.
    pub fn lives_in_person(self, mode: crate::clock::GameMode) -> bool {
        (self == Kind::Condo || self.is_rental()) && mode.residents_commute_in_person()
    }

    #[doc(hidden)]
    /// A hotel room whose guests check in and out as people in a `mode`
    /// tower (`crowd::commuters`): its head count is the guests in the room,
    /// and the dispatch estimate skips it, since they ride the cars
    /// themselves. Modern hotels today.
    pub fn stays_in_person(self, mode: crate::clock::GameMode) -> bool {
        self.is_hotel() && mode.hotel_guests_arrive_in_person()
    }

    #[doc(hidden)]
    /// A kind whose head count is the people who really got there in a
    /// `mode` tower: an office whose workers commute
    /// ([`Kind::commutes_in_person`]), a home whose residents do
    /// ([`Kind::lives_in_person`]) or a hotel room whose guests do
    /// ([`Kind::stays_in_person`]). The hourly head count and the dispatch
    /// estimate leave it alone.
    pub fn arrives_in_person(self, mode: crate::clock::GameMode) -> bool {
        self.commutes_in_person(mode) || self.lives_in_person(mode) || self.stays_in_person(mode)
    }

    #[doc(hidden)]
    /// How many residents of a home of this kind stay in on a weekday while
    /// the rest are out (the hourly head count's daytime figure): one in a
    /// condo or apartment, nobody in a studio.
    pub fn residents_home_by_day(self) -> i64 {
        i64::from(self.has_household())
    }

    #[doc(hidden)]
    /// `isCommercialKind`.
    pub fn is_commercial(self) -> bool {
        matches!(
            self,
            Kind::FastFood
                | Kind::Restaurant
                | Kind::FoodHall
                | Kind::Amusements
                | Kind::BoutiqueBay
                | Kind::Nightclub
                | Kind::Spa
                | Kind::SkyBar
                | Kind::Daycare
                | Kind::Shop
                | Kind::Cinema
        )
    }

    #[doc(hidden)]
    /// A venue that makes no noise for the rooms beside it on its floor,
    /// though it is commercial in every other sense: the spa is calm by
    /// design, and the daycare keeps the hours its neighbors are at work.
    pub fn is_quiet_venue(self) -> bool {
        matches!(self, Kind::Spa | Kind::Daycare)
    }

    #[doc(hidden)]
    /// A commercial venue that makes noise for the rooms beside it on its
    /// floor: every commercial kind except the quiet ones. (An office is a
    /// noise source too, for homes and hotel rooms; the noise check adds it.)
    pub fn is_noisy_venue(self) -> bool {
        self.is_commercial() && !self.is_quiet_venue()
    }

    #[doc(hidden)]
    /// `hasBusinessHours`.
    pub fn has_business_hours(self) -> bool {
        self.is_commercial() || matches!(self, Kind::PartyHall | Kind::AquaticCenter)
    }

    #[doc(hidden)]
    /// `isOpenAt`.
    pub fn is_open_at(self, hour: i64) -> bool {
        match self {
            Kind::FastFood => (7..22).contains(&hour),
            Kind::Restaurant => (11..14).contains(&hour) || (17..23).contains(&hour),
            Kind::FoodHall => (10..22).contains(&hour),
            Kind::Shop => (10..21).contains(&hour),
            Kind::Amusements => (10..24).contains(&hour),
            Kind::Nightclub => !(2..20).contains(&hour),
            Kind::BoutiqueBay => (10..21).contains(&hour),
            Kind::Spa => (9..21).contains(&hour),
            Kind::SkyBar => (16..24).contains(&hour),
            Kind::Daycare => (7..19).contains(&hour),
            Kind::Cinema => (12..24).contains(&hour),
            Kind::PartyHall => (17..24).contains(&hour),
            Kind::AquaticCenter => (8..22).contains(&hour),
            _ => true,
        }
    }

    #[doc(hidden)]
    /// `openHoursPerDay`.
    pub fn open_hours_per_day(self) -> i64 {
        let h = (0..24).filter(|&hr| self.is_open_at(hr)).count() as i64;
        if h == 0 {
            1
        } else {
            h
        }
    }

    #[doc(hidden)]
    /// `isUnmetDemandKind`.
    pub fn is_unmet_demand_kind(self) -> bool {
        matches!(self, Kind::Office | Kind::Condo | Kind::RentalApartment) || self.is_hotel()
    }

    #[doc(hidden)]
    /// `isLeaseAmenityKind`.
    pub fn is_lease_amenity(self) -> bool {
        matches!(self, Kind::FitnessClub | Kind::Clinic)
    }

    #[doc(hidden)]
    /// `hasHousehold`.
    pub fn has_household(self) -> bool {
        matches!(self, Kind::Condo | Kind::RentalApartment)
    }

    #[doc(hidden)]
    pub fn is_staff_kind(self) -> bool {
        matches!(
            self,
            Kind::Security | Kind::Medical | Kind::Housekeeping | Kind::Recycling
        )
    }

    #[doc(hidden)]
    /// The one-way ambient venue pool in `spawnFloors`.
    pub fn is_ambient_venue(self) -> bool {
        matches!(
            self,
            Kind::Shop
                | Kind::Restaurant
                | Kind::FastFood
                | Kind::Amusements
                | Kind::BoutiqueBay
                | Kind::Nightclub
                | Kind::Spa
                | Kind::SkyBar
                | Kind::Daycare
        )
    }
}

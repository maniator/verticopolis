// What each kind does in the simulation: transport capacity, staff
// access, opening hours, demand and households. Internal to the engine; a
// host reads these facts from the catalog.

use super::*;

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
    /// there.
    pub fn takes_walk_ins(self) -> bool {
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
                | Kind::Shop
        )
    }

    #[doc(hidden)]
    /// A kind whose head count mirrors the visitors inside it (an
    /// attendance venue, a [`Kind::is_meal_venue`] or a kind that
    /// [`Kind::takes_walk_ins`]). The count lives only
    /// in the unsaved `customers_in`, so a save leaves the head count out, a
    /// load and an undo start it at 0, and the dispatch estimate skips it,
    /// since those visitors ride as real people.
    pub fn counts_visitors(self) -> bool {
        self.attendance_cap().is_some() || self.is_meal_venue() || self.takes_walk_ins()
    }

    #[doc(hidden)]
    /// The staff a room of this kind keeps at work while it is open, who
    /// come in and go home as people (`crowd::commuters`); 0 for a kind
    /// with no staff of its own. A venue opens only once one of them is
    /// in. The original draws no venue staff, so these are our own.
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
    /// open, and in the hour before it opens, so they are in by the time
    /// the doors open. A restaurant's staff go home between lunch and
    /// dinner.
    pub fn staffed_at(self, hour: i64) -> bool {
        self.has_staff() && (self.is_open_at(hour) || self.is_open_at((hour + 1).rem_euclid(24)))
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

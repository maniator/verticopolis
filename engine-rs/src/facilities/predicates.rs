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

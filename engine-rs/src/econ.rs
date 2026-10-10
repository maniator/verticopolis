//! Port of the pricing parts of `src/engine/econConfig.ts` and `pricing.ts`.

use crate::facilities::Kind;

#[derive(Clone, Copy, Debug)]
pub struct RentConfig {
    pub default: f64,
    pub min: f64,
    pub max: f64,
    pub step: f64,
}

const fn cfg(default: f64, min: f64, max: f64, step: f64) -> RentConfig {
    RentConfig {
        default,
        min,
        max,
        step,
    }
}

/// `ECON.rent[kind]`.
pub fn rent_config(kind: Kind) -> Option<RentConfig> {
    Some(match kind {
        Kind::Office => cfg(10_000.0, 2_000.0, 20_000.0, 1_000.0),
        Kind::Condo => cfg(160_000.0, 80_000.0, 200_000.0, 10_000.0),
        Kind::HotelSingle => cfg(90.0, 40.0, 200.0, 10.0),
        Kind::HotelDouble => cfg(180.0, 80.0, 400.0, 20.0),
        Kind::HotelSuite => cfg(500.0, 200.0, 1_000.0, 50.0),
        Kind::FitnessClub => cfg(6_000.0, 2_000.0, 12_000.0, 1_000.0),
        Kind::Clinic => cfg(4_000.0, 1_500.0, 8_000.0, 500.0),
        Kind::RentalStudio => cfg(2_000.0, 1_000.0, 3_000.0, 250.0),
        Kind::RentalApartment => cfg(4_000.0, 3_000.0, 8_000.0, 500.0),
        _ => return None,
    })
}

/// `CLASSIC_RENT_LADDERS`: Very Low, Low, Average, High.
pub fn classic_ladder(kind: Kind) -> Option<[f64; 4]> {
    Some(match kind {
        Kind::Office => [2_000.0, 5_000.0, 10_000.0, 15_000.0],
        Kind::Condo => [50_000.0, 100_000.0, 150_000.0, 200_000.0],
        Kind::HotelSingle => [500.0, 1_500.0, 2_000.0, 3_000.0],
        Kind::HotelDouble => [800.0, 2_000.0, 3_000.0, 4_500.0],
        Kind::HotelSuite => [1_500.0, 4_000.0, 6_000.0, 9_000.0],
        _ => return None,
    })
}

/// `rentOf(u)`.
pub fn rent_of(kind: Kind, rent: Option<f64>, no_rate: bool) -> f64 {
    if no_rate {
        return 0.0;
    }
    rent.or_else(|| rent_config(kind).map(|c| c.default))
        .unwrap_or(0.0)
}

/// `ECON.addCarCost`: the price of one more elevator car.
pub const ADD_CAR_COST: f64 = 40_000.0;

/// `ECON.transportFloorCost`: the price of one served floor on an elevator,
/// charged per floor of span when the shaft is built and per floor when it
/// is extended.
pub const TRANSPORT_FLOOR_COST: f64 = 5_000.0;

/// What a gutted unit returns when it is sold: nothing.
pub const GUTTED_RESALE_REFUND: f64 = 0.0;

/// `carResaleRefund()`: half the add-car cost, the same half-back rule as
/// `resaleRefund`.
pub fn car_resale_refund() -> f64 {
    (ADD_CAR_COST * 0.5).floor()
}

/// `transportBuildCost(kind, span)`: what `buildTransport` charges, the base
/// price plus `TRANSPORT_FLOOR_COST` for every floor of span on an elevator
/// (a walkway is a flat price).
pub fn transport_build_cost(kind: Kind, span: i64) -> f64 {
    let extra = if kind.is_elevator() {
        span as f64 * TRANSPORT_FLOOR_COST
    } else {
        0.0
    };
    kind.facility().cost + extra
}

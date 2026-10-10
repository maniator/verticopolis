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

/// `ECON.transportFloorCost`: the price of one floor of span (top minus
/// bottom) on an elevator, charged per floor of span when the shaft is built
/// (`transport_build_cost`). The web UI also charges it per floor when a
/// shaft is extended; no engine code does that yet (#914 moves the extend
/// charge into the engine).
pub const TRANSPORT_FLOOR_COST: f64 = 5_000.0;

/// What a gutted unit returns when it is sold: nothing.
pub const GUTTED_RESALE_REFUND: f64 = 0.0;

/// `carResaleRefund()`: half the add-car cost, the same half-back rule as
/// `resaleRefund`.
pub fn car_resale_refund() -> f64 {
    (ADD_CAR_COST * 0.5).floor()
}

/// `transportFloorCost(kind)`: the price one floor of span (top minus
/// bottom) adds to a transport on top of its base cost, `TRANSPORT_FLOOR_COST`
/// on an elevator and nothing on a walkway. The one home for that rule:
/// `transport_build_cost` and the catalog's `floor_cost` both read it.
pub fn transport_floor_cost(kind: Kind) -> f64 {
    if kind.is_elevator() {
        TRANSPORT_FLOOR_COST
    } else {
        0.0
    }
}

/// `transportCostForSpan(kind, span)`: the formula `build_transport`
/// charges, with no check on the span. The build path reads this directly so
/// its affordability check behaves as before for every request (placement
/// then refuses a span it cannot build); frontends quote through
/// `transport_build_cost`.
pub fn transport_cost_for_span(kind: Kind, span: i64) -> f64 {
    let per_floor = transport_floor_cost(kind);
    let extra = if per_floor == 0.0 {
        0.0
    } else {
        span as f64 * per_floor
    };
    kind.facility().cost + extra
}

/// `transportBuildCost(kind, span)`: what `build_transport` charges for a
/// shaft of `span` floors (top minus bottom), as a quote a frontend can show.
/// `f64::NAN` for a placement the engine refuses on span alone: a kind that
/// is not a transport, a span below 1 or above `max_span`, or a fixed-span
/// walkway at any span but its one flight.
pub fn transport_build_cost(kind: Kind, span: i64) -> f64 {
    if !kind.is_transport() || span < 1 || span > kind.max_span() {
        return f64::NAN;
    }
    if kind.is_fixed_span() && span != kind.max_span() {
        return f64::NAN;
    }
    transport_cost_for_span(kind, span)
}

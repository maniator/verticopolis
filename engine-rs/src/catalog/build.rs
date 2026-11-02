use super::*;

/// The catalog for `mode`.
pub fn catalog(mode: GameMode) -> Catalog {
    Catalog {
        version: CATALOG_VERSION,
        mode: mode.as_str(),
        world: World {
            lot_width: LOT_WIDTH,
            min_floor: MIN_FLOOR,
            max_floor: MAX_FLOOR,
            ground_floor: 1,
            ground_floor_structure: ground_floor_structure_kind(Kind::Floor, 1).as_str(),
            lobby_interval: LOBBY_INTERVAL,
        },
        economy: Economy {
            starting_money: STARTING_MONEY,
            add_car_cost: ADD_CAR_COST,
            car_resale_refund: car_resale_refund(),
            transport_floor_cost: TRANSPORT_FLOOR_COST,
            calendars: calendars_for(mode),
            maintenance_per_car_monthly: MAINTENANCE_PER_CAR_MONTHLY,
            overhead_per_unit_monthly: mode.operating_overhead_per_unit(),
            condo_hold_tax_rate: mode.condo_hold_tax_rate(),
            cinema_booking_monthly: CINEMA_BOOKING_MONTHLY,
            cinema_booking_blockbuster_monthly: CINEMA_BOOKING_BLOCKBUSTER,
            nightclub_dj_monthly: NIGHTCLUB_DJ_MONTHLY,
            garbage_collect_hour: GARBAGE_COLLECT_HOUR,
            exterminator: mode
                .infestation_recovery()
                .map(|(callout_fee, per_room_fee)| ExterminatorFees {
                    callout_fee,
                    per_room_fee,
                }),
            auto_bridge_toggleable: mode.bridging_toggleable(),
        },
        pools: POOLED_CAPS
            .iter()
            .zip(POOL_KEYS)
            .map(|(p, key)| PoolEntry {
                key,
                label: p.label,
                cap: p.cap,
                kinds: p.kinds.iter().map(|k| k.as_str()).collect(),
            })
            .collect(),
        facilities: FACILITIES
            .iter()
            .map(|f| facility_entry(mode, f.kind))
            .collect(),
    }
}

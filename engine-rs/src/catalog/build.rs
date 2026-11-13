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
            nightclub_dj_monthly: NIGHTCLUB_DJ_MONTHLY,
            garbage_collect_hour: GARBAGE_COLLECT_HOUR,
            exterminator: mode
                .infestation_recovery()
                .map(|(callout_fee, per_room_fee)| ExterminatorFees {
                    callout_fee,
                    per_room_fee,
                }),
            films: mode.films().offers,
            film_rebooks: mode.films().rebooks,
            film_rebook_default: mode.films().rebook_default,
            cinema_screens: mode.cinema_screens(),
            ticket_prices: mode.ticket_prices(),
            ticket_price_default: mode.ticket_price_default(),
            auto_bridge_toggleable: mode.bridging_toggleable(),
        },
        rules: Rules {
            variant_households: mode.variant_households(),
            preview_names_refusal: mode.preview_names_refusal(),
            schedule_assist: mode.schedule_assist(),
            builds_while_paused: mode.builds_while_paused(),
            exports_to_1994: mode.exports_to_1994(),
            quotes_lobby_distance: mode.quotes_lobby_distance(),
            tall_sky_lobbies: mode.raises_sky_lobbies(),
            decorative_passers_by: mode.shows_passers_by(),
            max_lobby_height: crate::facilities::MAX_LOBBY_HEIGHT,
        },
        pools: keyed_pools(mode)
            .map(|(key, p)| PoolEntry {
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

fn facility_entry(mode: GameMode, kind: Kind) -> FacilityEntry {
    let f = kind.facility();
    let transport = kind.is_transport();
    FacilityEntry {
        key: f.key,
        name: f.name,
        category: f.category.as_str(),
        width: f.width,
        floors: kind.floors(),
        cost: f.cost,
        pays_for_floor: pays_for_floor(kind),
        min_star: f.min_star,
        population: f.population,
        max_household: kind.has_household().then_some(MAX_HOUSEHOLD),
        attendance: f.attendance,
        modern_only: f.modern_only,
        transport,
        staff_only: f.staff_only,
        basement: f.basement,
        no_basement: no_basement(kind),
        available: f.available_in(mode),
        build_minutes: if transport { 0.0 } else { kind.build_minutes() },
        resale_refund: kind.resale_refund(),
        build_cap: build_cap(kind),
        pool: pool_key(mode, kind),
        max_span: transport.then(|| kind.max_span()),
        fixed_span: kind.is_fixed_span(),
        max_cars: kind.is_elevator().then(|| kind.max_cars()),
        car_capacity: transport.then(|| kind.car_capacity()),
        subtypes: kind.subtype_list().map(|l| l.to_vec()),
        rent: rent_for(mode, kind),
        daily_income: commercial_daily_income(mode, kind),
        spend_per_customer: catalog_spend_per_customer(mode, kind),
        upkeep_monthly: service_maintenance_monthly(kind),
        open_hours: kind
            .has_business_hours()
            .then(|| (0..24).map(|hour| kind.is_open_at(hour)).collect()),
        own_household: kind.has_household(),
        commercial: kind.is_commercial(),
        hotel: kind.is_hotel(),
        lease_amenity: kind.is_lease_amenity(),
        unmet_demand: kind.is_unmet_demand_kind(),
        halo: halo::halo_entry(mode, kind),
        noise: noise::noise_entries(mode, kind),
    }
}

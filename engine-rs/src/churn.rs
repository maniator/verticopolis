//! Port of `sim/churn.ts`: vacate, move-ins, names, relocations.

use crate::demand::fold_origin_demand;
use crate::econ::{classic_ladder, rent_config, rent_of};
use crate::facilities::Kind;
use crate::jsmath;
use crate::rent::snap_to_ladder;
use crate::satisfaction::{vacate_reason_text, SatisfactionContext, VACATE_NOTICE_MINUTES};
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::UnitState;

use crate::rules::CLASSIC_HOUSEHOLD;

/// `CongestionBindingClass` (sim/gripe.ts): the transport class whose shaft
/// binds a floor's congestion reading; `Walkways` is the stairs-and-escalators
/// tie, `None` the transportless defensive case.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CongestionBindingClass {
    Elevator,
    Stairs,
    Escalator,
    Walkways,
    None,
}

/// `BINDING_TIE_EPS`: two ratios within this band count as tied.
const BINDING_TIE_EPS: f64 = 1e-9;

pub const HOUSEHOLD_SIZES: [i64; 4] = [2, 3, 4, 5];
const HOUSEHOLD_WEIGHTS: [i64; 4] = [4, 6, 2, 1];

/// `householdPrice`.
pub fn household_price(base: f64, residents: Option<i64>) -> f64 {
    match residents {
        None => base,
        Some(r) => jsmath::round((base * r as f64) / CLASSIC_HOUSEHOLD),
    }
}

/// `rollHousehold`.
pub fn roll_household(rng: &mut crate::rng::Rng) -> i64 {
    let total: i64 = HOUSEHOLD_WEIGHTS.iter().sum();
    let mut roll = rng.int(1, total);
    for i in 0..HOUSEHOLD_SIZES.len() {
        roll -= HOUSEHOLD_WEIGHTS[i];
        if roll <= 0 {
            return HOUSEHOLD_SIZES[i];
        }
    }
    3
}

impl Simulation {
    /// `servingTransportKindsAt(floor)`: (elevator, stairs, escalator), the
    /// passenger kinds with a shaft stopping at the floor; staff-only
    /// service elevators never count.
    pub fn serving_transport_kinds_at(&self, floor: i64) -> (bool, bool, bool) {
        let mut kinds = (false, false, false);
        for t in &self.tower.transports {
            if t.kind.is_staff_only_transport() || !t.stops_at(floor) {
                continue;
            }
            if t.kind.is_elevator() {
                kinds.0 = true;
            } else if t.kind == Kind::Stairs {
                kinds.1 = true;
            } else if t.kind == Kind::Escalator {
                kinds.2 = true;
            }
        }
        kinds
    }

    /// `bindingTransportClassAt(floor)`: the class that binds the floor's
    /// congestion reading, from the spatial model's own attribution. A
    /// walkway flips the wording only when strictly worse than every serving
    /// elevator beyond `BINDING_TIE_EPS`; two tied walkway kinds that both
    /// clear the band read as the combined class. A floor without an
    /// attribution entry, or with every class at 0, falls back to the
    /// serving-kinds classification.
    pub fn binding_transport_class_at(&self, floor: i64) -> CongestionBindingClass {
        if let Some(att) = self.spatial_congestion_attribution_by_floor().get(&floor) {
            let walk_max = att.stairs.max(att.escalator);
            if walk_max > att.elevator + BINDING_TIE_EPS {
                let stairs_bind = att.stairs > att.elevator + BINDING_TIE_EPS;
                let escalator_bind = att.escalator > att.elevator + BINDING_TIE_EPS;
                if stairs_bind
                    && escalator_bind
                    && (att.stairs - att.escalator).abs() <= BINDING_TIE_EPS
                {
                    return CongestionBindingClass::Walkways;
                }
                return if att.stairs >= att.escalator {
                    CongestionBindingClass::Stairs
                } else {
                    CongestionBindingClass::Escalator
                };
            }
            if att.elevator > 0.0 {
                return CongestionBindingClass::Elevator;
            }
        }
        match self.serving_transport_kinds_at(floor) {
            (true, _, _) => CongestionBindingClass::Elevator,
            (false, true, true) => CongestionBindingClass::Walkways,
            (false, true, false) => CongestionBindingClass::Stairs,
            (false, false, true) => CongestionBindingClass::Escalator,
            (false, false, false) => CongestionBindingClass::None,
        }
    }

    /// `congestionChurnNote(floor)`: the buy-back line's note naming the
    /// transport that binds the floor's reading, with the lever that clears it.
    fn congestion_churn_note(&self, floor: i64) -> String {
        let binding = self.binding_transport_class_at(floor);
        let noun = match binding {
            CongestionBindingClass::Elevator => "elevators",
            CongestionBindingClass::Walkways => "stairs and escalators",
            CongestionBindingClass::Stairs => "stairs",
            CongestionBindingClass::Escalator => "escalators",
            CongestionBindingClass::None => "vertical transport",
        };
        let lever = if binding == CongestionBindingClass::Elevator {
            "add cars"
        } else {
            "add capacity"
        };
        format!(" A new owner will buy in, but the crowded {noun} will wear them down too until you {lever}.")
    }

    /// `rerollSubtype(id)`: a fresh canon subtype drawn off the current one
    /// (from the list minus the current entry, so no rejection sampling), or
    /// from the whole list when the unit has none; `None` for a unit without
    /// a subtype list of at least two.
    pub fn reroll_subtype(&mut self, id: i64) -> Option<&'static str> {
        let (kind, current) = {
            let u = self.tower.get_unit(id)?;
            (u.kind, u.subtype)
        };
        let list = kind.subtype_list()?;
        if list.len() < 2 {
            return None;
        }
        let current_idx = current.and_then(|c| list.iter().position(|&s| s == c));
        let idx = match current_idx {
            None => self.rng.int(0, list.len() as i64 - 1) as usize,
            Some(cur) => {
                let mut i = self.rng.int(0, list.len() as i64 - 2) as usize;
                if i >= cur {
                    i += 1;
                }
                i
            }
        };
        let next = list[idx];
        self.tower.get_unit_mut(id)?.subtype = Some(next);
        self.tower.bump_meal_overlay_revision();
        Some(next)
    }

    /// `vacate(u, reason)` on the unit at index `i`.
    pub fn vacate(&mut self, i: usize, reason: &'static str) {
        let (kind, floor, ever_occupied, rent, residents, no_rate) = {
            let u = &self.tower.units[i];
            (
                u.kind,
                u.floor,
                u.ever_occupied,
                u.rent,
                u.residents,
                u.no_rate,
            )
        };
        // The congestion note's binding class is read before the unit
        // empties below, as the TypeScript does: the departing tenant's own
        // load is part of what bound the floor's reading. Gated on the
        // conditions the emit needs (only a bought-back sold condo on the
        // market carries the note), so no other eviction pays the map build.
        let cong_note =
            if reason == "congestion" && kind == Kind::Condo && ever_occupied && !no_rate {
                self.congestion_churn_note(floor)
            } else {
                String::new()
            };
        let mut buyback = 0.0;
        if kind == Kind::Condo && ever_occupied {
            let sale_price = rent.unwrap_or_else(|| rent_config(Kind::Condo).unwrap().default);
            buyback = household_price(sale_price, residents);
            self.money -= buyback;
            self.record_money("condos", -buyback);
        }
        let modern = self.mode.is_modern();
        let u = &mut self.tower.units[i];
        u.state = UnitState::Empty;
        u.occupants = 0;
        if !kind.is_hotel() {
            u.ever_occupied = false;
        }
        u.residents = None;
        if kind == Kind::Condo {
            if let Some(r) = u.rent {
                u.rent = Some(if modern {
                    let band = rent_config(Kind::Condo).unwrap();
                    r.min(band.max).max(band.min)
                } else {
                    snap_to_ladder(&classic_ladder(Kind::Condo).unwrap(), r)
                });
            }
        }
        u.label = kind.facility().name.to_string();
        u.vacate_reason = None;
        u.vacate_at = None;
        let name = kind.facility().name;
        // The trailing note asks the move-in gate directly, on the emptied
        // unit: a No Rate unit stays off the market, a unit the gate still
        // holds stays empty until the cause is fixed, and only a unit that
        // re-sells carries the congestion churn note.
        let buyback_note = if buyback > 0.0 {
            if no_rate {
                " It is off the market (No Rate); set a rate to sell it again.".to_string()
            } else {
                let probe = self.tower.units[i].clone();
                let mut ctx = self.build_satisfaction_context(true);
                if self.would_evict_fresh_tenant(&probe, &mut ctx) {
                    " It stays empty until you fix the cause.".to_string()
                } else {
                    cong_note
                }
            }
        } else {
            String::new()
        };
        let msg = if buyback > 0.0 {
            format!(
                "The owner left {} on {} ({}). You bought it back for ${}.{}",
                name,
                self.floor_label(floor),
                vacate_reason_text(reason),
                with_thousands(buyback),
                buyback_note
            )
        } else {
            format!(
                "A tenant left {} on {} ({}).",
                name,
                self.floor_label(floor),
                vacate_reason_text(reason)
            )
        };
        self.emit(&msg, LogKind::Bad);
    }

    /// `attemptMoveIns`.
    pub fn attempt_move_ins(&mut self) {
        let weekend = self.clock.is_weekend();
        let parking_penalty = if self.office_parking_short() {
            0.5
        } else {
            1.0
        };
        let served_set = self.tower.served_floors();
        let mut reach_memo: std::collections::HashMap<i64, bool> = std::collections::HashMap::new();
        let mut sat_ctx: Option<SatisfactionContext> = None;
        let evening = self.clock.is_evening();
        for i in self.tower.room_indices() {
            let u = self.tower.units[i].clone();
            if u.state != UnitState::Empty || u.no_rate {
                continue;
            }
            let f = u.kind.facility();
            if f.population == 0 && !u.kind.is_hotel() {
                continue;
            }
            if !served_set.contains(&u.floor) {
                continue;
            }
            let key = self.tower.seg_at(u.floor, Some(u.x as f64));
            let reachable = match reach_memo.get(&key) {
                Some(&h) => h,
                None => {
                    let h = self.position_reachable(u.floor, u.x);
                    reach_memo.insert(key, h);
                    h
                }
            };
            if !reachable {
                continue;
            }
            if u.kind == Kind::Condo
                || u.kind == Kind::Office
                || u.kind.is_lease_amenity()
                || u.kind.is_rental()
            {
                if sat_ctx.is_none() {
                    sat_ctx = Some(self.build_satisfaction_context(true));
                }
                if self.would_evict_fresh_tenant(&u, sat_ctx.as_mut().unwrap()) {
                    continue;
                }
            }
            let demand = self.demand_factor(&u);
            let mut filled = false;
            match u.kind {
                Kind::Office => {
                    if !weekend && self.rng.chance(0.25 * demand * parking_penalty) {
                        filled = true;
                    }
                }
                Kind::Condo => {
                    if self.rng.chance(0.18 * demand) {
                        filled = true;
                    }
                }
                Kind::FitnessClub | Kind::Clinic => {
                    if self.rng.chance(0.22 * demand) {
                        self.move_in(i);
                        if u.kind == Kind::FitnessClub {
                            if let Some(ctx) = sat_ctx.as_mut() {
                                if served_set.contains(&u.floor) {
                                    ctx.club_floors.push(u.floor);
                                }
                            }
                        }
                    }
                }
                Kind::RentalStudio | Kind::RentalApartment => {
                    let fill_rate = if u.kind == Kind::RentalStudio {
                        0.22
                    } else {
                        0.16
                    };
                    if self.rng.chance(fill_rate * demand) {
                        filled = true;
                    }
                }
                k if k.is_hotel() => {
                    if evening && self.rng.chance(0.5 * demand) {
                        let w = &mut self.tower.units[i];
                        w.state = UnitState::Asleep;
                        w.ever_occupied = true;
                        self.move_ins_today.rooms += 1;
                        if let Some(ctx) = sat_ctx.as_mut() {
                            if let Some(dm) = ctx.demand_map.as_mut() {
                                let w = self.tower.units[i].clone();
                                fold_origin_demand(dm, self, &w);
                            }
                        }
                    }
                }
                _ => {}
            }
            if filled {
                self.move_in(i);
                if let Some(ctx) = sat_ctx.as_mut() {
                    if let Some(dm) = ctx.demand_map.as_mut() {
                        let w = self.tower.units[i].clone();
                        fold_origin_demand(dm, self, &w);
                    }
                }
            }
        }
    }

    /// `moveIn(u)`.
    pub fn move_in(&mut self, i: usize) {
        let kind = self.tower.units[i].kind;
        {
            let u = &mut self.tower.units[i];
            u.state = UnitState::Occupied;
            u.satisfaction = 1.0;
            u.vacate_reason = None;
            u.vacate_at = None;
        }
        if kind == Kind::Condo && !self.tower.units[i].ever_occupied {
            let asking = {
                let u = &self.tower.units[i];
                rent_of(u.kind, u.rent, u.no_rate)
            };
            let (price, residents) = if self.mode.has_variant_households() {
                let r = roll_household(&mut self.rng);
                (household_price(asking, Some(r)), Some(r))
            } else {
                (asking, None)
            };
            let floor = self.tower.units[i].floor;
            let u = &mut self.tower.units[i];
            u.ever_occupied = true;
            if residents.is_some() {
                u.residents = residents;
            }
            u.rent = Some(asking);
            self.money += price;
            self.record_money("condos", price);
            self.move_ins_today.condos += 1;
            let who = match residents {
                Some(r) => format!(" to a household of {r}"),
                None => String::new(),
            };
            let msg = format!(
                "Condominium on {} sold{} for ${}.",
                self.floor_label(floor),
                who,
                with_thousands(price)
            );
            self.emit(&msg, LogKind::Money);
        }
        match kind {
            Kind::Office => {
                let name = self.company_name();
                let u = &mut self.tower.units[i];
                u.ever_occupied = true;
                u.label = name;
                self.move_ins_today.offices += 1;
            }
            Kind::FitnessClub => {
                let name = self.gym_name();
                let u = &mut self.tower.units[i];
                u.ever_occupied = true;
                u.label = name;
                self.move_ins_today.fitness += 1;
            }
            Kind::Clinic => {
                let name = self.clinic_name();
                let u = &mut self.tower.units[i];
                u.ever_occupied = true;
                u.label = name;
                self.move_ins_today.clinic += 1;
            }
            Kind::RentalStudio | Kind::RentalApartment => {
                let residents = if kind == Kind::RentalApartment {
                    Some(roll_household(&mut self.rng))
                } else {
                    None
                };
                let u = &mut self.tower.units[i];
                u.ever_occupied = true;
                if residents.is_some() {
                    u.residents = residents;
                }
                self.move_ins_today.rentals += 1;
            }
            _ => {}
        }
    }

    pub fn company_name(&mut self) -> String {
        const A: [&str; 10] = [
            "Apex", "Nimbus", "Vertex", "Cobalt", "Atlas", "Orion", "Pioneer", "Summit", "Delta",
            "Vista",
        ];
        const B: [&str; 8] = [
            "Holdings",
            "Systems",
            "Partners",
            "Industries",
            "Group",
            "Labs",
            "Trading",
            "Capital",
        ];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
    }

    pub fn gym_name(&mut self) -> String {
        const A: [&str; 10] = [
            "Ironworks",
            "Summit",
            "Pulse",
            "Apex",
            "Vertex",
            "Kinetic",
            "Anvil",
            "Ascend",
            "Cobalt",
            "Momentum",
        ];
        const B: [&str; 6] = [
            "Fitness",
            "Athletic Club",
            "Gym",
            "Strength",
            "Studio",
            "Wellness",
        ];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
    }

    pub fn clinic_name(&mut self) -> String {
        const A: [&str; 10] = [
            "Cedar",
            "Riverside",
            "Parkview",
            "Meridian",
            "Grove",
            "Harbor",
            "Summit",
            "Bayside",
            "Elm",
            "Crestview",
        ];
        const B: [&str; 6] = [
            "Clinic",
            "Health",
            "Medical",
            "Care",
            "Wellness Center",
            "Practice",
        ];
        let a = *self.rng.pick(&A);
        let b = *self.rng.pick(&B);
        format!("{a} {b}")
    }

    /// `rollCondoRelocations` (Modern only).
    pub fn roll_condo_relocations(&mut self) {
        let days = (VACATE_NOTICE_MINUTES / (24.0 * 60.0)).ceil();
        let scale = self.clock.calendar.maint_period_days as f64 / 30.0;
        for i in 0..self.tower.units.len() {
            let (kind, state, ever_occupied, residents, floor) = {
                let u = &self.tower.units[i];
                (u.kind, u.state, u.ever_occupied, u.residents, u.floor)
            };
            if kind != Kind::Condo || state != UnitState::Occupied || !ever_occupied {
                continue;
            }
            let chance = self.mode.condo_relocation_chance(residents) * scale;
            if chance <= 0.0 || !self.rng.chance(chance) {
                continue;
            }
            let u = &mut self.tower.units[i];
            u.state = UnitState::Vacating;
            u.vacate_reason = Some("relocation");
            u.vacate_at = Some(self.clock.minutes + VACATE_NOTICE_MINUTES);
            let msg = format!(
                "A household in Condominium on {} is relocating. They leave in under {} day(s); you buy the unit back and re-list it.",
                self.floor_label(floor),
                days
            );
            self.emit(&msg, LogKind::Bad);
        }
    }

    /// `reportMoveIns`.
    pub fn report_move_ins(&mut self) {
        let m = self.move_ins_today;
        let mut parts: Vec<String> = Vec::new();
        if m.offices > 0 {
            parts.push(format!(
                "{} office{} leased",
                m.offices,
                if m.offices > 1 { "s" } else { "" }
            ));
        }
        if m.condos > 0 {
            parts.push(format!(
                "{} condo{} sold",
                m.condos,
                if m.condos > 1 { "s" } else { "" }
            ));
        }
        if m.rooms > 0 {
            parts.push(format!(
                "{} hotel room{} booked",
                m.rooms,
                if m.rooms > 1 { "s" } else { "" }
            ));
        }
        if m.fitness > 0 {
            parts.push(format!(
                "{} fitness club{} leased",
                m.fitness,
                if m.fitness > 1 { "s" } else { "" }
            ));
        }
        if m.clinic > 0 {
            parts.push(format!(
                "{} clinic{} leased",
                m.clinic,
                if m.clinic > 1 { "s" } else { "" }
            ));
        }
        if m.rentals > 0 {
            parts.push(format!(
                "{} rental{} leased",
                m.rentals,
                if m.rentals > 1 { "s" } else { "" }
            ));
        }
        if !parts.is_empty() {
            self.emit(
                &format!("New tenants: {}.", parts.join(", ")),
                LogKind::Good,
            );
        }
        self.move_ins_today = Default::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameMode;
    use crate::facilities::LOT_WIDTH;

    const C: i64 = LOT_WIDTH / 2;

    /// `servedTower` (moveInGateHelpers.ts) with floors 2..6: a full lobby
    /// row, floor slabs, and a center standard elevator with 8 cars.
    fn served_tower(seed: u32) -> Simulation {
        served_tower_in(seed, GameMode::Modern)
    }

    fn served_tower_in(seed: u32, mode: GameMode) -> Simulation {
        let mut sim = Simulation::new_game(seed, mode);
        sim.money = 1e12;
        sim.star = 1;
        for x in 0..LOT_WIDTH {
            sim.tower.place(Kind::Lobby, 1, x);
        }
        for f in 2..=6 {
            for x in 0..LOT_WIDTH {
                sim.tower.place(Kind::Floor, f, x);
            }
        }
        assert!(sim.build_transport(Kind::ElevatorStandard, C, 1, 6).ok);
        let id = sim.tower.transports[0].id;
        assert!(sim.tower.set_cars(id, 8));
        sim
    }

    /// A sold three-person household at $160,000, the way the TypeScript
    /// suite seats one; returns the unit's index.
    fn seat_owner(sim: &mut Simulation, floor: i64, x: i64, no_rate: bool) -> usize {
        let r = sim.tower.place(Kind::Condo, floor, x);
        assert!(r.ok, "{:?}", r.reason);
        let id = r.unit_id.unwrap();
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Occupied;
        u.ever_occupied = true;
        u.residents = Some(3);
        u.rent = Some(160_000.0);
        u.no_rate = no_rate;
        sim.tower.units.iter().position(|u| u.id == id).unwrap()
    }

    fn last_line(sim: &Simulation) -> &str {
        &sim.log.last().unwrap().text
    }

    /// An unsold condo on floor 2 asking `asking`, ready for `move_in`;
    /// returns the unit's index.
    fn unsold_condo(sim: &mut Simulation, asking: f64) -> usize {
        let r = sim.tower.place(Kind::Condo, 2, C);
        assert!(r.ok, "{:?}", r.reason);
        let id = r.unit_id.unwrap();
        let u = sim.tower.get_unit_mut(id).unwrap();
        u.state = UnitState::Empty;
        u.rent = Some(asking);
        sim.tower.units.iter().position(|u| u.id == id).unwrap()
    }

    #[test]
    fn the_condo_sale_line_matches_the_typescript_wording() {
        // Classic sells at the flat asking price and names no household.
        let mut sim = served_tower_in(30, GameMode::Classic);
        let i = unsold_condo(&mut sim, 150_000.0);
        sim.move_in(i);
        assert_eq!(last_line(&sim), "Condominium on floor 2 sold for $150,000.");
        // Modern rolls a household and scales the price by its size over 3.
        let mut sim = served_tower(31);
        let i = unsold_condo(&mut sim, 160_000.0);
        sim.move_in(i);
        let residents = sim.tower.units[i]
            .residents
            .expect("a Modern sale rolls a household");
        let price = match residents {
            2 => "106,667",
            3 => "160,000",
            4 => "213,333",
            5 => "266,667",
            r => panic!("household of {r}"),
        };
        assert_eq!(
            last_line(&sim),
            format!("Condominium on floor 2 sold to a household of {residents} for ${price}.")
        );
    }

    #[test]
    fn the_buy_back_note_follows_the_gate_verdict() {
        // A live structural drain (an office beside the condo): the gate holds
        // the spot, so every reason reads "stays empty", a congestion one too.
        let mut sim = served_tower(20);
        assert!(sim.tower.place(Kind::Office, 2, C - 9).ok);
        let i = seat_owner(&mut sim, 2, C, false);
        sim.vacate(i, "congestion");
        assert_eq!(
            last_line(&sim),
            "The owner left Condominium on floor 2 (overcrowded vertical transport). You bought it back for $160,000. It stays empty until you fix the cause."
        );
        // No drain: a congestion eviction re-sells, and the note names the
        // elevator and its lever.
        let mut sim = served_tower(22);
        let i = seat_owner(&mut sim, 2, C, false);
        sim.vacate(i, "congestion");
        assert_eq!(
            last_line(&sim),
            "The owner left Condominium on floor 2 (overcrowded vertical transport). You bought it back for $160,000. A new owner will buy in, but the crowded elevators will wear them down too until you add cars."
        );
        // A relocation onto a clean spot carries no caveat.
        let mut sim = served_tower(23);
        let i = seat_owner(&mut sim, 2, C, false);
        sim.vacate(i, "relocation");
        assert_eq!(
            last_line(&sim),
            "The owner left Condominium on floor 2 (the household is relocating). You bought it back for $160,000."
        );
        // A No Rate owned condo points at the rate, whatever the gate says.
        let mut sim = served_tower(25);
        let i = seat_owner(&mut sim, 2, C, true);
        sim.vacate(i, "noise");
        assert_eq!(
            last_line(&sim),
            "The owner left Condominium on floor 2 (a noisy neighbor nearby). You bought it back for $160,000. It is off the market (No Rate); set a rate to sell it again."
        );
        // A never-sold condo and any other kind get the plain line.
        let mut sim = served_tower(26);
        let r = sim.tower.place(Kind::Office, 2, C);
        let i = sim
            .tower
            .units
            .iter()
            .position(|u| u.id == r.unit_id.unwrap())
            .unwrap();
        sim.tower.units[i].state = UnitState::Occupied;
        sim.vacate(i, "rent");
        assert_eq!(
            last_line(&sim),
            "A tenant left Office on floor 2 (rent set too high)."
        );
    }

    #[test]
    fn the_congestion_note_names_the_binding_transport() {
        // A stairs-only floor: the note names the stairs and the capacity lever.
        let mut sim = Simulation::new_game(26, GameMode::Modern);
        sim.money = 1e12;
        sim.star = 1;
        for x in 0..LOT_WIDTH {
            sim.tower.place(Kind::Lobby, 1, x);
            sim.tower.place(Kind::Floor, 2, x);
        }
        assert!(sim.build_transport(Kind::Stairs, C, 1, 2).ok);
        assert_eq!(
            sim.binding_transport_class_at(2),
            CongestionBindingClass::Stairs
        );
        let i = seat_owner(&mut sim, 2, C, false);
        sim.vacate(i, "congestion");
        assert!(
            last_line(&sim).ends_with(" A new owner will buy in, but the crowded stairs will wear them down too until you add capacity."),
            "{}",
            last_line(&sim)
        );

        // A mixed floor whose stair chain continues to a populated stairs-only
        // floor 3: the 2-3 link binds floor 2's reading past the healthy
        // elevator (#701), so the note names the stairs.
        let mut sim = Simulation::new_game(27, GameMode::Modern);
        sim.money = 1e12;
        sim.star = 1;
        for x in 0..LOT_WIDTH {
            sim.tower.place(Kind::Lobby, 1, x);
            sim.tower.place(Kind::Floor, 2, x);
            sim.tower.place(Kind::Floor, 3, x);
        }
        assert!(sim.build_transport(Kind::ElevatorStandard, C + 20, 1, 2).ok);
        assert!(sim.build_transport(Kind::Stairs, C, 1, 2).ok);
        assert!(sim.build_transport(Kind::Stairs, C, 2, 3).ok);
        for x in [C - 30, C - 21, C - 12] {
            let r = sim.tower.place(Kind::Office, 3, x);
            assert!(r.ok, "{:?}", r.reason);
            sim.tower.get_unit_mut(r.unit_id.unwrap()).unwrap().state = UnitState::Occupied;
        }
        let i = seat_owner(&mut sim, 2, C + 40, false);
        assert_eq!(
            sim.binding_transport_class_at(2),
            CongestionBindingClass::Stairs
        );
        sim.vacate(i, "congestion");
        assert!(
            last_line(&sim).contains("crowded stairs"),
            "{}",
            last_line(&sim)
        );
        assert!(last_line(&sim).ends_with("until you add capacity."));

        // An unpopulated floor has no attribution entry and falls back to the
        // serving kinds; a floor no passenger transport stops at reads none.
        let sim = served_tower(28);
        assert_eq!(
            sim.binding_transport_class_at(2),
            CongestionBindingClass::Elevator
        );
        assert_eq!(
            sim.binding_transport_class_at(9),
            CongestionBindingClass::None
        );
    }
}

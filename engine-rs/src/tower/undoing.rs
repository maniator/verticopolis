//! What a tower needs to apply an undo step (`sim_undo.rs`): the facts of a
//! unit or a shaft that an edit owns, which a step puts back while leaving
//! the live state the simulation moved (occupants, car positions), and the
//! insertions that put removed units and shafts back where they stood.
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use super::*;

impl Unit {
    /// Whether the facts an edit owns are the same: the price, the market
    /// flag, the name, the variety and the film policy.
    pub(crate) fn config_eq(&self, other: &Unit) -> bool {
        self.rent == other.rent
            && self.no_rate == other.no_rate
            && self.label == other.label
            && self.subtype == other.subtype
            && self.extras().film_policy == other.extras().film_policy
    }

    /// The unit as a step puts it back: its record, less the people counts
    /// nobody is left to settle. The customers and diners inside it left
    /// with it, so their counts start empty, and a venue's attendance is
    /// read again from them, as a load does (`load/reader.rs`).
    pub(crate) fn returning(&self) -> Unit {
        let counted = self.kind.attendance_cap().is_some() || self.kind.is_structural();
        Unit {
            customers_in: None,
            hotel_customers_in: None,
            out_for_meal: None,
            occupants: if counted { 0 } else { self.occupants },
            ..self.clone()
        }
    }

    /// This unit, with the facts an edit owns (the price, the market flag,
    /// the name, the variety and the film policy) taken from `found`: the
    /// unit as it leaves a gesture that changed those facts first, which an
    /// undo of the gesture puts back.
    pub(crate) fn with_edit_facts_of(&self, found: &Unit) -> Unit {
        let mut u = Unit {
            label: found.label.clone(),
            subtype: found.subtype,
            ..self.clone()
        };
        // A condo that sold keeps the price it sold at, which no edit can
        // change any more.
        let sold_condo = self.kind == Kind::Condo && self.ever_occupied;
        if !sold_condo {
            u.take_price_and_policy_from(found);
        }
        u
    }

    /// Put the price, the market flag and the film policy back from `other`.
    /// The name and the variety go through the tower's setters
    /// ([`Tower::put_unit_config`]), which log a change.
    fn take_price_and_policy_from(&mut self, other: &Unit) {
        self.rent = other.rent;
        self.no_rate = other.no_rate;
        let policy = other.extras().film_policy;
        if self.extras().film_policy != policy {
            self.extras_mut().film_policy = policy;
        }
    }
}

impl Transport {
    /// Whether this shaft and `other` would share a column on some floor, by
    /// the rule a placement follows (`Tower::validate_transport`): two
    /// flights of stairs or escalators may meet end to end.
    pub(crate) fn clashes_with(&self, other: &Transport) -> bool {
        let floors = self.bottom <= other.top && other.bottom <= self.top;
        let columns = self.x < other.x + other.width && other.x < self.x + self.width;
        let end_to_end = self.kind.is_fixed_span()
            && other.kind.is_fixed_span()
            && self.x == other.x
            && self.width == other.width
            && (self.bottom == other.top || self.top == other.bottom);
        floors && columns && !end_to_end
    }

    /// Whether the facts an edit owns are the same: the span, the cars, the
    /// stops and the schedule.
    pub(crate) fn config_eq(&self, other: &Transport) -> bool {
        self.bottom == other.bottom
            && self.top == other.top
            && self.cars == other.cars
            && self.skip_floors == other.skip_floors
            && self.schedule == other.schedule
    }

    /// Put the facts an edit owns back from `other`. The cars on the shaft
    /// stay where they are; a fleet that grows gets its new cars at the
    /// bottom, as buying one does, and one that shrinks loses the last ones.
    pub(crate) fn take_config_from(&mut self, other: &Transport) {
        self.bottom = other.bottom;
        self.top = other.top;
        self.skip_floors.clone_from(&other.skip_floors);
        self.schedule.clone_from(&other.schedule);
        let cars = other.cars as usize;
        if self.cars != other.cars {
            self.car_positions.resize(cars, other.bottom as f64);
            self.car_dir.resize(cars, 1);
            if let Some(load) = &mut self.car_load {
                load.resize(cars, 0.0);
            }
            self.cars = other.cars;
        }
        for p in self.car_positions.iter_mut() {
            *p = p.min(other.top as f64).max(other.bottom as f64);
        }
    }
}

impl Tower {
    /// Whether the tiles `u` covers are free on its layer (the rooms, or the
    /// floors and lobbies under them), a tile held by a unit `leaving` names
    /// counting as free.
    pub(crate) fn tiles_free_for(&self, u: &Unit, leaving: impl Fn(i64) -> bool) -> bool {
        let layer = if u.kind.is_structural() {
            &self.structure
        } else {
            &self.rooms
        };
        (u.floor..u.floor + u.kind.floors()).all(|floor| {
            (u.x..u.x + u.width).all(|x| layer.get(&(floor, x)).is_none_or(|&id| leaving(id)))
        })
    }

    /// Put the facts an edit owns back on unit `id` from `want`.
    pub(crate) fn put_unit_config(&mut self, id: i64, want: &Unit) {
        let Some(&i) = self.by_id.get(&id) else {
            return;
        };
        self.units[i].take_price_and_policy_from(want);
        self.set_unit_label_at(i, want.label.clone());
        self.set_unit_subtype(id, want.subtype);
    }

    /// Put units back in the list, each at its index `at` in the list they
    /// leave (or the end, when the list is shorter), as placing them would
    /// register them. One pass merges them in and one reindex follows, so a
    /// step that returns a whole row costs one walk of the list.
    pub(crate) fn insert_units_at(&mut self, mut inserts: Vec<(usize, Unit)>) {
        if inserts.is_empty() {
            return;
        }
        inserts.sort_by_key(|&(at, _)| at);
        let first = inserts[0].0.min(self.units.len());
        let total = self.units.len() + inserts.len();
        // The same headroom rule as a placement (#1259).
        if total > self.units.capacity() {
            let more = (total - self.units.len()).max((self.units.len() / 4).max(64));
            self.units.reserve_exact(more);
        }
        // A floor that gains its first lobby tile stops the express shafts
        // that span it, as a placement does.
        let mut new_lobby_floors: Vec<i64> = Vec::new();
        for (_, u) in &inserts {
            if u.kind == Kind::Lobby
                && !self.floor_has_lobby(u.floor)
                && !new_lobby_floors.contains(&u.floor)
            {
                new_lobby_floors.push(u.floor);
            }
        }
        let mut tail = self.units.split_off(first).into_iter();
        let mut placed = Vec::with_capacity(inserts.len());
        for (at, unit) in inserts {
            while self.units.len() < at {
                let Some(u) = tail.next() else {
                    break;
                };
                self.units.push(u);
            }
            placed.push(self.units.len());
            self.units.push(unit);
        }
        self.units.extend(tail);
        self.reindex_from(first);
        for &i in &placed {
            self.register(i);
            if self.units[i].kind == Kind::WeddingHall {
                self.built_wedding_hall = Some(true);
            }
        }
        for floor in new_lobby_floors {
            self.sync_express_stops_for_floor(floor);
        }
        self.revision += placed.len() as i64;
    }

    /// Put a shaft back in the list at index `at` (or the end).
    pub(crate) fn insert_transport_at(&mut self, at: usize, transport: Transport) {
        let at = at.min(self.transports.len());
        self.transports.insert(at, transport);
        self.reindex_transports();
        self.revision += 1;
    }
}

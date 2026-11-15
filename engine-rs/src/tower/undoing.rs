//! What a tower needs to apply an undo step (`sim_undo.rs`): the facts of a
//! unit or a shaft that an edit owns, which a step puts back while leaving
//! the live state the simulation moved (occupants, car positions), and the
//! insertions that put removed units and shafts back where they stood.
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use super::*;
use crate::economy::screens::{put_screen_policies, screen_policies};
use crate::undo::{puts_back, UnitFacts};

impl Unit {
    /// Whether the facts an edit owns are the same: the price, the market
    /// flag, the name, the variety, each screen's film policy and the ticket
    /// price.
    pub(crate) fn config_eq(&self, other: &Unit) -> bool {
        self.rent == other.rent
            && self.no_rate == other.no_rate
            && self.label == other.label
            && self.subtype == other.subtype
            && screen_policies(self) == screen_policies(other)
            && self.extras().ticket_price == other.extras().ticket_price
    }

    /// The unit as a step puts it back: its record, less the people counts
    /// nobody is left to settle. The customers and diners inside it left
    /// with it, so their counts start empty, and a venue's attendance is
    /// read again from them, as a load does (`load/reader.rs`).
    pub(crate) fn returning(&self) -> Unit {
        let counted = self.kind.counts_visitors() || self.kind.is_structural();
        Unit {
            customers_in: None,
            hotel_customers_in: None,
            staff_in: 0,
            out_for_meal: None,
            occupants: if counted { 0 } else { self.occupants },
            ..self.clone()
        }
    }

    /// This unit, with the facts an edit owns (the price, the market flag,
    /// the name, the variety, each screen's film policy and the ticket price) taken
    /// from `found`: the unit as it leaves a gesture that changed those facts
    /// first, which an undo of the gesture puts back.
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

    /// Put the price, the market flag, each screen's film policy and the ticket price
    /// back from `other`.
    /// The name and the variety go through the tower's setters
    /// ([`Tower::put_unit_config`]), which log a change.
    fn take_price_and_policy_from(&mut self, other: &Unit) {
        self.rent = other.rent;
        self.no_rate = other.no_rate;
        let policies = screen_policies(other);
        if screen_policies(self) != policies {
            put_screen_policies(self, policies);
        }
        let price = other.extras().ticket_price;
        if self.extras().ticket_price != price {
            self.extras_mut().ticket_price = price;
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

    /// The shaft as a step puts it back: its record, with the cars standing
    /// empty where a new shaft's stand (`Tower::place_transport`). The people
    /// who rode it left with it, and the dispatch forgot its cars, so no car
    /// comes back with a load or under way. Its rides stay: they record use.
    pub(crate) fn returning(&self) -> Transport {
        Transport {
            car_positions: (0..self.cars).map(|i| (self.bottom + i) as f64).collect(),
            car_dir: vec![0; self.cars as usize],
            car_load: None,
            ..self.clone()
        }
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

    /// Put back on unit `id` each fact an edit owns that the edit changed
    /// from `want` to `left` and nothing has changed since
    /// ([`UnitChange::Restore`](crate::undo::UnitChange::Restore)).
    pub(crate) fn put_unit_facts(&mut self, id: i64, want: &UnitFacts, left: &UnitFacts) {
        let Some(&i) = self.by_id.get(&id) else {
            return;
        };
        let u = &mut self.units[i];
        if puts_back(&want.rent, &left.rent, &u.rent) {
            u.rent = want.rent;
        }
        if puts_back(&want.no_rate, &left.no_rate, &u.no_rate) {
            u.no_rate = want.no_rate;
        }
        let mut policies = screen_policies(u);
        for (screen, now) in policies.iter_mut().enumerate() {
            let (want, left) = (&want.film_policies[screen], &left.film_policies[screen]);
            if puts_back(want, left, now) {
                *now = *want;
            }
        }
        if policies != screen_policies(u) {
            put_screen_policies(u, policies);
        }
        if puts_back(
            &want.ticket_price,
            &left.ticket_price,
            &u.extras().ticket_price,
        ) {
            u.extras_mut().ticket_price = want.ticket_price;
        }
        if puts_back(&want.label, &left.label, &self.units[i].label) {
            self.set_unit_label_at(i, want.label.clone());
        }
        if puts_back(&want.subtype, &left.subtype, &self.units[i].subtype) {
            self.set_unit_subtype(id, want.subtype);
        }
    }

    /// Put units back in the list, each at its index `at` in the list they
    /// leave (or the end, when the list is shorter), as placing them would
    /// register them. They go on the end of the list and one walk back from
    /// there moves them into place, shifting the units after each up, in
    /// place ([`merge_appended`]); one reindex follows, so a step that
    /// returns a whole row costs one walk of the list and no second copy of
    /// it.
    pub(crate) fn insert_units_at(&mut self, mut inserts: Vec<(usize, Unit)>) {
        if inserts.is_empty() {
            return;
        }
        inserts.sort_by_key(|&(at, _)| at);
        let old_len = self.units.len();
        let lands = landing_places(inserts.iter().map(|&(at, _)| at), old_len);
        let first = lands[0];
        let total = old_len + inserts.len();
        // The same headroom rule as a placement (#1259).
        if total > self.units.capacity() {
            let more = (total - old_len).max((old_len / 4).max(64));
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
        self.units.extend(inserts.into_iter().map(|(_, u)| u));
        merge_appended(&mut self.units, old_len, &lands);
        self.reindex_from(first);
        for &i in &lands {
            self.register(i);
            if self.units[i].kind == Kind::WeddingHall {
                self.built_wedding_hall = Some(true);
            }
        }
        for floor in new_lobby_floors {
            self.sync_express_stops_for_floor(floor);
        }
        self.revision += lands.len() as i64;
    }

    /// Put a shaft back in the list at index `at` (or the end).
    pub(crate) fn insert_transport_at(&mut self, at: usize, transport: Transport) {
        let at = at.min(self.transports.len());
        self.transports.insert(at, transport);
        self.reindex_transports();
        self.revision += 1;
    }
}

/// Where items put back at the indexes `ats` (ascending) land in a list of
/// `old_len`: each at its index, past the one before it, and no further than
/// the end of the list as it grows.
pub(crate) fn landing_places(ats: impl Iterator<Item = usize>, old_len: usize) -> Vec<usize> {
    let mut lands: Vec<usize> = Vec::new();
    for (k, at) in ats.enumerate() {
        let past = lands.last().map_or(0, |&before| before + 1);
        lands.push(at.max(past).min(old_len + k));
    }
    lands
}

/// Move the items appended to `items` after its first `old_len` to the
/// places `lands` names (ascending, one per appended item, in their order),
/// shifting the items after each place up. One walk back from the end puts
/// each item it moves in its place with one swap, and allocates nothing the
/// size of the list.
///
/// The appended items still to place fill a window just below the walk, in
/// an order the walk shuffles: each old item it moves up swaps with the top
/// of the window, which drops to the bottom. `at_slot[pos % n]` names the
/// appended item at `pos` and `pos_of` the reverse; the window spans at most
/// `n` places, so no two of them share a slot.
pub(crate) fn merge_appended<T>(items: &mut [T], old_len: usize, lands: &[usize]) {
    let n = lands.len();
    debug_assert_eq!(items.len(), old_len + n);
    let mut at_slot: Vec<usize> = vec![0; n];
    let mut pos_of: Vec<usize> = (old_len..old_len + n).collect();
    for (k, &pos) in pos_of.iter().enumerate() {
        at_slot[pos % n] = k;
    }
    // The window is `old..write`: the items not placed yet.
    let mut write = items.len();
    let mut old = old_len;
    for k in (0..n).rev() {
        // Every old item that lands past item `k` moves up first.
        while write > lands[k] + 1 {
            write -= 1;
            old -= 1;
            let top = at_slot[write % n];
            items.swap(old, write);
            at_slot[old % n] = top;
            pos_of[top] = old;
        }
        write -= 1;
        let from = pos_of[k];
        if from != write {
            let top = at_slot[write % n];
            items.swap(from, write);
            at_slot[from % n] = top;
            pos_of[top] = from;
        }
    }
}

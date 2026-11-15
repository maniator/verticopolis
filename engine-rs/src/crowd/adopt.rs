//! Rebuilding, from the people a save carries, what the crowd and the tower
//! keep about them (`save.rs` reads the people themselves).

use serde_json::Value;

use crate::sim::Simulation;

impl Simulation {
    /// Puts back the crowd a save carries (`crowd`, absent on a save from
    /// before people were saved) and rebuilds from the people what the
    /// crowd and the tower keep about them: the riders in each car, the
    /// crews and their head counts, the rooms the housekeepers hold, the
    /// visitors inside each venue (and its head count) and the tenants out
    /// for a meal. Runs once the tower is loaded.
    pub(crate) fn adopt_saved_crowd(&mut self, saved: Option<&Value>) {
        let Some(saved) = saved else { return };
        self.crowd.restore(saved);
        self.crowd.bound_gone_desks(&self.tower);
        let crowd = &mut self.crowd;
        super::line_count::restore_oldest(&mut crowd.shaft_lines, &crowd.people);
        // The last step folded the remembered waits into its lines; a save
        // keeps only their riders, so they are folded in again here.
        crowd.waits_seen.fold(0.0, &mut crowd.shaft_lines);
        let mut touched_meals = false;
        for i in 0..self.crowd.people.len() {
            let p = &self.crowd.people[i];
            if let (Some(shaft), Some(car)) = (p.shaft_id, p.car_index) {
                let aboard = self.crowd.car_riders.get_or_insert_with((shaft, car), || 0);
                *aboard += 1;
                let aboard = *aboard as f64;
                let cap = self
                    .tower
                    .get_transport(shaft)
                    .map(|t| t.kind.car_capacity());
                if cap.is_some_and(|cap| aboard >= cap) {
                    super::motion::mark_full(&mut self.crowd, &self.tower, (shaft, car));
                }
            }
            let p = &self.crowd.people[i];
            if p.walk_in {
                self.crowd.walk_in_count += 1;
            }
            if p.commuter {
                self.crowd.commuter_count += 1;
            }
            if p.staff {
                self.crowd.staff_count += 1;
                if let Some(crew) = p.crew_id {
                    *self.crowd.crew_roster.entry(crew).or_insert(0) += 1;
                }
            }
            let (origin, venue, hotel_guest) =
                (p.origin_unit_id, p.venue_unit_id, p.counted_hotel_guest);
            self.adopt_room_claim(i);
            if let Some((home, at)) = origin.and_then(|id| self.tower.marked_by_id(id)) {
                home.set_out_for_meal(at, Some(home.out_for_meal.unwrap_or(0) + 1));
                touched_meals = true;
            }
            let venue = venue.and_then(|id| self.tower.marked_by_id(id));
            match venue.filter(|(v, _)| v.kind.counts_visitors()) {
                Some((v, at)) => {
                    v.set_customers_in(at, Some(v.customers_in.unwrap_or(0) + 1));
                    if hotel_guest {
                        let n = v.hotel_customers_in.unwrap_or(0) + 1;
                        v.set_hotel_customers_in(at, Some(n));
                    }
                    v.sync_visitor_occupants(at);
                    touched_meals = true;
                }
                // A venue that is gone (or, in a hand edit, a room that
                // takes no visitors) counts nobody: the visitor is on their
                // way home from it.
                None => {
                    let p = &mut self.crowd.people[i];
                    p.venue_unit_id = None;
                    p.counted_hotel_guest = false;
                }
            }
        }
        if touched_meals {
            self.tower.bump_meal_overlay_revision();
        }
    }

    /// Rebuilds the room claim of housekeeper `i`. A room still standing
    /// must be a hotel room nobody else holds; a room demolished under a
    /// claim keeps it until the maid is done, as the live game does, on the
    /// floor her route ends on. A claim the loader refuses (only a hand edit
    /// makes one) is dropped from the maid, so her finish cannot release
    /// another crew's claim on that room.
    fn adopt_room_claim(&mut self, i: usize) {
        let p = &self.crowd.people[i];
        let (Some(room_id), Some(crew)) = (p.clean_unit_id, p.crew_id) else {
            return;
        };
        let floor = match self.tower.get_unit(room_id) {
            Some(room) => room.kind.is_hotel().then_some(room.floor),
            None => p.floors.last().copied(),
        };
        let free = self.housekeeping.room_holder(room_id).is_none();
        match floor.filter(|_| free && p.staff) {
            Some(floor) => self.housekeeping.assign_room(room_id, crew, floor),
            None => self.crowd.people[i].clean_unit_id = None,
        }
    }
}

#[cfg(test)]
#[path = "adopt_tests.rs"]
mod tests;

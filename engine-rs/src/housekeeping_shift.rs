//! The housekeepers' working day, on the simulation's side: bring each crew
//! in from the lobby at the start of the shift, hand a housekeeper who is
//! free the next dirty room, send them back to the housekeeping room when
//! nothing is left, and out through the lobby when the shift is over. The
//! crowd walks them (`crowd/staff_shift.rs`).

use crate::crowd::fasthash::FastMap;
use crate::crowd::staff_shift::{index_of, send, send_out, spawn_commuter, Network, StaffTrip};
use crate::crowd::{PState, CROWD_SECONDS_PER_MINUTE};
use crate::facilities::Kind;
use crate::housekeeping::{StepRooms, HK_CLEAN_MINUTES, HK_MAIDS_PER_UNIT};
use crate::sim::{LogKind, Simulation};

/// What handing a room to a crew came to.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MaidSent {
    Sent,
    /// Every housekeeper of the crew is busy, on the way in, or out.
    NoneFree,
    /// No free housekeeper of the crew can reach the room.
    NoRoute,
}

/// Housekeepers ready for a room, as crowd indexes by crew.
pub(crate) type FreeMaids = FastMap<i64, Vec<usize>>;

impl Simulation {
    /// The hours a crew is in the building: from two hours before the shift,
    /// so they are at their housekeeping room when it starts even in a busy
    /// tower, to its end.
    pub(crate) fn crews_on_duty(&self) -> bool {
        let s = self.mode.housekeeping_shift();
        let h = self.clock.hour();
        h >= s.start - 2 && h < s.end
    }

    /// The crew's housekeeping room: its floor and the middle of it, while it
    /// stands and works.
    fn crew_home(&self, crew: Option<i64>) -> Option<(i64, f64)> {
        let u = self.tower.get_unit(crew?)?;
        (u.kind == Kind::Housekeeping && u.is_operational())
            .then(|| (u.floor, u.x as f64 + u.width as f64 / 2.0))
    }

    /// One walk of the crowd for a dispatch pass: who is ready for a room.
    pub(crate) fn free_maids(&self) -> FreeMaids {
        let mut free = FreeMaids::default();
        for (i, p) in self.crowd.people.iter().enumerate() {
            let ready = matches!(p.staff_trip, Some(StaffTrip::Base | StaffTrip::Free));
            if let (true, Some(crew), false) = (ready, p.crew_id, p.state == PState::Done) {
                free.get_or_insert_with(crew, Vec::new).push(i);
            }
        }
        free
    }

    /// Send the crew's free housekeeper nearest the room to clean it.
    pub(crate) fn assign_maid(
        &mut self,
        free: &mut FreeMaids,
        crew: i64,
        room: (i64, i64, f64),
    ) -> MaidSent {
        let floor = room.1;
        let Some(list) = free.get_mut(&crew).filter(|l| !l.is_empty()) else {
            return MaidSent::NoneFree;
        };
        let people = &self.crowd.people;
        list.sort_by_key(|&i| ((people[i].floor - floor).abs(), people[i].id));
        for k in 0..list.len() {
            let i = list[k];
            if self.send_maid(i, room) {
                list.remove(k);
                return MaidSent::Sent;
            }
        }
        MaidSent::NoRoute
    }

    /// Send housekeeper `i` on the staff network to clean the room. False,
    /// with her left where she is, when no staff route leads there.
    fn send_maid(&mut self, i: usize, room: (i64, i64, f64)) -> bool {
        let (room_id, floor, x) = room;
        let to = (floor, x);
        if !send(
            &mut self.crowd,
            &self.tower,
            i,
            Network::Staff,
            to,
            StaffTrip::Job,
        ) {
            return false;
        }
        let p = &mut self.crowd.people[i];
        p.clean_unit_id = Some(room_id);
        p.linger_for = Some(HK_CLEAN_MINUTES * CROWD_SECONDS_PER_MINUTE);
        true
    }

    /// A housekeeper who has just finished a room takes the nearest dirty
    /// room their crew may take (fewest floors away, then fewest tiles, then
    /// the lower room id): sent to the top of the dispatch order instead,
    /// they could cross the tower while a dirty room waits next door. False,
    /// with them left where they are, when there is none.
    fn chain_maid(&mut self, i: usize) -> bool {
        let Some(crew) = self.crowd.people[i].crew_id else {
            return false;
        };
        if !self.can_start_new_room() || self.tower.housekeeping_units() == 0 {
            return false;
        }
        let Some(mut rooms) = self.rooms_for_pass() else {
            return false;
        };
        let (floor, x) = (self.crowd.people[i].floor, self.crowd.people[i].x);
        let mut sent = false;
        if let Some((rfloor, k)) = self.nearest_open_room(&mut rooms, crew, floor, x) {
            let (rid, _, rx, rw, _) = rooms.candidates[k];
            if self.send_maid(i, (rid, rfloor, rx as f64 + rw as f64 / 2.0)) {
                self.housekeeping.assign_room(rid, crew, rfloor);
                if let Some(bucket) = rooms.by_floor.get_mut(&rfloor) {
                    bucket.retain(|&j| j != k);
                }
                sent = true;
            }
        }
        self.housekeeping.step_rooms = Some(rooms);
        sent
    }

    /// The open room nearest (`floor`, `x`) that `crew` may take, as its
    /// floor and its index in `rooms.candidates`. Walks out a floor at a time
    /// from `floor` and stops at the first distance with a room, so it reads
    /// at most the tower's floors and the rooms of the two floors it settles
    /// on.
    fn nearest_open_room(
        &self,
        rooms: &mut StepRooms,
        crew: i64,
        floor: i64,
        x: f64,
    ) -> Option<(i64, usize)> {
        let StepRooms {
            orders,
            candidates,
            by_floor,
        } = rooms;
        let (low, high) = (*by_floor.keys().next()?, *by_floor.keys().next_back()?);
        let reach = (floor - low).abs().max((high - floor).abs());
        let mut best: Option<(f64, i64, i64, usize)> = None;
        for d in 0..=reach {
            // Below and above, once at `d` 0.
            for f in [floor - d, floor + d]
                .into_iter()
                .take(if d == 0 { 1 } else { 2 })
            {
                let Some(bucket) = by_floor.get(&f) else {
                    continue;
                };
                let ours = orders.for_floor(&self.tower, f).iter().any(|c| c.0 == crew);
                if !ours || !self.housekeeping.crew_may_take(crew, f) {
                    continue;
                }
                for &k in bucket {
                    let (rid, _, rx, rw, _) = candidates[k];
                    if !self.housekeeping.room_open(&self.tower, rid) {
                        continue;
                    }
                    let gap = (rx as f64 + rw as f64 / 2.0 - x).abs();
                    if best.is_none_or(|b| (gap, rid) < (b.0, b.1)) {
                        best = Some((gap, rid, f, k));
                    }
                }
            }
            if let Some((_, _, f, k)) = best {
                return Some((f, k));
            }
        }
        None
    }

    /// After each chunk of a step's crowd moves: mark the cleaned rooms, send
    /// each housekeeper done with a room on to the nearest dirty one, and the
    /// rest home, or out once the shift is over. True when any housekeeper
    /// finished a room or came free, for the step's dispatch.
    pub(crate) fn staff_after_chunk(&mut self) -> bool {
        let jobs = self.crowd.take_staff_results();
        for job in &jobs {
            if !job.ok {
                // The room is free again, and not among the step's rooms.
                self.housekeeping.drop_step_rooms();
            }
            self.on_housekeeper_result(job.unit_id, job.ok);
        }
        let ready = std::mem::take(&mut self.crowd.staff_ready);
        for &id in &ready {
            let Some(i) = index_of(&self.crowd, id) else {
                continue;
            };
            let free = self.crowd.people[i].staff_trip == Some(StaffTrip::Free);
            if !(free && self.chain_maid(i)) {
                self.settle_maid(i);
            }
        }
        !jobs.is_empty() || !ready.is_empty()
    }

    /// At the end of a step: when its chunks moved any housekeeper, one
    /// dispatch pass hands the rooms left to those waiting at their
    /// housekeeping rooms; then the step's rooms go.
    pub(crate) fn staff_after_step(&mut self, moved: bool) {
        if moved {
            self.dispatch_pass();
        }
        self.housekeeping.drop_step_rooms();
    }

    /// A housekeeper the hand-off left waiting: one at a room goes back to
    /// the housekeeping room, and one there leaves once the shift is over or
    /// the room is gone.
    fn settle_maid(&mut self, i: usize) {
        let home = self.crew_home(self.crowd.people[i].crew_id);
        match self.crowd.people[i].staff_trip {
            Some(StaffTrip::Free) => {
                let sent = home.is_some_and(|h| {
                    send(
                        &mut self.crowd,
                        &self.tower,
                        i,
                        Network::Staff,
                        h,
                        StaffTrip::Home,
                    )
                });
                if !sent {
                    send_out(&mut self.crowd, &mut self.tower, i);
                }
            }
            Some(StaffTrip::Base) if home.is_none() || !self.crews_on_duty() => {
                send_out(&mut self.crowd, &mut self.tower, i);
            }
            _ => {}
        }
    }

    /// At the top of an hour on duty: bring every working crew up to
    /// strength from the lobby (two hours before the shift, a crew built
    /// mid-shift, or a game loaded mid-shift, since saves carry no people).
    pub(crate) fn bring_in_crews(&mut self) {
        let crews: Vec<(i64, i64, f64)> = self
            .tower
            .room_units()
            .filter(|u| u.kind == Kind::Housekeeping && u.is_operational())
            .map(|u| (u.id, u.floor, u.x as f64 + u.width as f64 / 2.0))
            .collect();
        let mut stranded = None;
        for (crew, floor, x) in crews {
            let on_roster = self.crowd.crew_roster.get(&crew).copied().unwrap_or(0);
            for _ in on_roster..HK_MAIDS_PER_UNIT {
                if !spawn_commuter(&mut self.crowd, &self.tower, crew, floor, x) {
                    stranded = Some(floor);
                    break;
                }
            }
        }
        let day = self.clock.day();
        if let Some(floor) = stranded.filter(|_| self.housekeeping.commute_nudged_day != day) {
            self.housekeeping.commute_nudged_day = day;
            self.emit(
                &format!("🧹 Housekeepers can't get from the lobby to the housekeeping room on floor {floor}."),
                LogKind::Bad,
            );
        }
    }

    /// Every hour: housekeepers waiting at a housekeeping room go home once
    /// the shift is over, or once their room is gone.
    pub(crate) fn send_idle_crews_out(&mut self) {
        let off = !self.crews_on_duty();
        for i in 0..self.crowd.people.len() {
            let p = &self.crowd.people[i];
            if p.staff_trip != Some(StaffTrip::Base) || p.state == PState::Done {
                continue;
            }
            if off || self.crew_home(p.crew_id).is_none() {
                send_out(&mut self.crowd, &mut self.tower, i);
            }
        }
    }
}

#[cfg(test)]
impl Simulation {
    /// Every working crew's housekeepers already at their housekeeping room,
    /// as they stand once they have walked in: the dispatch tests' start.
    pub(crate) fn seat_crews(&mut self) {
        use crate::crowd::spawn::make_person;
        use crate::crowd::Route;
        let crews: Vec<(i64, i64, f64)> = self
            .tower
            .room_units()
            .filter(|u| u.kind == Kind::Housekeeping && u.is_operational())
            .map(|u| (u.id, u.floor, u.x as f64 + u.width as f64 / 2.0))
            .collect();
        for (crew, floor, x) in crews {
            let on_roster = self.crowd.crew_roster.get(&crew).copied().unwrap_or(0);
            for _ in on_roster..HK_MAIDS_PER_UNIT {
                let here = Route {
                    floors: vec![floor],
                    shafts: vec![],
                };
                let i = make_person(&mut self.crowd, &self.tower, here, x, None);
                let p = &mut self.crowd.people[i];
                p.x = x;
                p.staff = true;
                p.crew_id = Some(crew);
                p.staff_trip = Some(StaffTrip::Base);
                self.crowd.staff_count += 1;
                *self.crowd.crew_roster.entry(crew).or_insert(0) += 1;
            }
        }
    }
}

//! A bomb going off: the threat with no Security to stop it, and the blast
//! a missed bomb sets off, which stays in the tower it went off in.

use super::BLAST_FLOORS;
use crate::facilities::Kind;
use crate::gameplay::GameplayEvent;
use crate::services::with_thousands;
use crate::sim::{LogKind, PointFx, Simulation};
use crate::tower::UnitState;

#[doc(hidden)]
impl Simulation {
    /// The bomb threat a random event calls in: Security sweeps the tower
    /// for a fee, and a tower without Security takes the blast and a fine.
    pub fn bomb_threat(&mut self) {
        if self.has_any(Kind::Security) {
            let cost = 2_000.0 + self.rng.int(0, 3_000) as f64;
            self.money -= cost;
            self.emit(&format!("💣 A bomb threat was called in. Security swept the tower and found nothing. The evacuation cost ${}.", with_thousands(cost)), LogKind::Info);
            return;
        }
        let fine = 15_000.0 + self.rng.int(0, 15_000) as f64;
        let targets = self.flammable_units();
        let epicenter = if targets.is_empty() {
            None
        } else {
            let ground = &self.tower.units[*self.rng.pick(&targets)];
            Some((ground.floor, ground.x as f64 + ground.width as f64 / 2.0))
        };
        let destroyed = self.blast(fine, epicenter);
        self.emit(&format!("💣 A bomb detonated with no security to stop it. {destroyed} room(s) across ~5 floors were gutted, plus a ${} fine. Build Security!", with_thousands(fine)), LogKind::Bad);
    }

    /// A bomb going off at `epicenter` (floor, x), or nowhere when the tower
    /// had no room to hide it in: the fine, the tally, the flash, every room
    /// within two floors gutted and the gameplay event. The rooms gutted.
    ///
    /// The blast stays in the building it went off in (see `blast_reach`),
    /// so on a lot with several towers side by side the others stand.
    pub(crate) fn blast(&mut self, fine: f64, epicenter: Option<(i64, f64)>) -> i64 {
        self.money -= fine;
        self.events.bombs_detonated += 1;
        let mut destroyed = 0;
        if let Some((floor, x)) = epicenter {
            self.fx.explosion = PointFx {
                floor,
                x,
                seq: self.fx.explosion.seq + 1,
            };
            let reach = self.blast_reach(floor, x);
            for i in 0..self.tower.units.len() {
                let u = &self.tower.units[i];
                if reach
                    .iter()
                    .any(|&(f, first, last)| u.floor == f && u.x <= last && u.x + u.width > first)
                    && !u.kind.is_structural()
                    && u.state != UnitState::Construction
                    && u.state != UnitState::Gutted
                {
                    let id = u.id;
                    self.events.active.shift_remove(&id);
                    self.gut(i);
                    destroyed += 1;
                }
            }
        }
        self.gameplay
            .push(GameplayEvent::BombDetonated { rooms: destroyed });
        destroyed
    }

    /// The runs of floor tiles (floor, first tile, last tile) a bomb at
    /// (`floor`, `x`) guts: on each floor within [`BLAST_FLOORS`], every run
    /// that overlaps the run holding the bomb. A tower that fills its floors,
    /// or steps out wider below the bomb, is hit across those floors as
    /// before; a tower standing apart on the same lot shares no run with it
    /// and is spared. A bomb with no floor under it (never placed by the
    /// game) reaches only the runs above and below its own tile.
    fn blast_reach(&self, floor: i64, x: f64) -> Vec<(i64, i64, i64)> {
        let tile = x.floor() as i64;
        let (left, right) = self
            .tower
            .segments_of(floor)
            .into_iter()
            .find(|&(first, last)| first <= tile && tile <= last)
            .unwrap_or((tile, tile));
        let mut reach = Vec::new();
        for f in floor - BLAST_FLOORS..=floor + BLAST_FLOORS {
            for (first, last) in self.tower.segments_of(f) {
                if first <= right && last >= left {
                    reach.push((f, first, last));
                }
            }
        }
        reach
    }
}

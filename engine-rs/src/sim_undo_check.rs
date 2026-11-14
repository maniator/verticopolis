//! Whether a step meets the tower it expects (`undo.rs`), checked before it
//! changes anything. The steps apply one after another, so the tower a step
//! meets is the one its edit left, moved on only by time; a step that finds
//! anything else (an edit made outside every gesture) is refused, so its cash
//! never moves for an edit that is not there to reverse, nothing it puts back
//! lands on a room or a shaft that took its place, hangs where its floor was
//! taken away, breaks a rule of the lobbies or the metro station, or goes past
//! a cap its build kept to (`sim_undo_ground.rs`, `sim_undo_caps.rs`). Nor does
//! a floor or lobby tile it takes out leave a room, a shaft or the story above
//! hanging, as a sale never does (`Tower::removal_reason`), or a ground-floor
//! lobby tile cut a run of ground-floor or basement tiles laid in part after it
//! off from the oldest ground-floor tile of the part it stood in (in play the
//! tower's first lobby tile, unless a sale parted the ground floor), though one
//! such run with a lobby tile may stand on its own, as a tower's first lobby
//! tile does, where no older ground-floor tile of that part stays or comes back
//! with the step outside it (`Ground::lobbies_leave_nothing_hanging` says which
//! tiles count).
//!
//! Time moves a build on without any edit, and the owner's rule for that is
//! that a step takes a build back at its full price only while nobody has
//! used it since the step was made. A room the edit built is in use once it
//! opens; one that was already open is in use once a tenant moved in, it
//! earned or it burned ([`UnitUse`]). A floor or lobby tile, or a shaft, is
//! in use once an hourly pass has run with it standing (`Step::hour_passes`),
//! and a shaft also once anyone rode it (`Transport::rides`), which also
//! keeps an undo from taking away the cars or floors an edit added to it. A
//! used build is sold instead, at the sale price. A build whose dig searched
//! for treasure is never undone: the dig and its luck stay, so the search
//! would cost nothing.
#![cfg_attr(not(feature = "wasm"), allow(dead_code))]
use crate::crowd::fasthash::FastSet;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::sim_undo_caps::within_caps;
use crate::sim_undo_ground::Ground;
use crate::tower::{Transport, Unit, UnitState};
use crate::undo::{puts_back, Step, TransportChange, UnitChange, UnitFacts, UnitUse};

/// Why a step was not applied. Nothing changed. `sellable` says the player
/// can sell the build instead, which a lobby tile the mode keeps and a
/// Classic permanent room no fire gutted never allow, and a burning room
/// allows only once the fire is out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StepRefused {
    /// The step needs more cash than the tower has.
    NotEnoughMoney,
    /// A room the step would take out at its full price has been used
    /// since the step was made.
    InUse { sellable: bool },
    /// A floor or lobby tile the step would take out at its full price has
    /// stood through an hourly pass since the step was made, which moves
    /// tenants in over the floors the tower reaches. Floor a room's build
    /// laid under it is held to this too, while the room is still being
    /// built; once the room opens, the room's own reason is the one given,
    /// though a fire, which waits, gives way to this one. `sellable` says
    /// the player could sell everything the step takes out instead: it is
    /// false for a lobby tile, a burning room or a Classic room that stays
    /// for good, a tile the step lays again, and while anything but a room
    /// or shaft the step takes out stands on one of the step's tiles, a
    /// shaft would be left with no floor on a story it spans once they are
    /// sold, or something the step takes out is gone since.
    GroundUsed { sellable: bool },
    /// A room the step would take out was being built when the step was made
    /// and has opened since.
    Opened { sellable: bool },
    /// A shaft the step would take out, or take cars or floors from, at the
    /// price paid has been used since the step was made.
    ShaftUsed,
    /// A build the edit took out again inside its own gesture had been used
    /// by then (`Step::used_in_gesture`).
    UsedThenSold,
    /// The edit dug new ground that could hold treasure. `sellable` is as
    /// for `GroundUsed`, and false when the step takes nothing out: a build
    /// its own gesture sold again leaves nothing to sell.
    SearchedForTreasure { sellable: bool },
    /// A room the step would take out is burning.
    OnFire,
    /// Security is searching for a bomb, and the tower takes no edits until
    /// the search ends ([`edit_refusal`](crate::sim::Simulation::edit_refusal)).
    BombSearch,
    /// The step would reprice a condo that has been sold since: a sold
    /// condo's price is fixed, as repricing it is refused.
    PriceFixed,
    /// A sale the step would make again meets a room in another use than
    /// the one it was sold in: a tenant moved in or out since.
    UseChanged,
    /// The tower around the step has changed: a unit or shaft the step would
    /// put back has no space, no floor under it, a lobby, a room or the metro
    /// station where the build rules refuse it, or no place under its cap, or a
    /// floor or lobby tile it would take out holds up a room, a shaft or the
    /// story above, or taking out a ground-floor lobby tile, with the tiles
    /// there it takes with it, cuts a run of ground-floor or basement tiles
    /// laid in part after it off from the oldest ground-floor tile of the part
    /// it stood in (in play the tower's first lobby tile; one run with a lobby
    /// tile may stand on its own where no older ground-floor tile of that part
    /// stays or comes back with the step outside it). Only an edit clears it
    /// (time alone takes no unit out), and undoing that edit puts the block
    /// back, so the step never applies.
    Blocked,
    /// The tower is not the one the step expects: something it would take
    /// out or restore is gone or has changed, or something it would put back
    /// is there already.
    Stale,
}

impl StepRefused {
    /// Whether a step refused for this is dropped, as one that will not
    /// apply again. Only time can make a step apply, and time does not run
    /// back: a build in use stays in use, a sold condo seldom empties, a
    /// room's tenants and income seldom go back to just what a sale found,
    /// and a tower an edit changed under the step changes back only by
    /// another edit, whose own step sits above this one. Time does bring in
    /// money, put a fire out and end a bomb search.
    pub(crate) fn is_lasting(self) -> bool {
        !matches!(
            self,
            StepRefused::NotEnoughMoney | StepRefused::OnFire | StepRefused::BombSearch
        )
    }
}

/// What a check found of the floor and lobby tiles a step would take out.
#[derive(Default)]
struct Tiles {
    /// One the step built has stood through an hourly pass.
    used: bool,
    /// One holds up something the step leaves.
    blocked: bool,
}

/// Whether the player could sell instead everything a step would take out:
/// a room that is not burning, of a kind that can be sold, and a floor tile
/// once the rooms on it are sold, when it holds up nothing else. Only a
/// refusal that gives advice reads it, so a check that can give none asks
/// nothing (`asked`).
struct Sale {
    asked: bool,
    takes_any: bool,
    sellable: bool,
}

impl Sale {
    fn new(asked: bool) -> Sale {
        Sale {
            asked,
            takes_any: false,
            sellable: true,
        }
    }

    /// Note a build the step takes out, which the player could sell first
    /// when `sells` says so. It is asked only while the rest could be.
    fn note(&mut self, sells: impl FnOnce() -> bool) {
        if self.asked {
            self.takes_any = true;
            self.sellable = self.sellable && sells();
        }
    }

    /// Whether the step takes anything out and the player could sell it
    /// all: a build its own gesture sold again leaves nothing to sell.
    fn works(&self) -> bool {
        self.takes_any && self.sellable
    }
}

/// The refusals a check has found. A lasting one is reported before any
/// other, so a refusal that time can clear never keeps a step that can
/// never apply.
#[derive(Default)]
struct Found {
    lasting: Option<StepRefused>,
    passing: Option<StepRefused>,
}

impl Found {
    fn add(&mut self, why: StepRefused) {
        let slot = if why.is_lasting() {
            &mut self.lasting
        } else {
            &mut self.passing
        };
        slot.get_or_insert(why);
    }

    /// Whether a lasting reason is found, which only the dig's displaces.
    fn has_lasting(&self) -> bool {
        self.lasting.is_some()
    }

    /// Report lasting reason `why` before anything found so far.
    fn put_first(&mut self, why: StepRefused) {
        debug_assert!(why.is_lasting());
        self.lasting = Some(why);
    }

    fn verdict(self) -> Result<(), StepRefused> {
        match self.lasting.or(self.passing) {
            Some(why) => Err(why),
            None => Ok(()),
        }
    }
}

#[doc(hidden)]
impl Simulation {
    /// Refuse `step` unless the tower is the one it expects and the balance
    /// can pay for it.
    pub(crate) fn check_undo_step(&self, step: &Step) -> Result<(), StepRefused> {
        let mut found = Found::default();
        let leaving_units: FastSet<i64> = step
            .units
            .iter()
            .filter(|img| matches!(img.change, UnitChange::TakeOut(_)))
            .map(|img| img.id)
            .collect();
        let ground = Ground::of(&self.tower, step, &leaving_units);
        let hour_passed = self.on_hour_runs != step.hour_passes;
        // The tiles' reasons come after the rooms', which say more.
        let mut tiles = Tiles::default();
        // Of the refusals, only a floor's use and a dig give advice for the
        // whole step.
        let mut sale = Sale::new(hour_passed || step.searched_for_treasure);
        for img in &step.units {
            match (&img.change, self.tower.get_unit(img.id)) {
                (UnitChange::TakeOut(held), Some(now)) if now.kind.is_structural() => {
                    let hangs = !ground.leaves_nothing_hanging_from(now);
                    sale.note(|| {
                        !hangs
                            && !ground.lays_again(now)
                            && self.sells(now)
                            && ground.sells_from_an_end(now)
                    });
                    if now.state == UnitState::Fire {
                        found.add(StepRefused::OnFire);
                    } else if !img.built {
                        self.check_take_out(&mut found, false, held, now);
                    } else {
                        tiles.used |= hour_passed;
                    }
                    tiles.blocked |= hangs;
                }
                (UnitChange::TakeOut(held), Some(now)) => {
                    sale.note(|| self.sells(now));
                    self.check_take_out(&mut found, img.built, held, now);
                }
                (UnitChange::PutBack(want), None) => {
                    if !self
                        .tower
                        .tiles_free_for(want, |id| leaving_units.contains(&id))
                        || !ground.under_room(want)
                    {
                        found.add(StepRefused::Blocked);
                    }
                }
                (UnitChange::Restore { want, left }, Some(now)) => {
                    if reprices_a_sold_condo(now, want, left) {
                        found.add(StepRefused::PriceFixed);
                    }
                }
                (UnitChange::TakeOut(_), None) => {
                    sale.note(|| false);
                    found.add(StepRefused::Stale);
                }
                _ => found.add(StepRefused::Stale),
            }
        }
        for img in &step.transports {
            if matches!(img.change, TransportChange::TakeOut { .. }) {
                // A shaft can be sold while it stands.
                sale.note(|| self.tower.get_transport(img.id).is_some());
            }
        }
        let named: FastSet<i64> = step.transports.iter().map(|img| img.id).collect();
        // Selling the step's tiles from under a shaft would leave it over
        // nothing, so the advice holds only while each shaft the step does
        // not take out keeps its floor as it stands now. A sale lays no
        // tile, so the tiles the step lays hold up no shaft here. Only a
        // floor's use and a dig that takes something out read it, and only
        // while the rest could be sold.
        let advised = (tiles.used && sale.sellable) || (step.searched_for_treasure && sale.works());
        let shafts_keep_floor = advised
            && self
                .tower
                .transports
                .iter()
                .filter(|t| !named.contains(&t.id))
                .all(|t| ground.still_under_shaft_once_sold(t))
            && self.restored_shafts_stand(step, &ground);
        if tiles.used {
            found.add(StepRefused::GroundUsed {
                sellable: sale.sellable && shafts_keep_floor,
            });
        }
        self.check_shafts(&mut found, step, &named, &ground, hour_passed);
        // What the step's tiles hold up, and its caps, come after the
        // builds' own reasons. Each is lasting, so it is asked only while it
        // could be the reason given: no lasting reason is found yet, and no
        // dig will be put first.
        if !found.has_lasting() && !step.searched_for_treasure {
            // A shaft the step leaves alone keeps its floor.
            let shafts_stand = self
                .tower
                .transports
                .iter()
                .filter(|t| !named.contains(&t.id))
                .all(|t| ground.still_under_shaft(t));
            if tiles.blocked
                || !shafts_stand
                || !ground.lobbies_leave_nothing_hanging()
                || !within_caps(&self.tower, step)
            {
                found.add(StepRefused::Blocked);
            }
        }
        // After the builds' own reasons, which say more.
        if step.used_in_gesture {
            found.add(StepRefused::UsedThenSold);
        }
        if step.money < 0.0 && self.money + step.money < 0.0 {
            found.add(StepRefused::NotEnoughMoney);
        }
        // The dig and its luck stay whatever else the check found.
        if step.searched_for_treasure {
            found.put_first(StepRefused::SearchedForTreasure {
                sellable: sale.works() && shafts_keep_floor,
            });
        }
        found.verdict()
    }

    /// Check a unit `now` that a step would take out, which the step found
    /// in use `held`; `built` as [`crate::undo::UnitImage`] has it. A floor
    /// or lobby tile the step built is checked by the hour instead.
    fn check_take_out(&self, found: &mut Found, built: bool, held: &UnitUse, now: &Unit) {
        if now.state == UnitState::Fire {
            // Its use shows once the fire is out.
            found.add(StepRefused::OnFire);
            return;
        }
        let sellable = self.sells(now);
        let use_now = UnitUse::of(now);
        if !built {
            // A sale made again prices the room by its use as sold.
            if use_now.as_sold() != held.as_sold() {
                found.add(StepRefused::UseChanged);
            }
        } else if held.only_opened(use_now) {
            found.add(StepRefused::Opened { sellable });
        } else if use_now != *held {
            found.add(StepRefused::InUse { sellable });
        }
    }

    /// Check the shafts a step names, and the shafts it leaves standing on
    /// the floor and lobby tiles it takes out.
    fn check_shafts(
        &self,
        found: &mut Found,
        step: &Step,
        named: &FastSet<i64>,
        ground: &Ground,
        hour_passed: bool,
    ) {
        // `named` holds the shafts the step names. Each one's image is a
        // shaft as it stood beside the others when the step was made, so
        // they never clash with each other: one shrunk by the step makes
        // room for another it puts back.
        // A shaft the step puts back or gives its old span needs floor in
        // its column on each story of that span and no other shaft there,
        // as building it did. Classic's rule that keeps an escalator off an
        // office floor is not asked: an office may go in beside one, so a
        // tower with both is one that building could make.
        let fits = |want: &Transport| {
            ground.under_shaft(want)
                && self
                    .tower
                    .transports
                    .iter()
                    .filter(|t| !named.contains(&t.id))
                    .all(|t| !t.clashes_with(want))
        };
        for img in &step.transports {
            let now = self.tower.get_transport(img.id);
            let (as_left, room, takes_back) = match (&img.change, now) {
                (TransportChange::TakeOut { left }, Some(now)) => (now.config_eq(left), true, true),
                (TransportChange::Restore { want, left }, Some(now)) => (
                    now.config_eq(left),
                    fits(want),
                    takes_cars_or_floors(left, want),
                ),
                (TransportChange::PutBack(want), None) => (true, fits(want), false),
                _ => (false, true, false),
            };
            if !as_left {
                found.add(StepRefused::Stale);
                continue;
            }
            if !room {
                found.add(StepRefused::Blocked);
            }
            if img.built && takes_back && (hour_passed || ridden_since(now, &img.change)) {
                found.add(StepRefused::ShaftUsed);
            }
        }
    }

    /// Whether the player could sell unit `u` instead of undoing its build,
    /// as `Simulation::remove_facility` lets them: a lobby tile the mode
    /// keeps stays for good (`Tower::lobby_stays`), a burning unit waits for
    /// the fire, and a Classic permanent room stays unless a fire gutted it.
    fn sells(&self, u: &Unit) -> bool {
        !self.tower.lobby_stays(u)
            && u.state != UnitState::Fire
            && !self.stays_for_good(u.kind, u.state)
    }

    /// Whether each shaft `step` gives another span or other cars still
    /// has floor where the step takes it from, as the shaft stands now and
    /// a sale of what the step takes out would leave it.
    fn restored_shafts_stand(&self, step: &Step, ground: &Ground) -> bool {
        step.transports
            .iter()
            .filter(|img| matches!(img.change, TransportChange::Restore { .. }))
            .filter_map(|img| self.tower.get_transport(img.id))
            .all(|t| ground.still_under_shaft_once_sold(t))
    }
}

/// Whether putting `want`'s span and cars on a shaft that is `left` takes
/// cars or floors away from it.
pub(crate) fn takes_cars_or_floors(left: &Transport, want: &Transport) -> bool {
    want.cars < left.cars || want.bottom > left.bottom || want.top < left.top
}

/// Whether the shaft `now` has been ridden since the step that expects it
/// as `change` leaves it was made.
fn ridden_since(now: Option<&Transport>, change: &TransportChange) -> bool {
    let left = match change {
        TransportChange::TakeOut { left } | TransportChange::Restore { left, .. } => left,
        TransportChange::PutBack(_) => return false,
    };
    now.is_some_and(|now| now.rides != left.rides)
}

/// Whether restoring `want` (where the edit left `left`) onto `now` would
/// change the price of a condo that has sold, which `price_unit` and
/// `set_no_rate` (`rent.rs`) refuse.
fn reprices_a_sold_condo(now: &Unit, want: &UnitFacts, left: &UnitFacts) -> bool {
    now.kind == Kind::Condo
        && now.ever_occupied
        && (puts_back(&want.rent, &left.rent, &now.rent)
            || puts_back(&want.no_rate, &left.no_rate, &now.no_rate))
}

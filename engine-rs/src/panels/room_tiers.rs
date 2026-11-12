//! The rooms' evaluation and rent tiers (the Map's Eval and Pricing views,
//! #343 S7): every room that carries an evaluation or a rent level, with the
//! tier the engine puts it in. One pass over the rooms, constant work per
//! room. S8 reads it only on the triggers the Map SPEC lists
//! (`_bmad-output/specs/spec-overview-map/SPEC.md`, the Cost bullet of its S7
//! section), and not more than once a frame.
//!
//! The tiers come from rules the engine already has, so the host compares
//! nothing:
//!
//! - **Evaluation.** A room carries one when the Satisfaction heatmap draws
//!   it (`carries_evaluation`): a kind with a census population or a hotel
//!   room, with a tenant or guest present. Its score is the satisfaction the
//!   editor shows as "Eval". Below [`VACATE_RESCIND`], the score a tenant on
//!   notice needs to stay, it is Terrible; at or below
//!   [`GRIPE_WARN`](crate::satisfaction::GRIPE_WARN) it is Good; above that,
//!   Excellent. The Good line is the inspector's gripe check
//!   ([`names_gripe`]); the inspector names a gripe only for the kinds and
//!   tenants it inspects.
//! - **Rent level.** A room carries one when its kind has a price in the
//!   tower's mode (`price_options`). No Rate is its own tier. In Classic the
//!   tier is the rung of the price ladder the editor's rung picker shows
//!   (`ladder_level` on `unit_price`), which puts a price that is not a
//!   finite number on the Average rung. A Modern price is a band with no
//!   rungs ([`band_tier`]): a price that is not a number reads Average, the
//!   neutral reading; a price over the band's neutral price is High (the
//!   "rent set too high" gripe's own test, [`RentConfig::over_neutral`]); a
//!   price equal to the neutral price is Average (the batch reprice's own
//!   "on the default" test, [`is_neutral_price`]); a price at or under the
//!   band's floor is Very Low; and any other price is Low.

use crate::clock::GameMode;
use crate::econ::{rent_config, RentConfig};
use crate::panels::unit_detail::unit_price;
use crate::rent::{is_neutral_price, ladder_level, price_options};
use crate::satisfaction::{names_gripe, VACATE_RESCIND};
use crate::sim::Simulation;
use crate::tower::Unit;

/// A room's evaluation tier. `Unrated` is a room with no evaluation: a kind
/// that carries none, or a room with nobody in it to rate it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EvalTier {
    Unrated,
    Terrible,
    Good,
    Excellent,
}

impl EvalTier {
    /// Every tier, in code order (the layout's `evalTiers`).
    pub const ALL: [EvalTier; 4] = [
        EvalTier::Unrated,
        EvalTier::Terrible,
        EvalTier::Good,
        EvalTier::Excellent,
    ];

    /// The tier's name in the layout's `evalTiers` table.
    pub fn name(self) -> &'static str {
        match self {
            EvalTier::Unrated => "unrated",
            EvalTier::Terrible => "terrible",
            EvalTier::Good => "good",
            EvalTier::Excellent => "excellent",
        }
    }

    /// The tier's code: its place in [`EvalTier::ALL`], which lists the
    /// tiers in declaration order (a test pins the two together).
    pub fn code(self) -> f64 {
        self as usize as f64
    }
}

/// A room's rent tier. `Unpriced` is a kind with no price in the tower's
/// mode; `NoRate` a priced room the player took off the market.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RentTier {
    Unpriced,
    NoRate,
    VeryLow,
    Low,
    Average,
    High,
}

impl RentTier {
    /// Every tier, in code order (the layout's `rentTiers`).
    pub const ALL: [RentTier; 6] = [
        RentTier::Unpriced,
        RentTier::NoRate,
        RentTier::VeryLow,
        RentTier::Low,
        RentTier::Average,
        RentTier::High,
    ];

    /// The tier's name in the layout's `rentTiers` table.
    pub fn name(self) -> &'static str {
        match self {
            RentTier::Unpriced => "unpriced",
            RentTier::NoRate => "noRate",
            RentTier::VeryLow => "veryLow",
            RentTier::Low => "low",
            RentTier::Average => "average",
            RentTier::High => "high",
        }
    }

    /// The tier's code: its place in [`RentTier::ALL`], which lists the
    /// tiers in declaration order (a test pins the two together).
    pub fn code(self) -> f64 {
        self as usize as f64
    }

    /// The tier of a Classic ladder rung by its place on the ladder
    /// (`ladder_level`'s answer). `ladder_level` always answers a place on
    /// the ladder, which a debug build asserts and a test pins for every
    /// Classic ladder; a release build reads any other place as
    /// [`OFF_LADDER_RENT`].
    pub(super) fn of_rung(rung: usize) -> RentTier {
        debug_assert!(
            rung < LADDER_TIERS.len(),
            "ladder_level answered {rung}, past the ladder"
        );
        LADDER_TIERS.get(rung).copied().unwrap_or(OFF_LADDER_RENT)
    }
}

/// The release fallback for a ladder place past the ladder, which cannot
/// happen: Average, the rung `ladder_level` itself answers for a price it
/// cannot place.
const OFF_LADDER_RENT: RentTier = RentTier::Average;

/// The tier of a band price that is not a number: Average, the neutral
/// reading.
const NAN_BAND_RENT: RentTier = RentTier::Average;

/// The tier of each rung of a Classic price ladder, in the ladder's order
/// (`CLASSIC_RENT_LADDERS`: Very Low, Low, Average, High).
pub(super) const LADDER_TIERS: [RentTier; 4] = [
    RentTier::VeryLow,
    RentTier::Low,
    RentTier::Average,
    RentTier::High,
];

/// Whether a room carries an evaluation: the rooms the Satisfaction heatmap
/// draws, a kind with a census population or a hotel room, with someone in
/// it (`is_present`).
pub(crate) fn carries_evaluation(u: &Unit) -> bool {
    let rated_kind = u.kind.facility().population > 0 || u.kind.is_hotel();
    rated_kind && u.is_present()
}

/// The evaluation tier of a room, from its satisfaction. A score that is not
/// a number (the loader clamps every score, so none should reach here) reads
/// as Terrible, the safe default.
pub fn eval_tier(u: &Unit) -> EvalTier {
    if !carries_evaluation(u) {
        return EvalTier::Unrated;
    }
    let score = u.satisfaction;
    if score.is_nan() || score < VACATE_RESCIND {
        EvalTier::Terrible
    } else if names_gripe(score) {
        EvalTier::Good
    } else {
        EvalTier::Excellent
    }
}

/// A Modern band price's tier. A price that is not a number reads Average,
/// the neutral reading. A price over the band's neutral price is High: the
/// "rent set too high" gripe's own test ([`RentConfig::over_neutral`]), so the
/// view never disagrees with the inspector, and +infinity reads High as the
/// gripe does. A price equal to the neutral price is Average: the batch
/// reprice's own "on the default" test ([`is_neutral_price`]), so a price off
/// the neutral price by any amount is not Average, as demand and satisfaction
/// read it. A price at or under the band's floor is Very Low, and any other
/// price is Low.
pub(super) fn band_tier(band: RentConfig, price: f64) -> RentTier {
    if price.is_nan() {
        NAN_BAND_RENT
    } else if band.over_neutral(price) {
        RentTier::High
    } else if is_neutral_price(price, band.default) {
        RentTier::Average
    } else if price <= band.min {
        RentTier::VeryLow
    } else {
        RentTier::Low
    }
}

/// The rent tier of a room in a tower of `mode`, from the price the editor
/// shows (`unit_price`): the Classic ladder's rung, or the Modern band's tier
/// ([`band_tier`]).
pub fn rent_tier(mode: GameMode, u: &Unit) -> RentTier {
    let Some(shape) = price_options(mode, u.kind) else {
        return RentTier::Unpriced;
    };
    if u.no_rate {
        return RentTier::NoRate;
    }
    let price = unit_price(mode, u);
    let Some(rungs) = shape else {
        let band = rent_config(u.kind);
        debug_assert!(
            band.is_some(),
            "price_options answers a band only for a kind with a band"
        );
        // A room with no price never reads as average-priced.
        return band.map_or(RentTier::Unpriced, |band| band_tier(band, price));
    };
    RentTier::of_rung(ladder_level(&rungs, price))
}

/// One room's tiers and where it is: `id` matches the view's room, and
/// `floor` and `x` its anchor tile.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RoomTier {
    pub id: i64,
    pub floor: i64,
    pub x: i64,
    pub eval: EvalTier,
    pub rent: RentTier,
}

#[doc(hidden)]
impl Simulation {
    /// Every room that carries an evaluation or a rent level, in the rooms'
    /// order (`room_units`, the view's room order). A room with neither is
    /// left out. Reads state only and changes nothing.
    pub fn room_tiers(&self) -> impl Iterator<Item = RoomTier> + '_ {
        let mode = self.mode;
        self.tower.room_units().filter_map(move |u| {
            let eval = eval_tier(u);
            let rent = rent_tier(mode, u);
            let carries = eval != EvalTier::Unrated || rent != RentTier::Unpriced;
            carries.then_some(RoomTier {
                id: u.id,
                floor: u.floor,
                x: u.x,
                eval,
                rent,
            })
        })
    }
}

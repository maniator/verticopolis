//! A Modern theater's ticket price (#1950). The player sets one of four
//! steps per theater: a lower price earns less per seat and draws more of
//! the crowd's cinema visits, a higher one earns more per seat and draws
//! fewer. Seats are capped, so a theater that turns people away can raise
//! its price without losing a seat until its demand falls below capacity.
//!
//! Classic has no ticket price: SimTower gives the player no such control,
//! so its list is empty and every theater earns and draws as Normal.

use serde::Serialize;

use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::sim::Simulation;
use crate::tower::Unit;

/// One ticket price step.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketPrice {
    /// The step's key, as the save and `setTicketPrice` name it.
    pub key: &'static str,
    /// The name the card shows.
    pub label: &'static str,
    /// What the step multiplies a theater's ticket income per seat by.
    pub income_mult: f64,
    /// What the step multiplies the share of the crowd's cinema visits a
    /// theater draws by.
    pub pick_mult: f64,
}

/// The step a theater with none set charges.
pub const NORMAL_TICKET_PRICE: &str = "normal";

/// Modern's steps, cheapest first, in the order the card's button cycles.
pub static MODERN_TICKET_PRICES: [TicketPrice; 4] = [
    TicketPrice {
        key: "low",
        label: "Low",
        income_mult: 0.75,
        pick_mult: 1.25,
    },
    TicketPrice {
        key: NORMAL_TICKET_PRICE,
        label: "Normal",
        income_mult: 1.0,
        pick_mult: 1.0,
    },
    TicketPrice {
        key: "high",
        label: "High",
        income_mult: 1.3,
        pick_mult: 0.75,
    },
    TicketPrice {
        key: "premium",
        label: "Premium",
        income_mult: 1.6,
        pick_mult: 0.55,
    },
];

impl GameMode {
    /// The ticket price steps a theater can charge, cheapest first, or an
    /// empty list where the mode has no ticket price (Classic).
    pub fn ticket_prices(self) -> &'static [TicketPrice] {
        match self {
            GameMode::Classic => &[],
            GameMode::Modern => &MODERN_TICKET_PRICES,
        }
    }

    /// The step a theater with none set charges, or `None` where the mode
    /// has no ticket price.
    pub fn ticket_price_default(self) -> Option<&'static str> {
        (!self.ticket_prices().is_empty()).then_some(NORMAL_TICKET_PRICE)
    }

    /// The listed step named `key`, or `None` where the mode lists none by
    /// that name.
    pub fn ticket_price(self, key: &str) -> Option<&'static TicketPrice> {
        self.ticket_prices().iter().find(|p| p.key == key)
    }
}

/// The step a theater charges, or `None` at Normal (no step set, or a mode
/// without ticket prices).
pub(crate) fn charged(mode: GameMode, u: &Unit) -> Option<&'static TicketPrice> {
    u.extras()
        .ticket_price
        .and_then(|key| mode.ticket_price(key))
}

/// The step a theater charges as the cards name it: its own, or Normal where
/// it has none. `None` for any other room and in a mode without ticket
/// prices.
pub(crate) fn shown_ticket_price(mode: GameMode, u: &Unit) -> Option<&'static str> {
    let normal = mode.ticket_price_default()?;
    (u.kind == Kind::Cinema).then(|| charged(mode, u).map_or(normal, |p| p.key))
}

/// What a theater's ticket price multiplies its ticket income per seat by.
pub(crate) fn ticket_income_mult(mode: GameMode, u: &Unit) -> f64 {
    charged(mode, u).map_or(1.0, |p| p.income_mult)
}

/// What a theater's ticket price multiplies its share of the crowd's cinema
/// visits by.
pub(crate) fn ticket_pick_mult(mode: GameMode, u: &Unit) -> f64 {
    charged(mode, u).map_or(1.0, |p| p.pick_mult)
}

impl Simulation {
    /// Sets the ticket price cinema `id` charges (Modern): one of the mode's
    /// steps (the [`catalog`](crate::catalog::catalog)'s `ticketPrices`).
    /// Returns the step set, or `None` when `id` is not a cinema or the mode
    /// lists no step named `key`. Normal is stored as no step at all, so a
    /// theater back at Normal saves as it did before it had a price.
    pub fn set_ticket_price(&mut self, id: i64, key: &str) -> Option<&'static str> {
        let step = self.tower.mode.ticket_price(key)?.key;
        let u = self.tower.get_unit_mut(id)?;
        if u.kind != Kind::Cinema {
            return None;
        }
        let stored = (step != NORMAL_TICKET_PRICE).then_some(step);
        if u.extras().ticket_price != stored {
            u.extras_mut().ticket_price = stored;
        }
        Some(step)
    }
}

#[cfg(test)]
#[path = "tickets_tests.rs"]
mod tests;

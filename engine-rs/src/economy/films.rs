//! Changing a theatre's film (#1932). SimTower charges a theatre nothing each
//! period: its film ages until ticket sales fall, and the player pays to show
//! a new film or a cheaper classic. A classic never draws more than a film
//! past its first days (`showing_draw`). Classic towers work this way; Modern
//! books a film each maintenance period instead (`pay_maintenance`).
//!
//! A theatre whose film draws a full house fills the crowd's and the
//! traffic model's blockbuster slots in Classic, the way a booked
//! blockbuster does in Modern: a new film for its first days, never a
//! classic.

use super::visitors::{showing_draw, NEW_FILM_DRAW};
use crate::facilities::Kind;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::Unit;

/// What showing a new film costs in SimTower.
pub const NEW_FILM_PRICE: f64 = 300_000.0;
/// What showing a classic film costs in SimTower.
pub const CLASSIC_FILM_PRICE: f64 = 150_000.0;

/// Why a theatre's film did not change.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FilmRefusal {
    /// The mode books films each period instead (Modern).
    Unavailable,
    /// The id names no theatre.
    NotTheater,
    /// The theatre is not open: under construction, burning or gutted.
    Closed,
    /// The film would cost more than the tower holds.
    Funds {
        /// The price of the film the player asked for.
        cost: f64,
    },
}

impl FilmRefusal {
    /// The refusal's reason, as the port reports it.
    pub fn reason(&self) -> &'static str {
        match self {
            FilmRefusal::Unavailable => "unavailable",
            FilmRefusal::NotTheater => "notTheater",
            FilmRefusal::Closed => "closed",
            FilmRefusal::Funds { .. } => "funds",
        }
    }
}

/// Whether a theatre's film draws a full house tonight.
pub(crate) fn draws_full_house(u: &Unit) -> bool {
    let extras = u.extras();
    let days_shown = i64::from(extras.film_days.unwrap_or(0));
    showing_draw(days_shown, extras.film_classic) == NEW_FILM_DRAW
}

impl Simulation {
    /// Shows a new film, or a classic when `classic`, at cinema `id`
    /// (Classic only; Modern books films each period). Charges the price
    /// ([`catalog`](crate::catalog::catalog)'s `new_film_price` or
    /// `classic_film_price`) and starts the film on its first day. Returns
    /// the price paid, or why the film did not change.
    pub fn change_film(&mut self, id: i64, classic: bool) -> Result<f64, FilmRefusal> {
        let Some((new_price, classic_price)) = self.tower.mode.film_changes() else {
            return Err(FilmRefusal::Unavailable);
        };
        let u = self
            .tower
            .get_unit(id)
            .filter(|u| u.kind == Kind::Cinema)
            .ok_or(FilmRefusal::NotTheater)?;
        if !u.is_operational() {
            return Err(FilmRefusal::Closed);
        }
        let cost = if classic { classic_price } else { new_price };
        if self.money < cost {
            return Err(FilmRefusal::Funds { cost });
        }
        self.money -= cost;
        self.record_money("entertainment", -cost);
        let full_house = {
            let u = self.tower.get_unit_mut(id).ok_or(FilmRefusal::NotTheater)?;
            let mut extras = u.extras_mut();
            extras.film_days = Some(0);
            extras.film_classic = classic;
            drop(extras);
            draws_full_house(u)
        };
        let key = id as f64;
        self.blockbusters.retain(|&b| b != key);
        if full_house {
            self.blockbusters.push(key);
        }
        let film = if classic {
            "A classic film"
        } else {
            "A new film"
        };
        self.emit(
            &format!(
                "🎬 {film} opens at the movie theater: ${} charged.",
                with_thousands(cost)
            ),
            LogKind::Money,
        );
        Ok(cost)
    }
}

#[cfg(test)]
#[path = "films_tests.rs"]
mod films_tests;

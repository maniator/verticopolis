//! A theatre's film (#1932, #1950). Neither mode charges a theatre each
//! period. The player pays to show a film, the film ages until its draw is
//! spent, and the mode's [`FilmRules`] say what each film costs, how long
//! it draws, and what it earns.
//!
//! Classic follows SimTower: a new film or a cheaper classic, a run of six
//! days at full draw and three fading, and a theatre whose new film draws a
//! full house fills the crowd's and the traffic model's blockbuster slots.
//!
//! Modern offers a revival, a feature or a blockbuster, each film draws for
//! 28 days and fades for 14, its income follows its tier and its age, and a
//! theatre books its chosen film again the morning the old one is spent
//! (`film_policy`, unless the player switched that off).

use serde::Serialize;

use super::visitors::{
    FADING_FILM_DRAW, FILM_SPENT_DAYS, NEW_FILM_DRAW, NEW_FILM_FULL_DRAW_DAYS, SPENT_FILM_DRAW,
};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::{Extras, Unit};

/// What showing a new film costs in SimTower.
pub const NEW_FILM_PRICE: f64 = 300_000.0;
/// What showing a classic film costs in SimTower.
pub const CLASSIC_FILM_PRICE: f64 = 150_000.0;
/// What a Modern revival, feature and blockbuster cost (#1950).
pub const MODERN_REVIVAL_PRICE: f64 = 60_000.0;
pub const MODERN_FEATURE_PRICE: f64 = 120_000.0;
pub const MODERN_BLOCKBUSTER_PRICE: f64 = 300_000.0;
/// What a theatre showing a blockbuster earns, against a feature's 1.
pub const BLOCKBUSTER_INCOME_MULT: f64 = 2.2;
/// What a Modern revival earns at full draw, against a feature's 1.
pub const REVIVAL_INCOME_MULT: f64 = 0.6;
/// The share of its full-draw income a Modern film earns while fading, and
/// once spent.
pub const FADING_INCOME_SHARE: f64 = 0.6;
pub const SPENT_INCOME_SHARE: f64 = 0.25;
/// A Modern film's days at full draw, and the age at which it is spent.
pub const MODERN_FULL_DRAW_DAYS: i64 = 28;
pub const MODERN_SPENT_DAYS: i64 = 42;

/// A film a theatre can show. Classic calls `New` a new film and `Classic` a
/// classic; Modern calls them a feature and a revival, and adds `Blockbuster`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilmTier {
    New,
    Classic,
    Blockbuster,
}

impl FilmTier {
    /// Every tier, in the order the port numbers them.
    pub const ALL: [FilmTier; 3] = [FilmTier::New, FilmTier::Classic, FilmTier::Blockbuster];

    /// The tier's key in the catalog and the port.
    pub fn key(self) -> &'static str {
        match self {
            FilmTier::New => "new",
            FilmTier::Classic => "classic",
            FilmTier::Blockbuster => "blockbuster",
        }
    }

    /// The film a theatre's saved flags say it shows.
    pub fn showing(extras: &Extras) -> FilmTier {
        if extras.film_classic {
            FilmTier::Classic
        } else if extras.film_blockbuster {
            FilmTier::Blockbuster
        } else {
            FilmTier::New
        }
    }

    /// The film a Modern theatre books again when its film is spent, by its
    /// policy, or `None` when the player switched rebooking off. A theatre
    /// with no policy, or the old "auto", books a feature.
    pub fn rebooked(policy: Option<&str>) -> Option<FilmTier> {
        match policy {
            Some("off") => None,
            Some("revival") => Some(FilmTier::Classic),
            Some("blockbuster") => Some(FilmTier::Blockbuster),
            _ => Some(FilmTier::New),
        }
    }
}

/// How far into its run a film is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilmStage {
    Full,
    Fading,
    Spent,
}

/// How long a film draws in a mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FilmRun {
    /// The days a film keeps its full draw.
    pub full_draw_days: i64,
    /// The age in days from which a film is spent.
    pub spent_days: i64,
}

impl FilmRun {
    /// The stage of a film that has shown for `days_shown` days.
    pub fn stage(self, days_shown: i64) -> FilmStage {
        if days_shown < self.full_draw_days {
            FilmStage::Full
        } else if days_shown < self.spent_days {
            FilmStage::Fading
        } else {
            FilmStage::Spent
        }
    }

    /// The census draw of a `tier` film that has shown for `days_shown`
    /// days: 2, 1 and 0 through its run, and never past a fading film's for
    /// a classic or revival.
    pub fn draw(self, days_shown: i64, tier: FilmTier) -> i64 {
        let draw = match self.stage(days_shown) {
            FilmStage::Full => NEW_FILM_DRAW,
            FilmStage::Fading => FADING_FILM_DRAW,
            FilmStage::Spent => SPENT_FILM_DRAW,
        };
        if tier == FilmTier::Classic {
            draw.min(FADING_FILM_DRAW)
        } else {
            draw
        }
    }
}

/// A film a mode lets the player show.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmOffer {
    #[serde(skip)]
    pub tier: FilmTier,
    /// The tier's key, as the catalog publishes it.
    pub key: &'static str,
    /// What the card calls the film.
    pub label: &'static str,
    /// What showing it costs.
    pub price: f64,
    /// How the log opens the film ("A new film opens...").
    #[serde(skip)]
    pub opening: &'static str,
    /// What it earns at full draw, against a feature's 1, where income
    /// follows the film's age.
    #[serde(skip)]
    pub income_mult: f64,
}

/// A mode's film rules.
#[derive(Debug)]
pub struct FilmRules {
    /// The films the player can show, in the order the card lists them.
    pub offers: &'static [FilmOffer],
    pub run: FilmRun,
    /// The tier whose film fills the blockbuster slots at full draw.
    pub blockbuster_tier: FilmTier,
    /// Whether a theatre books its policy's film again once its film is
    /// spent (Modern).
    pub rebooks_spent: bool,
    /// Whether a theatre's income follows its film's tier and age (Modern).
    /// Classic earns the blockbuster multiplier in a blockbuster slot only.
    pub income_follows_film: bool,
}

impl FilmRules {
    /// The offer for `tier`, or `None` where the mode has no such film.
    pub fn offer(&self, tier: FilmTier) -> Option<&'static FilmOffer> {
        self.offers.iter().find(|o| o.tier == tier)
    }
}

pub static CLASSIC_FILMS: FilmRules = FilmRules {
    offers: &[
        FilmOffer {
            tier: FilmTier::New,
            key: "new",
            label: "New film",
            price: NEW_FILM_PRICE,
            opening: "A new film",
            income_mult: 1.0,
        },
        FilmOffer {
            tier: FilmTier::Classic,
            key: "classic",
            label: "Classic film",
            price: CLASSIC_FILM_PRICE,
            opening: "A classic film",
            income_mult: 1.0,
        },
    ],
    run: FilmRun {
        full_draw_days: NEW_FILM_FULL_DRAW_DAYS,
        spent_days: FILM_SPENT_DAYS,
    },
    blockbuster_tier: FilmTier::New,
    rebooks_spent: false,
    income_follows_film: false,
};

pub static MODERN_FILMS: FilmRules = FilmRules {
    offers: &[
        FilmOffer {
            tier: FilmTier::Classic,
            key: "classic",
            label: "Revival",
            price: MODERN_REVIVAL_PRICE,
            opening: "A revival",
            income_mult: REVIVAL_INCOME_MULT,
        },
        FilmOffer {
            tier: FilmTier::New,
            key: "new",
            label: "Feature",
            price: MODERN_FEATURE_PRICE,
            opening: "A feature",
            income_mult: 1.0,
        },
        FilmOffer {
            tier: FilmTier::Blockbuster,
            key: "blockbuster",
            label: "Blockbuster",
            price: MODERN_BLOCKBUSTER_PRICE,
            opening: "A blockbuster",
            income_mult: BLOCKBUSTER_INCOME_MULT,
        },
    ],
    run: FilmRun {
        full_draw_days: MODERN_FULL_DRAW_DAYS,
        spent_days: MODERN_SPENT_DAYS,
    },
    blockbuster_tier: FilmTier::Blockbuster,
    rebooks_spent: true,
    income_follows_film: true,
};

/// Why a theatre's film did not change.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FilmRefusal {
    /// The mode offers no such film (a blockbuster in Classic).
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

/// The tier a theatre shows and the days it has shown.
fn showing(u: &Unit) -> (FilmTier, i64) {
    let extras = u.extras();
    (
        FilmTier::showing(extras),
        i64::from(extras.film_days.unwrap_or(0)),
    )
}

/// Whether a theatre's film fills a blockbuster slot tonight: the mode's
/// blockbuster film at full draw.
pub(crate) fn fills_blockbuster_slot(mode: GameMode, u: &Unit) -> bool {
    let films = mode.films();
    let (tier, days) = showing(u);
    tier == films.blockbuster_tier && films.run.stage(days) == FilmStage::Full
}

/// The census draw of a theatre's film tonight.
pub(crate) fn audience_draw(mode: GameMode, u: &Unit) -> i64 {
    let (tier, days) = showing(u);
    mode.films().run.draw(days, tier)
}

/// What a theatre's film multiplies its ticket income by. `in_slot` is
/// whether it holds a blockbuster slot, which is all Classic reads.
pub(crate) fn film_income_mult(mode: GameMode, u: &Unit, in_slot: bool) -> f64 {
    let films = mode.films();
    if !films.income_follows_film {
        return if in_slot {
            BLOCKBUSTER_INCOME_MULT
        } else {
            1.0
        };
    }
    let (tier, days) = showing(u);
    let peak = films.offer(tier).map_or(1.0, |o| o.income_mult);
    let share = match films.run.stage(days) {
        FilmStage::Full => 1.0,
        FilmStage::Fading => FADING_INCOME_SHARE,
        FilmStage::Spent => SPENT_INCOME_SHARE,
    };
    peak * share
}

impl Simulation {
    /// Shows a `tier` film at cinema `id`: charges the price (the
    /// [`catalog`](crate::catalog::catalog)'s `films`) and starts the film on
    /// its first day. Returns the price paid, or why the film did not change
    /// (a tier the mode does not offer is `Unavailable`).
    pub fn change_film(&mut self, id: i64, tier: FilmTier) -> Result<f64, FilmRefusal> {
        let mode = self.tower.mode;
        let offer = mode.films().offer(tier).ok_or(FilmRefusal::Unavailable)?;
        let u = self
            .tower
            .get_unit(id)
            .filter(|u| u.kind == Kind::Cinema)
            .ok_or(FilmRefusal::NotTheater)?;
        if !u.is_operational() {
            return Err(FilmRefusal::Closed);
        }
        let cost = offer.price;
        if self.money < cost {
            return Err(FilmRefusal::Funds { cost });
        }
        self.money -= cost;
        self.record_money("entertainment", -cost);
        let fills_slot = {
            let u = self.tower.get_unit_mut(id).ok_or(FilmRefusal::NotTheater)?;
            let mut extras = u.extras_mut();
            extras.film_days = Some(0);
            extras.film_classic = tier == FilmTier::Classic;
            extras.film_blockbuster = tier == FilmTier::Blockbuster;
            drop(extras);
            fills_blockbuster_slot(mode, u)
        };
        let key = id as f64;
        self.blockbusters.retain(|&b| b != key);
        if fills_slot {
            self.blockbusters.push(key);
        }
        self.emit(
            &format!(
                "🎬 {} opens at the movie theater: ${} charged.",
                offer.opening,
                with_thousands(cost)
            ),
            LogKind::Money,
        );
        Ok(cost)
    }

    /// Where the mode rebooks spent films (Modern), each open theatre whose
    /// film is spent books its policy's film again. Runs after the day's
    /// rollover, so the spent film's last night is counted first. A theatre
    /// that cannot pay keeps its spent film, and the log says so on the
    /// morning the film is spent.
    pub fn rebook_spent_films(&mut self) {
        let films = self.tower.mode.films();
        if !films.rebooks_spent {
            return;
        }
        let due: Vec<(i64, FilmTier, bool, i64)> = self
            .tower
            .units_of_kind(Kind::Cinema)
            .filter(|u| u.is_operational())
            .filter_map(|u| {
                let (_, days) = showing(u);
                let tier = FilmTier::rebooked(u.extras().film_policy)?;
                (days >= films.run.spent_days).then_some((
                    u.id,
                    tier,
                    days == films.run.spent_days,
                    u.floor,
                ))
            })
            .collect();
        for (id, tier, first_spent_morning, floor) in due {
            if let Err(FilmRefusal::Funds { cost }) = self.change_film(id, tier) {
                if first_spent_morning {
                    let label = films.offer(tier).map_or("film", |o| o.label);
                    let msg = format!(
                        "🎬 The movie theater on {} can't afford its next {} (${}).",
                        self.floor_label(floor),
                        label.to_lowercase(),
                        with_thousands(cost)
                    );
                    self.emit(&msg, LogKind::Bad);
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "films_tests.rs"]
mod films_tests;

#[cfg(test)]
#[path = "films_modern_tests.rs"]
mod films_modern_tests;

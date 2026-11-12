//! A theater's screens (#1950). SimTower's theater shows one film; a Modern
//! theater's two floors are two screens with half the seats each, and each
//! screen has its own film, age and Auto-rebook choice. The ticket price
//! stays the theater's.
//!
//! The first screen keeps the fields a theater always had (`film_days`,
//! `film_classic`, `film_blockbuster`, `film_policy`). The second is stored
//! only while it differs from the first: a theater whose screens show the
//! same film at the same age, as every theater from before #1950 does, saves
//! exactly as it did.

use serde_json::{json, Map, Value};

use super::films::{FilmRefusal, FilmTier};
use crate::clock::GameMode;
use crate::facilities::Kind;
use crate::services::with_thousands;
use crate::sim::{LogKind, Simulation};
use crate::tower::{Extras, Unit};

/// The film one screen shows, its age, and the film it books again once
/// that one is spent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScreenFilm {
    pub tier: FilmTier,
    /// The days the film has shown, unset before its first night.
    pub days: Option<u8>,
    /// The Auto-rebook choice, unset for the mode's default.
    pub policy: Option<&'static str>,
}

impl ScreenFilm {
    /// The first screen's film, from a theater's own fields.
    pub fn first(extras: &Extras) -> ScreenFilm {
        ScreenFilm {
            tier: FilmTier::showing(extras),
            days: extras.film_days,
            policy: extras.film_policy,
        }
    }

    /// The days the film has shown.
    pub fn days_shown(self) -> i64 {
        i64::from(self.days.unwrap_or(0))
    }

    /// Whether two screens show the same film at the same age and book the
    /// same one again: a film not yet counted has shown 0 days either way.
    pub fn same_as(self, other: ScreenFilm) -> bool {
        self.tier == other.tier
            && self.days_shown() == other.days_shown()
            && self.policy == other.policy
    }

    /// The screen as a save writes it, with the keys a theater's first
    /// screen uses, each left out while unset.
    pub fn to_json(self) -> Value {
        let mut m = Map::new();
        if let Some(policy) = self.policy {
            m.insert("filmPolicy".into(), json!(policy));
        }
        if let Some(days) = self.days {
            m.insert("filmDays".into(), json!(days));
        }
        if self.tier == FilmTier::Classic {
            m.insert("filmClassic".into(), json!(true));
        }
        if self.tier == FilmTier::Blockbuster {
            m.insert("filmBlockbuster".into(), json!(true));
        }
        Value::Object(m)
    }
}

impl Extras {
    /// These extras with a second screen like the first dropped, as a save
    /// leaves it out.
    pub(crate) fn without_mirrored_screen(mut self) -> Extras {
        let first = ScreenFilm::first(&self);
        if self
            .second_screen
            .is_some_and(|second| second.same_as(first))
        {
            self.second_screen = None;
        }
        self
    }
}

/// Both screens of a theater. Where the mode runs one screen, the second is
/// the first.
pub(crate) fn screens(mode: GameMode, u: &Unit) -> [ScreenFilm; 2] {
    let first = ScreenFilm::first(u.extras());
    let second = if mode.cinema_screens() > 1 {
        u.extras().second_screen.unwrap_or(first)
    } else {
        first
    };
    [first, second]
}

/// The screens a theater runs in its mode.
pub(crate) fn running_screens(mode: GameMode, u: &Unit) -> impl Iterator<Item = ScreenFilm> {
    screens(mode, u).into_iter().take(mode.cinema_screens())
}

/// Writes both screens of a theater. Where the mode runs one screen the
/// second follows the first, and a second screen like the first
/// ([`ScreenFilm::same_as`]) is not stored.
pub(crate) fn put_screens(mode: GameMode, u: &mut Unit, [first, second]: [ScreenFilm; 2]) {
    let mut extras = u.extras_mut();
    extras.film_days = first.days;
    extras.film_classic = first.tier == FilmTier::Classic;
    extras.film_blockbuster = first.tier == FilmTier::Blockbuster;
    extras.film_policy = first.policy;
    let apart = mode.cinema_screens() > 1 && !second.same_as(first);
    extras.second_screen = apart.then_some(second);
}

/// Puts each screen's Auto-rebook choice from `policies`, leaving the films.
/// Reads no mode: a theater whose mode runs one screen stores no second
/// screen, so its two choices are the same and stay so.
pub(crate) fn put_screen_policies(u: &mut Unit, policies: [Option<&'static str>; 2]) {
    let first = ScreenFilm::first(u.extras());
    let mut screens = [first, u.extras().second_screen.unwrap_or(first)];
    for (screen, policy) in screens.iter_mut().zip(policies) {
        screen.policy = policy;
    }
    let mut extras = u.extras_mut();
    extras.film_policy = screens[0].policy;
    extras.second_screen = (!screens[1].same_as(screens[0])).then_some(screens[1]);
}

/// Each screen's Auto-rebook choice, as an undo keeps them.
pub(crate) fn screen_policies(u: &Unit) -> [Option<&'static str>; 2] {
    let first = ScreenFilm::first(u.extras());
    let second = u.extras().second_screen.unwrap_or(first);
    [first.policy, second.policy]
}

/// How the log names a screen: nothing for the first, so a one-screen
/// theater's lines read as they always did.
fn screen_words(screen: usize) -> &'static str {
    if screen == 0 {
        ""
    } else {
        " on the second screen"
    }
}

impl Simulation {
    /// Shows a `tier` film on cinema `id`'s first screen ([`book_film`]).
    ///
    /// [`book_film`]: Simulation::book_film
    pub fn change_film(&mut self, id: i64, tier: FilmTier) -> Result<f64, FilmRefusal> {
        self.book_film(id, 0, tier)
    }

    /// Shows a `tier` film on screen `screen` (from 0) of cinema `id`:
    /// charges the price (the [`catalog`](crate::catalog::catalog)'s `films`)
    /// and starts the film on its first day. Returns the price paid, or why
    /// the film did not change (a tier the mode does not offer is
    /// `Unavailable`, a screen the theater does not run is `NoScreen`).
    pub fn book_film(
        &mut self,
        id: i64,
        screen: usize,
        tier: FilmTier,
    ) -> Result<f64, FilmRefusal> {
        let mode = self.tower.mode;
        let offer = mode.films().offer(tier).ok_or(FilmRefusal::Unavailable)?;
        let u = self
            .tower
            .get_unit(id)
            .filter(|u| u.kind == Kind::Cinema)
            .ok_or(FilmRefusal::NotTheater)?;
        if screen >= mode.cinema_screens() {
            return Err(FilmRefusal::NoScreen);
        }
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
            let mut films = screens(mode, u);
            films[screen].tier = tier;
            films[screen].days = Some(0);
            put_screens(mode, u, films);
            super::films::fills_blockbuster_slot(mode, u)
        };
        let key = id as f64;
        self.blockbusters.retain(|&b| b != key);
        if fills_slot {
            self.blockbusters.push(key);
        }
        self.emit(
            &format!(
                "🎬 {} opens{} at the movie theater: ${} charged.",
                offer.opening,
                screen_words(screen),
                with_thousands(cost)
            ),
            LogKind::Money,
        );
        Ok(cost)
    }

    /// Sets the film cinema `id`'s first screen books again once its film is
    /// spent ([`set_screen_policy`]).
    ///
    /// [`set_screen_policy`]: Simulation::set_screen_policy
    pub fn set_film_policy(&mut self, id: i64, policy: &str) -> Option<&'static str> {
        self.set_screen_policy(id, 0, policy)
    }

    /// Sets the film screen `screen` (from 0) of cinema `id` books again once
    /// its film is spent (Modern): `auto` or `feature` (a feature),
    /// `revival`, `blockbuster`, or `off`. Returns the policy set, or `None`
    /// when `id` is not a cinema, the theater runs no such screen, or
    /// `policy` is none of the five.
    pub fn set_screen_policy(
        &mut self,
        id: i64,
        screen: usize,
        policy: &str,
    ) -> Option<&'static str> {
        let policy: &'static str = match policy {
            "auto" => "auto",
            "feature" => "feature",
            "blockbuster" => "blockbuster",
            "revival" => "revival",
            "off" => "off",
            _ => return None,
        };
        let mode = self.tower.mode;
        if screen >= mode.cinema_screens() {
            return None;
        }
        let u = self.tower.get_unit_mut(id)?;
        if u.kind != Kind::Cinema {
            return None;
        }
        let mut films = screens(mode, u);
        films[screen].policy = Some(policy);
        put_screens(mode, u, films);
        Some(policy)
    }

    /// Where the mode rebooks spent films (Modern), each screen of an open
    /// theater whose film is spent books its policy's film again, and pays
    /// for it. Runs after the day's rollover, so the spent film's last night
    /// is counted first. A screen that cannot pay keeps its spent film, and
    /// the log says so on the morning the film is spent.
    pub fn rebook_spent_films(&mut self) {
        let mode = self.tower.mode;
        let films = mode.films();
        if films.rebooks.is_empty() {
            return;
        }
        let spent = films.run.spent_days;
        let mut due: Vec<(i64, usize, FilmTier, bool, i64)> = Vec::new();
        for u in self.tower.units_of_kind(Kind::Cinema) {
            if !u.is_operational() {
                continue;
            }
            for (screen, film) in running_screens(mode, u).enumerate() {
                let days = film.days_shown();
                if days < spent {
                    continue;
                }
                if let Some(tier) = films.rebooked(film.policy) {
                    due.push((u.id, screen, tier, days == spent, u.floor));
                }
            }
        }
        for (id, screen, tier, first_spent_morning, floor) in due {
            if let Err(FilmRefusal::Funds { cost }) = self.book_film(id, screen, tier) {
                if first_spent_morning {
                    let label = films.offer(tier).map_or("film", |o| o.label);
                    let msg = format!(
                        "🎬 The movie theater on {} can't afford its next {}{} (${}).",
                        self.floor_label(floor),
                        label.to_lowercase(),
                        screen_words(screen),
                        with_thousands(cost)
                    );
                    self.emit(&msg, LogKind::Bad);
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "screens_tests.rs"]
mod screens_tests;

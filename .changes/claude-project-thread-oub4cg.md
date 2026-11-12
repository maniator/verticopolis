---
app: minor
crate: minor
---
## Player
- In Modern, a movie theater no longer pays a booking every month. You pay once to show a Revival ($60,000), a Feature ($120,000) or a Blockbuster ($300,000). A film draws a full house for four weeks and fades for two, and its ticket income follows: a blockbuster earns the most, a revival the least, and a fading film less than a fresh one (#1950).
- A Modern theater's card shows its film and how long it has been showing, with a button for each film and an Auto-rebook button. When a film is spent, the theater books its Auto-rebook film again (a Feature unless you pick another, or Off). A new theater opens with a free feature. Classic theaters are unchanged.
## Engine
- `economy::films` gains `FilmTier` (`New`, `Classic`, `Blockbuster`), `FilmRules` and `FilmRun`; `GameMode::films()` replaces `film_changes()`. `Simulation::change_film(id, tier)` takes a tier, refusing `unavailable` for a tier the mode lacks (a blockbuster in Classic), and `rebook_spent_films` books a Modern theatre's policy film after the morning rollover. `pay_maintenance` charges no film in either mode and answers nothing; `start_booked_films`, `CINEMA_BOOKING_MONTHLY` and `CINEMA_BOOKING_BLOCKBUSTER` are gone.
- Modern's ticket income multiplier follows the film's tier and stage (`film_income_mult`); Classic keeps its blockbuster slot at 2.2. Modern's blockbuster slots are its blockbusters at full draw.
- `Extras` gains `film_blockbuster` (saved as `filmBlockbuster`); a Modern save from before this lists its booked blockbusters in `blockbusters`, and those load as blockbusters. Film policies add `revival` and `off`.
- The port's `changeFilm(id, tier)` takes a code from the new `filmTiers` list, and `unitCard`'s `filmClassic` slot is now `filmTier`. The catalog's `films` (key, label, price), `filmRebooks` (each Auto-rebook policy and its film, in the button's order) and `filmRebookDefault` replace `cinemaBookingMonthly`, `cinemaBookingBlockbusterMonthly`, `newFilmPrice` and `classicFilmPrice`; `CATALOG_VERSION` is 9.
- The conformance lock moves for the twelve Modern scenarios only (the monthly booking no longer draws from the random stream); `amenities-modern` no longer scripts the ransom that draw used to bring on day six.

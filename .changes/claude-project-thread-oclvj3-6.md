---
app: minor
crate: minor
---
## Player
- In Classic, a movie theater no longer costs a booking every few days. Its film ages until ticket sales fall, and the theater's card shows the film and how long it has been showing, with buttons to show a new film ($300,000) or a cheaper classic ($150,000) that never fills the house, as in the original game (#1932).
- In Modern, each film booking starts a fresh film, so a theater's audience is back to full after every booking (#1932).
- A classic film stays a classic through a SimTower import and export (#1932).
## Engine
- `Simulation::change_film(id, classic)` and the port command `changeFilm(id, classic)` (a `cost` slot; refusals `unavailable`, `notTheater`, `closed` and `funds`) change a Classic theatre's film. `GameMode::film_changes` gives the prices, and the catalog adds `newFilmPrice` and `classicFilmPrice` (null in Modern); `CATALOG_VERSION` is 8.
- `Extras` gains `film_classic` (saved as `filmClassic`, cinemas only), and `visitors::showing_draw` holds a classic's draw to 1. Classic's `pay_maintenance` books no films, and its blockbusters are the theatres whose film draws a full house, set at the morning rollover, on a change and when a theater opens. Modern's booking resets the film after the day's rollover has counted the spent one (`pay_maintenance` now answers the booked theatres, and `start_booked_films` opens their films). The conformance lock moves.
- `unitCard` adds the `filmDays` and `filmClassic` slots, and the frame layout's `VIEW_LAYOUT_VERSION` is 14.
- The TDT importer reads a film number below 6 as a classic and the exporter writes film 3 for one (`venues::is_classic_film`, `TdtVenue::shows_classic`).

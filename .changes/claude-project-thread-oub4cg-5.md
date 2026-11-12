---
app: minor
crate: minor
---
## Player
- In Modern, each movie theater runs two screens (#1950). Each screen has half the seats, its own film, its own age and its own Auto-rebook choice, and pays for its own films. Book them on different days so one screen always has a fresh film, or pair a blockbuster with a cheap revival. The theater card shows a row for each screen, the films to book on each, and a "Screen 1 auto-rebook" and "Screen 2 auto-rebook" button. The ticket price stays one per theater. A Modern tower saved before this loads with both screens showing the theater's film, and nothing is charged; when that film is spent, each screen books its next film and pays for it. Classic theaters keep one screen.
## Engine
- New `economy::screens`: `ScreenFilm` (tier, days, policy) and `Simulation::book_film(id, screen, tier)` and `set_screen_policy(id, screen, policy)`; `change_film` and `set_film_policy` book and set the first screen. `GameMode::cinema_screens()` is 1 in Classic and 2 in Modern; a screen the theater does not run is refused (`FilmRefusal::NoScreen`, reason `noScreen`, or `None`).
- `Extras` gains `second_screen`, saved as `screen2` (with the first screen's keys) only while a Modern theater's second screen differs from its first, so a theater whose screens match saves as before, and a save without one shows the first screen's film on both. A Classic save or another room reads none.
- A theater's census audience and its film income multiplier are the mean over its screens, and it fills a blockbuster slot when any screen shows the mode's blockbuster at full draw. Each screen ages each night and rebooks its own policy's film once spent, so a Modern theater whose two screens are spent books twice. Of the conformance lock's scenarios only `player-edits-modern` moves: its film policy now sets the first screen alone, so the save carries a second screen.
- An undo step puts back each screen's film policy; the undo signature counts a second screen's policy where it differs from the first's.
- The catalog's economy gains `cinemaScreens`; `CATALOG_VERSION` is 13. The port's `setFilm(id, code, screen)` and `changeFilm(id, tier, screen)` take a screen from 0, and `unitCard` gains `screen2Policy`, `screen2Days` and `screen2Tier`, so `VIEW_LAYOUT_VERSION` is 19. `unitDetail` reports `screen2`.

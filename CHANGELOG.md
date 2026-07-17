# Changelog

Player-facing release notes. Each `## <version>` section lists the lines shown
in the in-game "What's new" update prompt for that build: the build reads the
section matching `package.json` `version` into `dist/version.json` `notes` (see
`emitVersionJson` in `vite.config.ts`). Only genuinely player-noticeable changes
earn a line. Internal, tooling, perf, and refactor work gets none, and that build
simply shows the build-id line. At most three lines are shown; keep to the few
that matter, written as a player outcome in a calm voice (see CONTRIBUTING.md
"Player notes" for the house style).

Entries below 1.51.1 were curated from the commit history after the fact, so they
are documentation only: a client only ever fetches the currently deployed build's
notes, never a past version's.

## 1.60.0

- New music: the start screen has its own warm, hummable theme, and in the tower a calm, slowly drifting bed plays that shifts gently over a couple of minutes instead of looping the same short tune. The two glide into each other when you start a tower rather than cutting.

## 1.59.0

- Elevator demand is now measured separately for weekdays and weekends. The Schedule dialog's demand dashes and advice follow the day tab you are on, and Auto-tune adjusts each day only from its own measurements, so an office tower that sleeps on weekends no longer gets weekday-rush advice for its Weekend schedule.

## 1.58.0

- The elevator Schedule dialog is now the one place you configure a shaft: serviced floors, per-car home staging, and hourly scheduling live in a single floors-by-cars grid, just like the 1994 Elevator window. The separate Configure stops dialog is gone.
- The cars-on-shift strip shows your measured demand as a dashed line, with any spare capacity above it drawn pale, and on phones the whole dialog got friendlier: bigger targets, a tap-then-stepper hint, and hold-to-repeat steppers.

## 1.57.2

- The "too few shops or restaurants" gripe now says which problem you actually have: not enough retail for the tower's crowds (build more, on any connected floor) or retail that no shopper can reach (reconnect it). It no longer tells you to build "near this floor", which never mattered.

## 1.57.0

- Big hotels can finally staff up: every housekeeping unit now fields its full six maids no matter how many units you build. A hidden 64-maid tower-wide limit used to starve large hotels below their built capacity; the original game has no such pool, and now neither do we.

## 1.56.0

- Modern towers gain smart housekeeping dispatch: maids now rescue the rooms closest to infestation first, weighing how long a room has waited against how far away the nearest crew is. Classic keeps the original's simple order.

## 1.55.0

- The housekeeping picture stops hiding trouble: infestation alerts now name the floors, infested rooms get their own violet shade on the Housekeeping overlay (condos read as not-applicable gray), and the stats verdict turns red when rooms go unserved or any room is infested.

## 1.54.0

- Housekeeping now fields six real maids per unit who walk the tower, spend time cleaning each room, and work the classic noon-to-five shift in Classic towers, so how many rooms get cleaned depends on your service elevators and stairs.
- Housekeeping staff no longer ride escalators, matching the original: give your crews a service elevator or stairs to reach their floors.

## 1.53.1

- Cockroaches now spread only from fully infested rooms, never from a room that is merely waiting to be cleaned, so a tidy tower stops raising false roach alarms.

## 1.53.0

- Neglected hotel rooms now crawl with cockroaches, and a room left dirty too long becomes infested until you clear it: bulldoze it in Classic, or call a paid exterminator in Modern towers.
- Fires can now spread up to the floor above, not just along their own floor.
- The stats panel shows how many rooms your housekeeping crews actually reach.

## 1.52.0

- On rainy days fewer people are out and about, so cinemas and other venues draw smaller crowds.

## 1.51.2

- Elevators in a bank now share waiting riders instead of crowding one shaft.

## 1.51.1

- Verticopolis loads faster when you reopen it.

## 1.51.0

- In Classic towers, riders switch between express and local elevators only at lobby and sky-lobby floors.

## 1.50.1

- The game now keeps itself up to date, so you always have the latest version.

## 1.49.0

- Modern towers now send condo residents on school runs and office workers out on sales calls.

## 1.47.0

- Tenants grow restless when nearby demand goes unmet.

## 1.46.0

- A new map overlay shows housekeeping coverage across the tower.

## 1.45.0

- Shops and restaurants now draw different crowds on weekdays and weekends.

## 1.44.0

- Tenants now mind how far their floor sits from a lobby.

## 1.43.0

- The retail inspector now advises on commercial demand in Modern towers.

## 1.42.0

- The retail inspector now shows each venue's local demand.

## 1.41.0

- A metro that commuters cannot reach now shows a warning.

## 1.36.0

- The inspector now names a tenant's main complaint before they move out.

## 1.35.0

- A new checklist shows what is blocking your next star.

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

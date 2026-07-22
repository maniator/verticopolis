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

## 1.84.1

- A sideways trackpad scroll over the tower no longer zooms the view; zooming with the wheel while holding Shift still works in both directions.

## 1.84.0

- On desktop you can now hold Shift and drag to move around the tower with any tool selected, so you no longer have to switch to Inspect or reach for the spacebar mid-build.
- The "Can't build here" hover card now sits below the spot it explains, and lets the red preview show through, so you can see where a placement fails.

## 1.83.0

- The Sprite Gallery is friendlier: it now fits your screen and scrolls down instead of sideways (no more sideways scroll on a phone), Modern-only content sits in its own labeled section, and the title-bar buttons are a comfortable size.

## 1.82.0

- Modern towers can build a new Food Hall: a hall of food stalls (ramen, tacos, bubble tea, and more) that earns from foot traffic and satisfies many cravings from one spot, so it feeds a wide reach of hungry tenants. Modern only; Classic keeps the 1994 catalog.

## 1.81.0

- Classic shops, restaurants, fast food, cinemas, and party halls now earn toward their 1994 figures (a sold-out shop can take $20,000 a day, and a full party hall can too), so a busy tower's commercial floors pay the way they did in the original. Modern towers are unchanged.

## 1.80.0

- New Tower now offers a Modern "manual structure" option: turn it on and you place and pay for every floor and lobby tile yourself, with rooms no longer auto-laying the floor beneath them. For players who want full control of the build. Off by default, so nothing changes unless you pick it.

## 1.79.0

- Modern towers now start on an empty lot too, just like Classic and the 1994 original: where to lay the first lobby is your first decision. (Modern used to begin with a ready lobby at the center.)

## 1.78.0

- Classic offices now pay their full 1994 rent every quarter (an Average office pays its whole $10,000 each 3-day quarter), the fast office money the original was known for, matching what period guides describe. Modern towers are unchanged.

## 1.76.0

- Classic towers now start the way 1994 did: an empty lot, and where to lay the first lobby is your first decision (a hint shows first-timers the way). Modern towers keep starting with a ready lobby at the center.

## 1.75.1

- Saving now tells you when the save could not be written (storage full or blocked), instead of silently claiming success.

## 1.75.0

- Accessibility polish: routine notices no longer interrupt a screen reader mid-sentence (only real errors do), repeated announcements speak again reliably, the tower-name box reads clearly to assistive tech, and the money readout has stronger contrast so it is easier to read.

## 1.74.0

- The lot's left edge is now a grand arrival: a sidewalk leads to a fountain roundabout with live, splashing water, flanked by street lamps that come on at dusk with pools of warm light, and the road runs off past the city. The right-edge street lamp lights up at night now too.
- The city skyline behind your tower grew to city scale: real high-rises in two depths instead of a distant low ridge.

## 1.73.0

- The world outside your tower came to life: a city skyline behind the building, grass and trees on the open lot that make way as you pave it, a neighboring building across the alley at one end of the lot, and a street with a lamp and a 375 ST sign at the other.
- Building past the edge of the lot now says "That's the edge of the lot" instead of doing nothing silently.

## 1.72.0

- The Classic vs Modern guide now covers how stairs and escalators differ: Modern lets people climb any number of flights, while Classic keeps the 1994 limit and needs an elevator for a long climb.

## 1.71.0

- The Help page at /help now shows the full guide, pictures included, even before scripts run or with JavaScript off, so shared links and search results carry the real content.

## 1.70.1

- The elevator schedule dialog scrolls as one piece on desktop, instead of showing a second scrollbar inside the floors grid.

## 1.70.0

- The Help page's Classic vs Modern section now shows side-by-side screenshots of the two rule-sets, and the Sprite Gallery's link to that page now reads "Help".

## 1.69.1

- Opening /help now always loads the current guide, instead of a saved older copy on a return visit.

## 1.69.0

- The shareable Help page at /help is now the full how-to-play guide: the basics, growing your rating, keyboard controls, and the Classic vs Modern comparison. In-game Help links straight to the comparison section of it.

## 1.68.0

- The Classic vs Modern comparison now has its own shareable page you can link to, reachable from Help, and the sprite gallery wears the same title-bar look.
- The game opens straight onto the title screen now, instead of briefly flashing an empty tower first.

## 1.67.0

- People now ride as many elevators as it takes to reach a floor, matching the original, instead of giving up after two rides. Long trips still cost you through crowding and waiting, so sky lobbies and express elevators keep a tall tower moving rather than being needed just to reach the top.

## 1.65.0

- People will climb a few more flights of stairs before they need an elevator, matching the original. In Classic, stairs and escalators now carry a person up to 4 and 7 contiguous flights (an elevator ride resets the count) instead of dead-ending at two.

## 1.64.0

- Towers exported as an original 1994 SimTower save (.TDT) now render every floor in the real game. Wide floors with an empty-floor gap used to lose everything past the gap to open sky; they now show all their rooms.

## 1.63.0

- Restaurants and fast food have more variety: a wider mix of clinks, plate set-downs, tray clatter, and register tones on irregular timing, so a busy eatery no longer loops the same short pattern.
- The background room tone sits lower and warmer behind every area, so scenes read as quiet rooms rather than faint static.

## 1.62.0

- The tower now sounds alive: every area has its own ambience, built from real voice recordings. Lobbies murmur, restaurants clink, offices type and take calls, condos hum with a faint TV at midday, the party hall plays a dance remix of the game's theme with real laughs, the cinema rumbles behind its doors, and trains actually roll in and out of the metro.
- What you hear is honest: empty venues stay quiet, full ones get lively, offices sleep at night, and zooming in brings the detail up close. The last of the old random beeps are gone.
- Settings now has three volume sliders (Music, Ambience, Effects), so you can turn the music down and still hear the crowd, and the sliders respond evenly across their whole range.

## 1.61.1

- The occasional close-up sounds when you zoom into a floor (elevator dings, register beeps, and the like) are quieter and rarer now, so they sit behind the new music instead of competing with it.

## 1.61.0

- The Schedule dialog now shows where your riders actually come from: red hotspot markers flag the floors where most boarding happens at the busiest hour, the Simulate line names them, and Auto-tune stages the upper half of the fleet at the busiest measured boarding floor instead of guessing the top lobby.

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

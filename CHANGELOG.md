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

## 2.6.0

- Press and hold a room on a phone to peek at its card without opening it, the way a mouse hover does on desktop. Lift your finger to close it. The peek works with any tool selected; a quick tap still does what the tool always did, so with Inspect it opens the full panel.

## 2.5.0

- Apartments now insist the tower's shops be reachable: a spot cut off from existing retail is refused up front, and a settled Apartment says so before giving notice. Studios stay easygoing.
- Rental residents (Studios included) now count toward local shop demand, so a rental-heavy tower may need another shop or two to keep everyone covered.

## 2.4.0

- Fitness Clubs and Clinics now refuse to lease a spot they would soon abandon (no access, or rent far above the going rate), and the inspector names the fix for empty and unhappy spots alike.

## 2.3.0

- Elevator cars glide now: they accelerate away from a stop, cruise, and settle onto their floor, instead of freezing and jumping as the clock ticks. Only the drawing changed; timing is untouched.

## 2.2.0

- A SimTower import or export that cannot be shown now always says why, in the
  window you are looking at. That covers the cases it used to lose in silence:
  a file that fails to read, a tower the 1994 format cannot hold, a report
  pushed aside by another window, and one left waiting when you start a
  different tower.

## 2.1.1

- The Studio no longer quietly starves your restaurants. A floor of them was taking meal trips out of the pool and sending nobody, so the food court went hungry on a tower that had done nothing wrong.
- The Classic vs Modern comparison now covers rental living, and no longer claims every Modern building needs 3 stars: the Studio arrives at 2.

## 2.1.0

- Importing or exporting a SimTower file no longer gives up because a window was
  open. If what is on screen is just information, the fidelity report opens over
  it; if it is a real decision, the report waits and opens by itself once you
  have answered. In the rare case it cannot be shown at all, it says so in the
  window you are looking at instead of failing quietly.

## 2.0.0

- Modern towers can now rent homes as well as sell them. The Studio is cheap and easygoing; the Apartment pays more but minds noise, a long walk, and a high rent. An empty rental earns nothing.
- A rental that will not fill now tells you why: hover it and the card names the cause, and an unhappy tenant gets that warning before they give notice, in time to fix it.
- Building before 2.0? Your tower now wears a small gold "Ground floor" badge on the title screen, and you get a one-time welcome when you come back. Recognition, no catch.
<!-- The update prompt shows at most MAX_NOTES (3) lines and parseUpdateInfo TRUNCATES
     silently rather than failing, so a fourth note here is DELIBERATE and ships as
     documentation only. Keep the three player-facing gameplay lines above in the
     prompt; the privacy disclosure is live in Help itself and is linked from the
     release announcement. Do not "fix" the count by condensing the lines above:
     that was tried in 2.0.0 and inverted the Apartment's value proposition. -->
- Help now has a Privacy section, on the help page and in the in-game Help dialog, spelling out what the game counts: anonymous totals, with no cookies, no accounts, and no ads.

## 1.105.0

- Dialog buttons now stay pinned to the bottom of the window, so Save and Cancel
  no longer scroll out of sight in a long dialog.
- The elevator schedule window says when you have unsaved changes instead of
  quietly waiting for a second press.

## 1.104.2

- An elevator or stair wide enough to straddle a gap now connects the floor on both sides of it, so a room across a narrow gap from the shaft is no longer wrongly reported as having no way to transportation.

## 1.104.1

- Stairs and escalators now show climbers based on the whole flight, not just its lower landing: a flight that ends on a floor nobody can reach stops showing people walking up to it, and one built beside a gap in a split floor shows its climbers again.

## 1.104.0

- People no longer wander a sky lobby nobody can actually reach. Build a lobby with no elevator or stair serving it and it now reads as empty as it is; connect it and the crowd appears.
- Empty rooms look empty. A wedding hall with no wedding, a shop with no customers, and the front desk of a tower with nobody in it no longer show figures who were never there.

## 1.103.0

- People now respect the gaps between separated sections. If a floor is split into two parts with an empty gap between them, tenants and visitors no longer walk across the void or use stairs and elevators they have no path to reach. A room stranded on a section with no way down to the lobby stays empty (or its tenant leaves), and the inspector says why: "no way to transportation from here." Connect the section with a floor, stair, or elevator and it comes back to life.
- Modern towers can now leave gaps between sections. A new Settings switch, "Bridge floors between rooms," turns off the automatic walkway that fills the space between a new room and the tower. With it off, each room still lays its own floor beneath it, but the game never bridges the gap to a neighbor, so you can build genuinely separate wings. It stays on by default, can be flipped any time, and can be preset at founding with the New Tower "don't bridge floors between rooms" option. (Classic always bridges; the switch does not appear there.)
- Rooms and modules always lay the floor beneath them now, in every tower. The old Modern "manual structure" option (which made you place every floor tile by hand) is retired: an existing manual-structure tower loads with auto-bridging turned off, keeping its separate sections, but rooms you place will now bring their own floor.

## 1.101.0

- A home or office in a spot nobody will stay in (too noisy, too far from a lobby, or a long walk from any elevator) now stays empty until you fix what is wrong, instead of quietly selling and emptying over and over. Hover a stubborn vacancy to see why it will not lease.

## 1.99.1

- The build placement ghost on a phone now sits a consistent step above your finger at any zoom, instead of drifting far up the tower when you are zoomed out.

## 1.99.0

- Building on a phone is no longer a blind tap under your thumb: press and drag on the tower and a ghost of the room floats just above your finger so you can see exactly where it lands, gold where it fits and red where it will not. Lift to place, or slide off to a valid spot first. A quick tap still drops a room the fast way. (Pan with two fingers while a build tool is armed.)

## 1.98.0

- The build menu is easier to get around on a phone: instead of one long sideways scroll past every tool, there is now a row of category tabs (Structure, Transport, Commercial, and so on). Tap a category to see just its tools, and your choice sticks so laying a row of the same room never reopens a menu. Inspect and Bulldoze stay put, a dot marks a category that just gained new tools, and the Modern venues sit in their own labeled section. On desktop the tool list keeps its category headers pinned as you scroll.

## 1.97.0

- The install offer now also sits on the title screen: a small Install button next to the mute button gets Verticopolis onto your home screen straight from the splash, so it opens fullscreen and plays offline. It only shows when you are not already running the installed app.

## 1.96.0

- Modern towers can build a new Daycare: it earns from parents dropping off and collecting kids (busiest on weekdays, not weekends), and condos on nearby floors are happier for it, most of all the biggest families who lean on childcare the most (a bonus that grows with family size and fades over the next few floors). Unlocks at 3 stars. Modern only.

## 1.95.0

- Modern towers can build a new Aquatic Center: a two-story swimming pool that, like a cinema, draws a real crowd who travel in to swim and lounge. It earns from how full it is and leans on your elevators to move everyone, and the pool fills and empties with the day. Unlocks at 3 stars. Modern only.

## 1.94.0

- Modern towers can build a new Sky Bar: a rooftop cocktail lounge with a lit-skyline window that fills in the evening. It earns from foot traffic, and the higher you place it the more it earns, because the skyline view is the draw: a bar up top pours far more than one down low. Unlocks at 3 stars. Modern only.

## 1.93.0

- You can now install Verticopolis as an app: once you have started building, a small Install button offers to add it to your home screen so it opens fullscreen and plays offline. It is a quiet, one-time offer that then waits in the Game panel, and on iPhone it shows the Add to Home Screen steps.

## 1.92.0

- Modern towers can build a new Spa: a calm wellness venue with a steaming hot tub, massage tables, and greenery that earns from foot traffic and is busier on weekends. Where the nightclub disturbs nearby homes, the spa does the opposite for hotels: its calm makes hotel rooms on nearby floors rest a little easier (a bonus that fades with distance). Unlocks at 3 stars. Modern only.

## 1.91.0

- Modern towers can build a new Nightclub: a venue that fills after dark, earning when the office crowd has gone home, drawn with colored lights, a DJ booth, and a dance floor. It pays a monthly DJ booking, and its noise makes nearby condos and hotel rooms unhappy, so keep it away from where people sleep. Unlocks at 3 stars. Modern only.
- The Classic vs Modern guide now spells out when the new Modern buildings become available: all of them unlock once your Modern tower reaches 3 stars.

## 1.90.0

- Modern towers can build a new Clinic: a small health practice that comes as a dental office, urgent care, optometry, pharmacy, or physio, each with its own art. Like the Fitness Club it pays a lease you can price like an office (rather than earning from foot traffic), and it is a quiet, steady tenant. Unlocks at 3 stars. Modern only; Classic keeps the 1994 catalog.

## 1.89.0

- Modern towers can build a new Fitness Club: a members' gym that comes as a weight floor, yoga studio, spin studio, boxing gym, or climbing wall, each with its own art. It pays a membership lease you can price like an office (rather than earning from foot traffic), and condos near it are a little happier for having a gym close by, a bonus that is strongest on the club's own floor and fades over the next few floors. Unlocks at 3 stars. Modern only; Classic keeps the 1994 catalog.

## 1.88.0

- The title screen now has a mute button, and the game remembers your choice: mute once and every later visit opens silent, so you can start a tower mid-meeting without a note escaping.

## 1.87.0

- Modern towers can build a new Boutique Bay: a bay of small independent trades that comes as a florist, barber, phone repair, vintage shop, tattoo parlor, record store, or gallery, each with its own art. It earns from foot traffic and is busier on weekends, and it packs the widest variety of any single build. Unlocks at 3 stars. Modern only; Classic keeps the 1994 catalog.

## 1.85.0

- Modern towers can build a new Amusements hall: an arcade and games venue that comes as a classic arcade, a VR lounge, a claw parlor, or a mini-golf bay, each with its own lively art. It draws teens and families for foot-traffic income and is busier on weekends. Unlocks at 3 stars. Modern only; Classic keeps the 1994 catalog.

## 1.84.3

- If your browser can't use WebGL right now (often hardware acceleration turned off), the game says so and how to fix it, with a Reload button, instead of showing an empty page.

## 1.84.2

- Food Hall stalls now look different from each other: a Ramen Bar, Taco Stand, Bubble Tea, Poke Bowl, Deli Counter, and Coffee Cart each get their own colors and layout, instead of every hall drawing the same.
- The Metro Station now fills its Sprite Gallery cell instead of showing as a thin sliver, so you can see the platform.

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

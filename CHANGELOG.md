# Changelog

Player-facing release notes. Each `## <version>` section lists the lines shown
in the in-game "What's new" update prompt for that build: the build reads the
section matching `package.json` `version` into `dist/version.json` `notes`, and
that section plus the sections below it (ten with notes in all) into `releases`
(see `emitVersionJson` in `vite.config.ts`). A player who skipped versions sees
each version newer than the one they ran, newest first, and never a version's
notes twice. Only genuinely player-noticeable changes
earn a line. Internal, tooling, perf, and refactor work gets none, and that build
simply shows the build-id line. The prompt shows every line whole: up to three
as a plain list, more in a log that scrolls in place, up to 40 lines of up to
1,000 characters each (`MAX_NOTES` and `MAX_NOTE_LEN` in `src/pwaUpdateInfo.ts`).
Keep to the lines that matter, written as a player outcome in a calm voice (see
CONTRIBUTING.md "Player notes" for the house style).

What goes where: this file is for players, one section per app version. The
engine crate has its own file, [`engine-rs/CHANGELOG.md`](./engine-rs/CHANGELOG.md),
one section per crate version, written for people who build on the engine.
Classify a change by what a player would notice, not by which layer changed: an
engine fix a player can feel (elevators, imports, the engine choice) gets a line
here. A change to the engine's contract alone gets only a crate entry; the update
prompt already tells players it is an engine update and shows the new version.

Entries below 1.51.1 were curated from the commit history after the fact, so they
are documentation only: no build that a client fetches carries them.

## 3.10.1

- The VERTICOPOLIS badge at the top left of the game now carries its ™ mark, like the title screen. So do the version line in Settings and About this game, and the sprite gallery and missing-page titles.

## 3.10.0

- Modern towers can now build up to three Metro stations, all on the same line as the first. Riders split between them, someone going back to the train walks to the nearest one, and one train runs the line, calling at each station in turn.

## 3.9.0

- Saved Towers asks before a save replaces a tower in an occupied slot, unless it knows that slot holds the tower you're playing: that slot is marked This tower and still saves in one click.
- A replaced or deleted slot can be put back with Undo.
- A slot save that fails now says so inside Saved Towers, where a message used to be hidden behind the dialog.
- Hotel guests and condo residents asleep at night are drawn as the same people you see by day, with their own face and hair on the pillow, instead of an older flat sketch.
- A housekeeper riding an elevator stays inside the car at fast speeds, instead of jumping ahead of it and floating in the empty shaft.

## 3.8.0

- In Modern, a stairway right beside a cinema, party hall, metro station or aquatic center is drawn as a spiral staircase, and an escalator there turns back on a steel landing halfway up. They link the same two floors as before; only the look changes. Classic keeps straight flights, as in 1994.
- Someone climbing a stack of one-story flights (an escalator up to a deck, then stairs on up from it) is drawn on the flight they are actually riding, instead of staying on the first one.

## 3.7.4

- A shop, restaurant or theater near a working Metro platform no longer warns that it is too far from a lobby, and does full business, as the 1994 game's basement shops beside the station did.

## 3.7.3

- Elevator cars show only the people who actually stepped in, one figure each, so a car no longer looks full with nobody aboard.
- People riding an elevator stay aboard to their floor and step off there, instead of vanishing from the car partway through a slow ride.

## 3.7.2

- A shop or restaurant just above a tall lobby no longer says it is too far from a lobby. Distance to a tall lobby now counts from its top story, for tenants' ratings too.
- People headed for an elevator walk straight to the back of its line and wait there, instead of stepping into the shaft and walking back out. When a car comes, they walk from the line into it instead of vanishing from where they stood.
- An elevator car shows one figure for each passenger, as many as fit in the cab, so a whole line that gets on fills it.
- People in rooms are drawn at the same size as people in the halls.
- Hotel guests and condo residents sleep under a blanket at night instead of disappearing.
- People on stairs and escalators climb along the flight from one landing to the other, instead of rising straight up its middle. On a tall lobby they wind around the spiral stair and turn back at each switchback platform.

## 3.7.1

- Elevator cars and people move smoothly again at every speed, instead of shaking as they did in 3.7.0.

## 3.7.0

- The title screen has a Sponsor link in its top-left corner, and the help site has a new Supporting Verticopolis section. The game stays free, with nothing locked.
- The Verticopolis name now carries its ™ mark on the title screen, the help site, page titles and the pictures shown when a link is shared.
- A Modern tower on the short 1994 calendar now shows each office's and apartment's rent as it actually arrives (a $10,000 office pays $333 every three days), with the rate you set beside it, instead of a figure it never pays.
- When the game can't save your tower (a private window, blocked site storage or a full disk), a notice now stays on screen with the likely cause and an Export button, and it clears itself once saving works again.
- While Security searches for a bomb, the tower stands still: elevators stop and tenants and visitors wait where they are until the bomb is found or goes off. Only the guards move. You can't build, bulldoze, sell, change an elevator, or undo and redo until the search ends. A tower with no Security to search keeps running and takes edits as usual.
- The Map now shows a tall lobby at its full height instead of a one-floor strip.
- On a phone, the room and elevator card now moves too: drag it by its blue title bar, and it goes back under the tools when you close it.
- Drag the Map, the room and elevator card, and any dialog by its blue title bar to move it out of the way. The Map remembers where you put it, and a double-click on a title bar puts a window back.
- The room and elevator card, the hover card and every dialog now wear the Map's compact title bar and close button, so the closable windows match.
- The Map's View menu is bigger and easier to read on a computer.
- The Map button in the corner of the tower view is bigger, with a map icon, so it is easy to find and to click.
- People look like people: a varied cast of builds, skin tones, hair, outfits and things in hand, in both modes. Classic draws them flat; Modern lights them from the upper left.
- People walk smoothly instead of hopping between game steps, with a walk cycle while they move.
- Waiting people show how long they have waited: they check the time, then put their hands on their hips in amber, then throw their arms up in red.
- Elevator cars glide between floors at every speed instead of stopping short and catching up, and people get in and out when the car is at their floor, at the same moment the cab's riders change.
- People keep their size inside an elevator car, and waiting people face the elevator they are waiting for.
- Housekeepers push their cart between rooms and vacuum while they clean one. The crew is six different people in one uniform.
- The three game speeds are slower so you can watch people walk: 3, 15 and 50 game minutes a second (they were 10, 30 and 120). A game day takes 8 minutes, 96 seconds or 29 seconds.
- When shown, decorative passers-by walk only the corridors of occupied floors in Modern, at half the old count, and stay off lobbies, stairs, escalators and the space in front of elevators and shops.
- Classic towers no longer show decorative passers-by, matching the original.
- Decorative passers-by are now off unless you turn on "Show decorative passers-by" in Settings (Modern only), and reduced motion hides them.
- Decorative passers-by no longer turn red when the tower is stressed, so red always means a real person has waited too long.
- A revolving door between lobby halls no longer jumps a turn when someone gets out of an elevator or off a flight right beside it.
- The Help site's Tall lobbies section shows two Modern halls side by side with the door between them, by day and by night.
- In Modern, each lobby hall keeps its own height, so a three-story hall and a two-story hall can stand side by side on one floor.
- Where two lobby halls of different heights meet, a wooden revolving door now turns as people walk through it, in either direction at once.
- A floor built beside a tall lobby hall no longer blocks it, and a shaft beside the hall still stops on every floor.
- On a desktop window, the Tools list now fits without scrolling: when every tool will not fit, its rows get tighter, and on a short window it splits into two columns.
- Click a group's name in the Tools window (Commercial, Living and so on) to fold its tools away, and click it again to bring them back. The game remembers which groups you folded.
- The desktop Tools window has a button on its title bar that folds it into a thin strip to give the tower more room, and opens it again. The game remembers your choice.

## 3.6.0

- The How to Play manual has a new page, Differences from the 1994 game, listing where a Classic tower plays like SimTower and where it doesn't yet.
- The How to Play manual now explains buried treasure under Events.
- Music and sound effects no longer crackle on slower computers and phones: the sound engine now does about half the work to play the same sounds.
- The help pages now show their name in the title bar on phones too, with a Play button beside it and a link to the project on GitHub.

## 3.5.1

- In Modern towers, an idle elevator waiting on a floor now picks up the people waiting there instead of leaving them for a car that never comes.
- In Classic, plain floor left between two sky lobby tiles in an older tower can be bulldozed again from its ends. A lobby beyond a gap no longer keeps it in place, and a floor tile right beside a lobby still stays.
- Placing stairs or escalators in Firefox no longer freezes the tower view; a sound effect that cannot play is now skipped instead of stopping the game.
- A tower with more than 256 shops, fast food places and restaurants exports to a .TDT file with every room linked to its own retail row, so each keeps its style on the way back in.

## 3.5.0

- About… now opens About this game straight away. What's new, the release notes and Report a problem are in Help, and Privacy links to its Help page.
- Pressing a mouse's forward side button, or a pen's eraser, over the tower no longer throws an error.
- In Classic, the bulldozer no longer widens a gap that a tower saved before 3.3.0 already has. Bare floor comes out only from the two ends of the whole floor, and the Floor tool still fills an old gap.
- Modern: elevators send the car best placed for each call (the nearest by travel, counting the stops it already owes and passing over a car heading the other way), so a far call no longer waits for a parked car and two cars no longer chase one floor. A car already on its way within the shaft's Waiting Car Response keeps the call.
- Modern: cars with no home of their own wait spread up the shaft (the first at the lobby) instead of stacking on the lobby. Homes you set are kept, and nothing new is written to your save unless you press OK in the schedule dialog, which saves the homes it shows.
- Modern: a car loading at a floor keeps boarding new arrivals, but leaves after twice its Standard Floor Departure at most.
- Shops, fast food and restaurants imported from SimTower towers keep their own styles; before, most shops in a played tower came in as Men's Clothing.
- A theater built the day a tower is exported to a .TDT file keeps its seats in SimTower like any other theater.
- A tower exported to a .TDT file can be built on in SimTower after loading: the file keeps free room for new people, so placing a theater no longer crashes the game.
- Theaters export the way SimTower writes them, each floor a screen piece and an auditorium, with the 56 people each screen keeps.
- The manual's first-tower page now says to replay Getting Started from About… on the game panel, where it lives now.
- A link to a help page shared on a forum or in a chat now shows a card for that page, with its title and what it covers.
- Report a problem in About this game (the game panel's About…) opens GitHub's bug form with your version, the engine diagnostics, your browser, your platform and your tower's mode already filled in, so you only have to say what went wrong.
- A tower imported from a 1994 SimTower `.TDT` file keeps each elevator car's waiting floor, so idle cars wait where the original game had them instead of all stacking on the lobby, and exporting writes those floors back.
- Classic: elevators follow the original's two dispatch settings. With a Waiting Car Response set, a parked car stays put while another car of the shaft is already on its way to the call within that many floors, and a car loading at a floor keeps boarding new arrivals for its Standard Floor Departure wait before it leaves (or until it is full).
- Lobbies can now be two or three stories tall. Pick the height on the Lobby card, or hold Ctrl while placing a lobby for two stories and Ctrl and Shift for three. In Classic only the ground lobby rises, and a sky lobby asked taller is refused with the reason; in Modern, sky lobbies can rise too. A lobby keeps its height once built, and each extra story costs another lobby tile.
- Elevators pass through a tall lobby without stopping. Stairs from it wind up the whole hall as a spiral staircase, and an escalator zigzags up it with a landing at each turn.
- On a phone, a tap that the game refuses to build now says why.
- A tall ground lobby survives .TDT import and export.
- People now get on and off an elevator only when it stops at their floor with its doors open, so you see riders step out of the car instead of hopping on and off a car passing by.
- An elevator no longer slides past a floor it was about to stop at, and the drawn car keeps closer to where the car really is, so it settles onto each stop.

## 3.4.0

- The help at /help is now a full player's manual: a page for every kind of room with its price, size, earnings and picture, how building and the tower work, saving, importing and exporting, settings, controls and a walk through your first tower. Every number comes from the game, and Classic and Modern rules are marked where they differ.
- Help in the game opens the manual in a new tab and pauses your tower until you come back; Back to game closes the tab. The old in-game guide window is gone, and What's new, the release notes, Report a problem and About this game now sit under a new About… button.
- The release notes at /help/changelog are part of the help site, with the same menu, search and Back to game button. Old /help links and /gallery still land on the right page.

## 3.3.0

- A link to a page that does not exist, such as a mistyped help address, now opens a "Page not found" page with links to the game, How to Play, the release notes and the sprite gallery.
- Help… now opens a short Help menu: How to play, What's new, Release notes, Sprite gallery, Report a problem and About this game. What's new shows this version's notes and the ones before it, offline too.
- The tower pauses while any Help window is open and picks up at your speed when you close it. Help opened in a new tab keeps it paused until you are back on the game's tab, and a speed you picked meanwhile is kept.
- The Classic or Modern badge in the Tower panel opens the guide's Classic vs Modern page in a new tab (the installed app keeps the comparison in the game).
- "Back to game" on a help page the game opened closes that tab, so you land on the tower that is still running instead of loading a second copy.
- Modern: the aquatic center now makes nearby condos, apartments and hotel rooms happier, up to six floors away, and the party hall does the same over three floors; placing either shows its green bands.
- A bomb that goes off now damages only the tower it was hidden in. On a lot with several towers side by side, the others are left standing.
- During a bomb search on a lot with several towers, Security sweeps each tower separately and walks between towers only by the emergency stairs, through a floor they share such as the lobby. A tower that no floor joins to a Security office is not searched.
- On a lot with several towers, Security catches a thief only in a tower it can walk to by the stairs, and the thief runs his own tower's rooms instead of the whole floor.
- Every tower on a lot now has fire escapes on both of its sides, and Security climbs them during a bomb search instead of hanging in the air beside the building.
- Security guards searching for a bomb, and the thief and his guard, now stay the size of the crowd when you zoom out, instead of towering over several floors.
- In Classic, party halls and theaters now share one limit of 16, as in the original game, instead of 16 of each.
- A tower with a party hall exported to a `.TDT` file now opens and plays in the original game, which crashed on it a few seconds after loading.
- In Classic, an undo refused for floor in use no longer tells you to sell floor that can't be sold, and the floor message now says that only a tile at either end of a floor can be removed.
- In Classic, the bulldozer no longer cuts a gap in the middle of a floor, which left the floors above looking hollow. Remove bare floor from either end instead; a gap in a tower you already saved can be filled with the Floor tool.
- Every update's release notes now have their own page at verticopolis.com/help/changelog, newest first and each note whole, linked from the help page, the sprite gallery and an "All release notes" link under the update prompt's notes.

## 3.2.0

- Long elevator waits now stress your tenants, as they did in the original game. Each floor keeps a running average of how long its commuters really waited, and once that passes a rider's patience (two minutes in Classic, three in Modern) the floor's offices, condos and hotel rooms lose rating and name congestion as their complaint. A lobby floor is never charged for its own queue, and a Metro rider's wait counts on the floor it heads for (#1971).
- From three stars, too little recycling now hurts your tenants, as it did in the original game. In Classic, any shortfall drains every office, condo, hotel room and rental toward red, and tenants give notice as they do for any other red rating, until you build enough Recycling Centers. In Modern, a tower up to one center short only holds those ratings at Good; a bigger shortfall drains them (#1970).
- From three stars, offices now need parking. In Classic, offices drain toward red when no parking space is left once hotel guests in suites have parked, and one free space is all they need: new offices move in at full speed once it exists. In Modern, the offices on the lowest floors park first; the rest hold at Good, and drain once spaces cover under half of the office workers.
- A tenant who leaves over either shortfall says why ("trash piling up without enough recycling" or "too little parking for its workers"), the room inspector names the cause and how much of the need is covered, and the log warns once when offices run short of parking. A Classic tower at three stars or more with no Recycling Center, or with no free parking for its offices, will see ratings fall after it loads.
- Help's engine diagnostics no longer mention a TypeScript engine when the Rust engine is not running.
- Modern: while you place a fitness club, spa or daycare, green bands mark the floors it helps, strongest nearest; a nightclub shows violet bands for the floors its noise reaches at night (#1980).
- Modern: while you place a shop, restaurant, other noisy venue or office, a violet band along its floor shows how far its noise carries to the rooms beside it; placing an office, condo, apartment or hotel room shows in amber the stretch that should stay clear of noisy neighbors. Both stop at a lobby, as the noise does.
- Modern: inspecting a condo, apartment or hotel room now names the amenity helping it most, and how much happier it can be when noise, a far lobby or too few shops hold it back.
- Modern: a nightclub now disturbs homes and hotel rooms on nearby floors only while it is open (8 PM to 2 AM). It is louder then, so a condo along the club's own floor dips to Good overnight, but the club alone no longer drives that tenant out, and it no longer keeps a nearby condo from selling. A condo right beside the club, within earshot of its door, still can't hold a tenant, and the Won't lease line says so before anyone moves in.
- Modern: a fitness club, spa or daycare nearby now raises the ceiling on a room held down by noise, a far lobby or too few shops, so a gym down the hall can lift a noisy condo back to Excellent.
- Modern: the spa and the daycare no longer count as noisy neighbors for the rooms beside them, so a spa next to your hotel rooms only helps them.
- Modern: the daycare now does more for smaller families: a couple gets 40% of its bonus, up from 25%.
- In Classic you can no longer build while the game is paused, as in the original. A click, tap or keyboard placement while paused says "Unpause to build." and points at Play. Modern still lets you build while paused (#1936).
- Large towers no longer hitch for a moment right after you build, sell or bulldoze, or right after a save loads.
- The statistics screen's Parking demand line turns red only when tenants actually feel the shortage. In Classic, one free space is all your offices need, so a garage with fewer spaces than the workers' cars no longer reads as short while it has that space.
- The update prompt now lists every change in an update, each one whole, in a list that scrolls when it is long.
- In Modern, each movie theater has a ticket price: Low, Normal, High or Premium (#1950). A higher price earns more for each seat and draws fewer visitors; a lower one earns less per seat and draws more. A theater that sells out can raise its price and keep its seats full, and a half-empty one does better cheaper. The theater card's "Ticket price" button steps through the four. Every theater starts at Normal, and Classic theaters have no ticket price.
- In Modern, each movie theater runs two screens (#1950). Each screen has half the seats, its own film, its own age and its own Auto-rebook choice, and pays for its own films. Book them on different days so one screen always has a fresh film, or pair a blockbuster with a cheap revival. The theater card shows a row for each screen, the films to book on each, and a "Screen 1 auto-rebook" and "Screen 2 auto-rebook" button. The ticket price stays one per theater. A Modern tower saved before this loads with both screens showing the theater's film, and nothing is charged; when that film is spent, each screen books its next film and pays for it. Classic theaters keep one screen.
- In Modern, a movie theater no longer pays a booking every month. You pay once to show a Revival ($60,000), a Feature ($120,000) or a Blockbuster ($300,000). A film draws a full house for four weeks and fades for two, and its ticket income follows: a blockbuster earns the most, a revival the least, and a fading film less than a fresh one (#1950).
- A Modern theater's card shows its film and how long it has been showing, with a button for each film and an Auto-rebook button. When a film is spent, the theater books its Auto-rebook film again (a Feature unless you pick another, or Off). A new theater opens with a free feature. Classic theaters are unchanged.
- In Modern, homes now need parking from three stars (#1973): one space for every 2 occupied condos, 3 apartments or 6 studios. Classic condos still need none, as in the original game.
- In Modern, a working Metro station halves the parking offices and homes need. Hotel suites still need a space each.
- In Modern, offices and homes share the spaces the hotel suites leave, lowest floors first. A home without parking is held at Good and never leaves over it, and while parking covers under half of what offices and homes need, homes fill and condos sell at half the usual pace. The stats screen counts homes in its parking demand and, while parking falls short, shows how much of the need is covered, and the room inspector names the shortfall and how much of the need is covered.

## 3.1.0

- In Classic, a movie theater's film now ages and draws a smaller audience over time, and its card lets you show a new film ($300,000) or a cheaper classic ($150,000), as in the original game.
- Shops, restaurants, party halls and movie theaters now count toward the tower's population the way the original game does, and an imported SimTower tower keeps those counts.
- An installed copy now updates even when an antivirus web shield changes the page on its way in, and the update prompt appears even when the new version could not get ready in the background.

## 3.0.1

- Refusing the bomb ransom now starts a race: Security searches floor by floor before the 1:00 PM deadline, with a countdown, a ticking clock and a red glow. If they miss it, the bomb goes off.
- Every turn of a bomb threat now pops up on screen, phone included. In Modern, a Security office that opens during a search sends its guards to join it.
- The update window now lists what's new in every version you skipped, newest first, and never shows the same notes twice.

## 3.0.0

- Verticopolis 3.0: the whole game now runs on its new engine, checked against hundreds of replayed games and the 1994 original's rules.
- Classic mode follows the 1994 game more closely, from the shared elevator and stair limits to the rooms it keeps for good.
- The Map holds every tower view in one place: Eval, Pricing, Hotel, Traffic and Occupancy.

## 2.90.0

- The Map has two new views, Traffic and Occupancy, that color each floor by how crowded or how full it is, in both game modes.
- The Map's views are now picked from one View menu at the top of the window.
- The Floor heatmap picker in the sidebar is gone, and the tower view no longer tints floors: every heatmap now lives on the Map (Satisfaction is the Eval view and Housekeeping the Hotel view).

## 2.89.2

- On the Map, parking ramps, security offices, stairs and service elevators stand out more clearly from the sky, the ground and each other.

## 2.89.1

- The Map's legend no longer covers the top floors of a tall tower.

## 2.89.0

- The Map's Eval tab now colors each rated room by how its tenants or guests rate it, and the Pricing tab each priced room by its rent, each with a legend that counts them.

## 2.88.0

- The Map now has Edit, Eval, Pricing and Hotel tabs. Hotel highlights rooms that need cleaning or have cockroaches, with a separate pattern and count for each.
- The Eval and Pricing tabs show the plain map for now, with a note that their views are coming soon.

## 2.87.1

- Undo now checks more build rules before putting something back (around the metro station and sky lobbies), and never takes away a ground-floor lobby that newer floors or basement hang from.
- When Undo can't take something back, it now says if the tower around it has changed since, and suggests selling it only when all of it can be sold without leaving anything hanging.

## 2.87.0

- A lobby built where there is no floor yet also pays for that floor ($500 per tile), as in the original. Turning a floor into a lobby costs the lobby's price alone; the Lobby card shows both.
- Extending an elevator through the ground floor now stops short of it until a lobby is built there, as on a sky lobby floor, instead of laying plain floor where only lobby belongs.
- The Floor and Lobby brush preview now leaves out tiles a click skips or cannot lay, such as a lobby already there or tiles past the floor below, and counts the bridges a click lays.

## 2.86.1

- Releasing a held Space no longer presses a button or toggles a checkbox that got focus while Space was down, such as the Map's button when a narrower window closes the Map.

## 2.86.0

- Undo and Redo keep the tower scene in place instead of rebuilding it, so the view responds faster without a visual reset.
- Undo and Redo no longer repeat the "TOWER achieved!" message for a tower that has already earned it.

## 2.85.2

- On a phone held sideways, the funds and population stats stay on one row without cutting off their values.

## 2.85.1

- Holding Space before a mouse drag now pans the view without building or clicking a focused control. Tapping Space acts at the keyboard cursor when you let go.
- Holding Enter, Delete, Backspace or X at the keyboard cursor acts once instead of repeating.
- The help no longer says a right-button drag pans: a right-click inspects a room.

## 2.85.0

- On a phone held sideways, the tools sit in a column on the left (tabs in one sliding row on a very short or narrow window) and the stats take one line each, so the tower view is almost twice as tall.
- On a phone held sideways, the Map keeps your tower's shape, a long facility card scrolls instead of hiding its close button, and the checklist sits beside the tools, clear of the tiles it points at.
- The top bar always shows funds and population with commas between thousands (12,345), whatever your browser's language.
- Undo gives back a build's full price only until it is used: a room once it opens, floor and lobby (even a room's own) at the next hour, and elevators, stairs and escalators then or once ridden.
- Undo never takes away floor or lobby that something still stands on, never puts a room back on a lobby floor or under the metro, and never undoes an underground build that dug for treasure.
- An undo that can no longer be done is dropped, so the next Undo goes on to the edit before it. One that waits only on money or a fire stays for another try.

## 2.84.0

- The Undo and Redo buttons gray out when there is nothing to undo or redo.
- When a touch drag is interrupted, nothing that waits for your release gets built, and what it already built can be undone.

## 2.83.1

- The Map draws itself again after the browser resets its graphics, where it used to stay blank until the tower changed.

## 2.83.0

- The traffic meter in the top bar is now four rising bars, drawn the same on every phone and computer instead of with font symbols that some phones showed as empty boxes.

## 2.82.0

- In a Classic game the Map now shows your rooms in their colors, fitted to your tower, with stairs and escalators drawn too. The box that marks your view is a solid outline, and a band with an arrow at the Map's top or bottom edge points to a view that has moved off the Map.
- The Map leaves a little space at each side of the lot, so a tower built edge to edge no longer touches its sides.
- Stairs and escalators on the Map are a little lighter, so they stand out against the sky.

## 2.81.0

- Undo and redo no longer turn back the clock: they put back just the edit, and give back or charge exactly what it cost.
- Undo says why when it can't help: not enough money, a room that has been used since you built it (sell it instead), or a condo that has sold and keeps its price.
- Pressing Undo or Redo partway through a drag ends the drag, so nothing more is built or bulldozed until you press again.

## 2.79.2

- On a narrower desktop screen, or while the Getting Started card is up, the hint bar now sits just above the open Map, so the card no longer covers it.

## 2.79.0

- A new Map window shows your whole tower and opens by itself on a desktop; click or tap a spot on it, or drag anywhere on it, to move the view.
- On a phone, the Map pill at the bottom right opens the Map.
- The sidebar's "Map overlay" picker is now called "Floor heatmap".

## 2.78.17

- A hotel room that was rented and is now empty and clean exports to a SimTower file as an empty clean room, so the original game no longer shows it as a sleeping guest.

## 2.78.16

- Your tower now saves when you switch to another tab or app, so less of your last half minute is lost if the tab never comes back.
- If autosave cannot write to your device, the game now tells you once instead of failing silently. The download in Saves still works.

## 2.78.13

- A hotel room with cockroaches now exports to a SimTower file as a room that needs cleaning, instead of coming back as a clean empty room.

## 2.78.8

- A saved tower from a newer version of Verticopolis now says so when you start the game or load it from Saves. Update the game, then use Import from file on the copy that Saves keeps.

## 2.78.5

- A tower file saved by a newer version of Verticopolis is now refused with a message to update the game, instead of loading and dropping what this version does not know.

## 2.78.1

- Exporting a tower with more than 512 shops, restaurants and fast food places now says how many will open with the default style in SimTower.
- A SimTower save whose elevators cannot be read now gets rebuilt shafts that stand clear of its rooms.

## 2.78.0

- Shops, restaurants and other venues more than two floors from a lobby warn again that their traffic is halved, in the hover card and the phone editor.
- Sky Bars, nightclubs, spas and daycares no longer show a customer count and demand advice meant for shops and restaurants.

## 2.77.5

- Room previews and elevator displays now use facility information consistent with the live tower's engine rules.

## 2.77.4

- A kept elevator schedule no longer reappears after a valid shaft resize, so the same shaft keeps its earlier decision after a reload in this browser.

## 2.77.3

- Express elevators in imported SimTower towers now keep their basement stops after saving and reopening.

## 2.77.2

- Extending an express elevator no longer adds unintended stops on ordinary floors.

## 2.77.1

- Parking Space cards now show spaces needed before spaces available, making parking demand easier to read.

## 2.77.0

- Shops and restaurants again show today's customers, yesterday's business and profit, and local demand.
- In Modern towers, food and retail venues now say when there are too many or too few for the tower's shoppers.
- Reviewing an older elevator schedule no longer moves a car's home floor when you change its duty hours.

## 2.76.1

- Parking spaces now explain ramp connections and demand, and hotel and housekeeping cards show their existing coverage and recovery warnings.

## 2.76.0

- The Rust engine failure screen can now download a crash report and your stored recovery copy, even when the engine cannot start.

## 2.75.1

- Elevator inspectors now show average car load and a warning when a shaft is near capacity.

## 2.75.0

- Tower Statistics can now review elevators that run fewer cars than they have, with an undoable "Use all installed cars" for older towers.

## 2.74.5

- Clicking any floor of the wedding hall's garden now selects the hall, not just its bottom floor.

## 2.74.4

- Rooms now explain what is lowering tenant satisfaction again, including crowded transport, noisy neighbors and rent complaints, so you can see what needs fixing.

## 2.74.3

- A new elevator car joins the shaft's schedule: every hour that ran the whole fleet now runs the added car too, while hours you cut back stay as you set them.
- The schedule dialog has a "Run all cars, every hour, both day types" button, so you no longer set 48 hours one at a time.

## 2.74.2

- Housekeepers no longer climb into a service elevator car that the schedule has parked, so every dirty hotel room gets cleaned on time when you run fewer cars.

## 2.74.0

- The wedding hall's garden no longer has fire-escape stairs hanging beside it, so it stands clear against the sky.

## 2.73.0

- The metro train now follows the game clock: one calls each hour from 6:00 to 20:59, and none run overnight.

## 2.72.0

- The wedding hall is now a big five-floor garden building, 28 tiles wide, crowning the top of a 5-star tower on floors 100 to 104. Older towers widen their hall when they load.
- In Classic, the wedding hall cannot be sold or bulldozed, and nothing else can be built on floor 100, as in SimTower.
- Imported SimTower towers with a cathedral now bring it in as the wedding hall, and exported towers write it back.

## 2.71.0

- Security, medical, housekeeping and recycling rooms build at the sizes SimTower uses, so a tower from the original game keeps its layout.
- The metro station is 30 tiles wide with its tunnel along the bottom row. Nothing can be built below it, and the lowest basement row is kept for it.
- Parking stalls in imported SimTower saves that sat a few tiles from their neighbor now sit against the ramp's row, so they are connected instead of showing a red X.

## 2.70.0

- Help's privacy note no longer mentions an engine test, since the game has none now.

## 2.69.0

- The service elevator's car now holds 17 riders instead of 10, as the Windows Help file says, so housekeepers wait less.

## 2.68.0

- In Classic, a security office, recycling center or movie theater can no longer be sold or bulldozed once it is placed, as in SimTower. A burned-out one can still be cleared.

## 2.67.0

- Reaching 3 stars now takes two security offices instead of one, as in SimTower. A tower that already has 3 stars keeps them.

## 2.66.0

- The game runs a little faster.

## 2.65.0

- In Classic, the metro station only helps shops, restaurants and fast food once its platform floor has an elevator, stairs, or escalator connected, as in SimTower.
- Housekeeping can no longer be built underground, as in SimTower. Housekeeping already in a basement stays.
- In Classic, a housekeeping room can no longer be sold or bulldozed once it is placed, as in SimTower. A burned-out one can still be cleared.

## 2.64.1

- An imported metro station no longer says it has no elevator access when an elevator reaches its platform.

## 2.64.0

- Hotel guests from imported SimTower saves now arrive in their rooms, so the guest count matches the original.
- Clean, empty hotel rooms in imported saves no longer arrive as rooms waiting for housekeeping.
- A hotel suite now holds 2 guests, the same as a double, as in the original.

## 2.63.0

- The update prompt now says whether an update changes the game, the engine, or both, and shows the new engine version.

## 2.61.0

- A tower exported to SimTower's .TDT format now keeps all 64 stairs and escalators when SimTower opens it. Before, towers with more than 48 lost 16.
- The SimTower tower TOWER2 no longer imports with one extra escalator.

## 2.60.1

- A SimTower save that the original game re-saved now keeps its stairs and escalators when you import it.

## 2.60.0

- Exporting a tower to SimTower's .TDT format now keeps the game clock to the minute, so a tower you export and import again reads the same time.
- Shops, restaurants and fast food places from a SimTower save now arrive with a style instead of an unset one.

## 2.59.0

- Towers saved by the original 1997 SimTower now bring over their elevators and stairs when you import a .TDT file, including towers with express elevators.
- The import report now counts twin rooms as Double Rooms. Thanks to Reddit user u/invokes for sending in their saves to test with.

## 2.58.0

- Some players on the Automatic engine setting now run the new Rust engine as part of a test. You can change this in Settings.

## 2.57.1

- The game now opens offline again after your browser clears its saved copy, once you have visited it online.

## 2.57.0

- If the game crashes, its crash screen now has a Download recovery copy button that saves your tower's last autosave as a file.

## 2.56.0

- Help's Privacy section now lists what the game reports when you are part of an engine test.

## 2.54.5

- On a phone, Settings no longer shows a stray line of text under the Close button as you scroll.

## 2.48.0

- Exporting to SimTower (1994) now works for a tower loaded from a save that has no tower name. The file is named TOWER1.TDT.

## 2.47.1

- A tower saved at a rare point in its run of random events now reloads with the same events still ahead of it.
- A save edited by hand now loads the same way on the Rust engine and the TypeScript engine.

## 2.47.0

- Settings has a new Game engine choice, Automatic, the Rust engine (experimental), or the TypeScript engine (stable). A change takes effect the next time the game starts.
- The experimental engine is now called the Rust engine everywhere in the game.
- If the Rust engine runs into a problem on your device, the game stays on the TypeScript engine until you choose to try it again in Settings.

## 2.46.1

- Keyboard bulldozing now tells screen readers when a facility could not be removed, instead of announcing a successful removal.

## 2.46.0

- On the opt-in WASM engine (`?engine=wasm`), an undo or a redo that meets an engine failure, when the last good state also fails to load, now clears the undo history and says so.
- When that engine stops and the tower goes back to an earlier good state, the notice no longer says you made changes since then.

## 2.45.0

- On the opt-in WASM engine (`?engine=wasm`), the start screen now says the engine is loading when the download is slow, instead of showing an empty sky.
- That engine now checks its own files before it runs them. If the files do not belong together, the game stays on the standard engine instead of running them.

## 2.44.0

- On the opt-in WASM engine (`?engine=wasm`), an engine failure that has to go back past the last good state now says so and clears the undo history, and a failed switch to TypeScript says so too.

## 2.42.0

- Help's About now shows which game engine runs and which build it is, with a Copy diagnostics button to send us if something looks wrong. It works even when the engine cannot start.

## 2.41.0

- Saving, or undoing an edit, while an exterminator is booked now keeps the booked rooms, so the treatment covers only the rooms you paid for.

## 2.40.0

- On the opt-in WASM engine (`?engine=wasm`), a tower whose engine fails keeps running instead of freezing. It rewinds by up to an in-game hour, so recent changes may be undone, and a message says so.

## 2.39.0

- Reaching TOWER while an emergency or an update prompt is waiting for your answer no longer freezes the game, and a saved tower that was stuck this way now continues. The question comes first, then the congratulations. A tab that is already frozen needs to be closed and the game reopened to pick up the fix.

## 2.38.0

- Staff shirts, the sky bar's window lights and a few other small room details now stay the same across the whole room. They no longer shift with how the tower is drawn.

## 2.37.0

- Busy rooms fill their seats again. Several had quietly stopped using their last few, and left the people at them undrawn.

## 2.36.0

- The parking spaces, ramp, security office, Medical Center, housekeeping room, and recycling center are drawn on the current pixel grid, so the camera monitors, the folded linen, the Medical Center's bottles and the hazard tape are evenly spaced instead of drifting a pixel here and there. The recycling center's ceiling pipe has fewer brackets.

## 2.35.0

- The Sprite Gallery now shows every room, shaft, and elevator at the same proportions as your tower.

## 2.34.1

- Studio and apartment residents now go to bed at 11 PM and get up at 6 AM on time.

## 2.34.0

- Downloading a legacy .TDT file while another export is still running now says so and asks you to try again when it finishes.

## 2.33.0

- When saving an exported tower file fails, the game now shows only the failure message, without a second one claiming the export worked.
- An export that finishes after a "not responding" warning now says it finished after all.

## 2.32.0

- On the opt-in WASM engine, an installed game reopened in the same browser session now starts on that engine with no connection, instead of quietly switching back to the default one. Starting offline in a fresh browser session is still to come.

## 2.31.2

## 2.31.1

## 2.31.0

- Help's Privacy section is shorter: it now describes only the game you play in your browser, with the same anonymous, cookie-free counts as before.

## 2.30.0

- Help's About section now links to the licenses of the open-source software the game is built with.

## 2.29.6

- An exported tower file is now the same in every browser, and exporting no longer needs the browser's compression support.

## 2.29.5

- A tower or room name cut through an emoji (the name box had room for only part of it) now loads the same on the default engine as on the opt-in WASM engine, with a placeholder mark where the half character was.

## 2.29.4

- On the opt-in WASM engine, rooms redraw the moment workers step out for lunch or guests arrive at a venue, instead of up to an hour later.

## 2.29.3

- On the opt-in WASM engine, the elevator Schedule dialog shows its demand curve and advice again, and the Tower Statistics show elevator loads and how many hotel rooms went unserved yesterday.
- Dollar amounts and counts in the event log now read the same on both engines, with thousands separators and the right plurals ("1 clinic", "3 Recycling Centers"), in every browser language.

## 2.29.2

- On the opt-in WASM engine, the notices for a condo sale, a condo buy-back and a tenant leaving now read the same as on the default engine.

## 2.29.1

- The game can run on the new Rust engine: open it with `?engine=wasm` and the version line on the title screen, Settings, and Help reads "WASM engine" while it does. Nothing changes unless you ask for it.

## 2.29.0

## 2.28.0

## 2.27.0

## 2.25.2

- Elevator floor numbers now scale with the zoom level instead of looking oversized when zoomed out, and they no longer flicker as elevator cars pass a floor.

## 2.25.1

- Elevator floor numbers now stay crisp at every zoom level and on high-resolution phone screens, where they could look doubled or smeared before.

## 2.25.0

- Elevator floor numbers now read clearly against the dark shaft: the digits are brighter with a firmer shadow, so you can tell which floor a car is passing at a glance.

## 2.24.0

- Floors and rooms now sit at the proportions of the 1994 game this one is modeled on: a floor is half a tile taller for its width than before. Towers read a little narrower and taller, and an elevator car is no longer square.

## 2.23.0

- The Privacy section in Help now spells out what the game counts and how those counts travel, and says plainly that a crash report can occasionally quote a bit of game text, such as a tower's name.

## 2.22.0

- An export that looked stuck and then finishes anyway now names the tower it saved, so you can tell which one landed on disk after you have moved on to another.

## 2.21.0

- The whole soundtrack is now ours: the title theme, the in-game music, and the milestone chime are all made from recordings of our own voice, chest taps, and finger drumming (human-made, not AI). The title screen hums our tune over a heartbeat, and the tower drifts through a two-part hum with a gentle tap groove.
- Placing, selling, clicking, and errors all speak in the recorded "bloop" now, tuned so the low notes carry on phone speakers, and star promotions ring the title tune's four-bell peak.

## 2.20.0

- The Help dialog (and any other long dialog) scrolls as one piece again in current browsers, instead of wearing a second scrollbar on the window itself.

## 2.12.0

- The sound and mute buttons now share the same speaker, so the icon no longer shifts when you toggle audio; muting just swaps the sound waves for an X.

## 2.11.1

- A SimTower (1994) file you exported from an earlier Verticopolis build now imports with all of its elevators again. If one of them skipped floors, the shafts after it were quietly dropped.

## 2.11.0

- The toolbar, menus, and in-game bulletins now use crisp pixel icons instead of emoji, so they look the same on every system rather than turning into empty boxes where no emoji font is installed.
- The bulldoze tool now shows a red wrecking ball.

## 2.10.0

- A tower you export to SimTower (1994) now arrives with its elevators. A tower with an express shaft used to lose most of the others on the way over, stranding the floors they served.
- Burned-out rooms used to arrive as a block of colored static. They now come across as cleared floor, the way the original shows a room once its debris is gone.
- Loading a 1994 save no longer fuses two recycling centers built side by side into a single oversized one.

## 2.7.0

- Modern towers that badly outgrow their shops now really lose tenants: past heavy oversubscription they sour within a day or two, then move out after the notice window. Classic still only caps.
- When a shortage of nearby shops is what sours a tenant most, the gripe now says so instead of blaming a noisy neighbor, so the fix you reach for is the one that works.

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
<!-- When 2.0.0 shipped, the update prompt showed at most three lines (MAX_NOTES
     was 3 until 3.2.0) and parseUpdateInfo truncated silently rather than failing,
     so a fourth note here was DELIBERATE and shipped as documentation only. Keep the three player-facing gameplay lines above in the
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

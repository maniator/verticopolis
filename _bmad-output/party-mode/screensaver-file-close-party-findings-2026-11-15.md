# File > Close and a screen saver: party findings (2026-11-15)

Rooms: Web Game Room (Theo, Juno, Sally, Samus, Wren, Lior, Tess, Grumbal,
Boundary) with Kenji, Kai, Rhea and Lucia from the Player Panel. Asked by
Naftali on 2026-11-15: File > Close that autosaves and goes back to the title
screen "like a real application", and a Win95-style screen saver as an easter
egg (from a menu, on idle, or when the player switches tabs). Target: after
4.0.0 ships.

## What the room checked first

- **A hidden tab runs nothing.** The tower runs on Excalibur's
  `requestAnimationFrame` loop (`runFrame` in `src/game/frameLoop.ts`). A
  hidden tab gets no animation frames, so the simulation stops while the tab
  is hidden, and the first frame back is spike-clamped (over 200 ms counts as
  1 ms), so nothing catches up. The tab-hide save (`saveOnHide`,
  `src/game/autosaveSchedule.ts`) already writes the tower when the tab hides.
  A screen saver "while the tab is hidden" would draw to a page nobody can see
  and would cost nothing only because the browser stops it. The only screen
  saver a player can see is one waiting for them when they come back.
- **A blurred but visible tab keeps running** (a second monitor, a window on
  top). Covering the tower there would hide a game someone is watching.
- **The title screen already freezes the tower** (`pauseForSplash`), and
  `isSplashUp()` already stops autosave, emergencies and the update prompt
  behind it. Its Continue button only tears the overlay down, so a tower that
  stays loaded behind it comes back instantly.
- **The 4.0 welcome fireworks** (`src/ui/launchFireworks.ts`) already set the
  pattern for a period pixel canvas: a low-resolution canvas scaled up without
  smoothing, a frame step cap, a spark cap, `navigator.webdriver` never sees it,
  a `?debug=` preview, and one still frame under reduced motion.

## The conversation (condensed)

🎲 **Samus:** An easter egg nobody can find is a dead feature. It needs a door
in the menus, and then it needs to surprise you once without being asked.

🏢 **Kenji:** Win95 kept it under Display Properties, Screen Saver tab: a little
monitor, a drop-down, "Wait: 5 minutes", a Preview button. Put that dialog in
and half the vibe is done before anything animates. Options menu, not File.
File is for documents.

😤 **Grumbal:** And the first time it drops over a running tower while a fire
burns on 40, it's a bug report. I watch towers for ten minutes without touching
anything. That IS playing.

🌐 **Priya:** Same, on my lunch break. Idle is not
away.

🎨 **Sally:** Then idle means idle AND paused. A paused tower nobody has touched
for five minutes is a player who walked away. A running tower is a player
watching.

😤 **Grumbal:** Fine. Paused-only. I can live with that one.

⏱️ **Tess:** And the switch-tabs version: nothing runs while hidden, so the
honest feature is "when you come back after a while, the saver is up." Any key,
click or tap brings the tower back. No rendering while hidden, no timers that
wake a background tab.

♿ **Wren:** Coming back to something you didn't ask for is a surprise for a
screen reader user. Announce it ("Screen saver. Press any key to go back to
your tower."), keep focus where it was, swallow the key or click that dismisses
it so it never builds a room, and respect reduced motion: one still frame. No
flashing faster than three times a second, ever.

🤖 **Lucia:** On my phone the tab "hides" every time the screen locks. A saver
every unlock would be awful. Phones already have their own screen timeout.

🎮 **Rhea:** Same on the handheld, on battery. If the saver is up, stop drawing
the tower behind it. That's the battery win.

🕸️ **Theo:** Stopping Excalibur's loop under it is doable but `towerScene.ts`
has teardown subtleties; measure first, and if it's not clean, the paused tower
behind a full-screen overlay is already cheap. Dismissal is easy: one capture
listener while it's up, nothing while it's down. Idle is one timestamp the
existing input listeners already touch, plus one timer that re-arms itself. No
per-frame work, no `pointermove` handler doing `setTimeout` churn.

😤 **Grumbal:** Mouse move dismisses? A trackpad drifts a pixel and it's gone.

🌶️ **Boundary:** A threshold, a few CSS pixels, like Win95 tolerated. And: the
saver comes up while a dialog is open? While an emergency asks for an answer?
While the bomb search runs? Never over a modal, never over the title screen,
never under automation.

🖥️ **Kai:** Whatever it draws, draw it at the chunky pixel size and scale it.
At 4K a full-res canvas is the slow part.

📐 **Juno:** The settings live in the dialog, saved like the other UI prefs.
No save-format change.

🌍 **Lior:** And the saver's text (a marquee, if we do one) is whole sentences
from one place, not glued together.

### File > Close

🏢 **Kenji:** Close puts you back at the empty program window. Our empty window
is the title screen. Good.

🌶️ **Boundary:** Order: save, then title screen. If the save fails (a full
quota), stay in the tower and say so. Never show "Continue" over a tower that
didn't save.

😤 **Grumbal:** And gray it on the title screen. Closing nothing is a bug.

🕸️ **Theo:** No shortcut. Ctrl+W closes the browser tab, and we can't take it.
File > Exit can't close a tab the player opened either (`window.close()` does
nothing there), so no Exit item.

🏢 **Kenji:** (grumbling) No Exit. Fine.

🎨 **Sally:** On the title screen after Close, Continue is the focused button,
and the toast says the tower was saved.

## Verdicts

### File > Close (ship first, its own PR)

1. File > Close, below Quick Save. Grayed on the title screen and when the
   game stopped on its engine. No keyboard shortcut.
2. Close writes the tower the way the tab-hide save does (synchronous), then
   shows the title screen with Continue focused and a toast that it was saved.
   If the save throws, the tower stays open and the player is told.
3. The tower stays loaded behind the title screen, frozen as it is at boot, so
   Continue comes back at once, paused, with the usual "Welcome back. Press
   Play to resume."
4. Help: the File menu and saving pages say what Close does.
5. Version tier: minor (a new command) in a 4.x release after 4.0.0.

### Screen saver (its own PR, after Naftali picks a concept)

1. **Options > Screen Saver…** opens a Win95-style dialog: the saver list
   (with "(None)"), a small monitor preview, Wait (1, 3, 5, 10, 15 minutes),
   "Also when I come back to this tab", and a Preview button. The Preview
   button and a `?debug=screensaver` URL are the manual triggers.
2. **Idle trigger:** only while the tower is paused, no dialog is open and the
   title screen is down. Default wait 5 minutes.
3. **Coming back to the tab:** the saver is showing when the player returns
   after the tab was hidden at least the wait time. Off by default on phones
   and tablets (coarse pointer), on by default on desktop.
4. The tower is paused while the saver runs and returns to the speed it had,
   the way the Help pause works.
5. Any key, click or tap, or a mouse move past a small threshold, ends it, and
   that input never reaches the tower. Focus returns where it was. It is
   announced to screen readers.
6. Reduced motion: one still frame. Nothing flashes faster than three times a
   second.
7. Cost: nothing per frame while it is down. Idle is a timestamp plus one
   self-re-arming timer. While it is up, its own low-resolution canvas at most
   30 frames a second; stopping the tower's draw loop under it only if
   measured clean.
8. Never under browser automation, never over the title screen or a dialog.
9. Analytics: `screensaver_start` (trigger, saver) and `screensaver_end`
   (duration bucket), added to the data map.
10. Version tier: minor.

### Concepts for Naftali to pick from

The room shortlisted five, all original art in the game's own pixel style (no
copy of any 1990s product's savers or logos; Grumbal and Kenji both insisted):

- **Night Shift**: the player's own tower at night, drawn from the last frame
  (rooms as lit blocks), windows switching on and off, elevator cars gliding in
  their shafts, a moon crossing. Samus and Kenji's favorite; the most personal.
- **Skyline Starfield**: flying through a night city where the stars are lit
  windows. Kai's pick; the cheapest.
- **Express Elevators**: little elevator cars with riders drifting across the
  night sky, doors opening now and then. Sally's pick; the most "easter egg".
- **Endless Tower**: a crane builds a tower floor by floor, shafts growing like
  pipes, until the screen is full, then starts a new one. Juno and Rhea's pick.
- **Bulletin Marquee**: the tower's name, stars, population and newest
  Bulletin line scrolling across black. Wren's pick; the easiest to read.

Unsettled: Samus wants Night Shift as the only saver ("one perfect one");
Kai and Sally want a list to pick from, like Win95. Owner decides.

## Round 2: a pretend desktop (Naftali, 2026-11-15 02:23Z)

Naftali asked about minimize, maximize and a smaller "restored" window that
everything fits in, maybe joke icons on a pretend desktop, embracing the
1990s desktop look without ever naming the operating system. Room: Sally,
Juno, Wren (UI/UX), Samus, Kenji (game), Bea (community) with Dale, a
r/SimTower regular who walked on, Tess, Theo, Tomasz, Lucia, Grumbal.

📣 **Bea:** This is the screenshot that gets posted. "They built a fake
desktop around a SimTower game" is a front-page title on r/SimTower and
r/IndieGaming. The comments will say the OS name for us. We never have to.

🧢 **Dale (r/SimTower):** Half the sub played the original in a window on an
800x600 desktop. A restore button that drops it to 800x600 with a teal
desktop behind it? People will lose their minds. Hide stuff on the desktop
and we'll find it in a week.

😤 **Grumbal:** And the other half will say you wasted their screen. If the
desktop is ever the default, I'm out.

🎨 **Sally:** It never is. The game opens maximized, like today. The desktop
only shows when you press restore or minimize.

📐 **Juno:** Catch: the layout switches between phone and desktop on the
viewport, not the stage. A small window on a big screen would get the
desktop layout squeezed. So the restored window has a floor: 800x600, and
it offers the period sizes (800x600, 1024x768) instead of free resizing at
first.

⏱️ **Tess:** A smaller window draws fewer pixels, so restore is cheaper, never
slower. The desktop behind it is still DOM, no animation, no canvas. And
minimized is the big win: stop drawing the tower entirely.

🏢 **Kenji:** Minimized programs kept running. Keep time running.

😤 **Grumbal:** Running where nobody can see a fire? No.

🕸️ **Theo:** Emergencies already freeze time behind their dialog. So
minimized can keep the clock going without drawing, and the taskbar button
flashes when an emergency or a Bulletin line wants you, the way taskbar
buttons did.

🎲 **Samus:** Joke icons are easter eggs, so ship them later and unannounced.
"My Tower" (opens Tower Info), a bin that holds what you bulldozed today, an
"ELEVATOR.TXT" that's a real tip, and the Screen Saver dialog. Every icon
does something; no dead jokes.

♿ **Wren:** Window buttons get names a screen reader says ("Minimize",
"Restore", "Maximize"), the desktop icons are buttons you can Tab to, and
Escape or the taskbar brings the game back.

🤖 **Lucia:** Phones get none of it. Full screen stays full screen.

📣 **Bea:** Words: no "Start" button with a flag, no "Recycle Bin", no "My
Computer". Our own logo on the taskbar, our own names. That's the line that
keeps us clear of the trademark and the "ripoff" comments.

🔒 **(Grumbal, last word):** One bug where restore loses the camera or the
canvas goes blank and Reddit will post that instead.

### Verdicts, round 2

1. Do it, after File > Close and the screen saver, as its own 4.x feature.
   The game opens maximized; the desktop is never the default.
2. Title bar buttons on desktop computers only: Minimize, Restore or
   Maximize. Phones and tablets keep full screen with none of this.
3. Restore: a window at 800x600 or 1024x768 (whichever fits), never smaller,
   movable by its title bar, on a plain teal desktop with a taskbar. The
   taskbar shows our logo, the game's button and the tower's clock.
4. Minimize: the game stops drawing (cheaper), time keeps running at the
   chosen speed, emergencies still stop time behind their dialog, and the
   taskbar button flashes when the tower needs the player.
5. Joke icons later, unannounced in the release notes (the help site says
   only that the desktop may hold a few surprises). Every icon does something
   real. Our own names and art; nothing named after or drawn like another
   company's desktop.
6. Never write the operating system's name in the game, help, notes or
   posts.
7. Before building: a mockup for Naftali, and a check that restore keeps the
   camera, the canvas and the floating windows intact.

### Round 2b: the taskbar and a performance window (Naftali, 02:24Z)

Naftali added: the desktop needs a bottom bar, with the time, and maybe a
"task manager" that shows FPS without the `?debug=fps` query.

⏱️ **Tess:** Yes. A window that shows frames a second, how long a step takes,
how many people are drawn and the tower's size turns every Reddit "it's
laggy" post into a screenshot with numbers. It samples once a second while
it's open and costs nothing while it's closed. The FPS overlay from #2218
already has the sampler.

🖥️ **Kai:** I'd keep it open all day.

😤 **Grumbal:** Name it after their task manager and you've named the OS. And
an FPS counter invites "why is mine 40" threads.

📣 **Bea:** Those threads happen anyway, without numbers. Numbers make them
answerable. Call it "Tower Monitor".

📐 **Juno:** Maximized, the game already has the status bar at the bottom. A
taskbar there too is two bars eating the build area we just won back. So the
taskbar shows with the desktop (restored or minimized), and Tower Monitor
opens from the Window menu too, so a maximized player never needs the
taskbar to reach it.

🏢 **Kenji:** The taskbar clock is the tower's clock, day and time. Not the
wall clock.

♿ **Wren:** Tower Monitor's numbers are text, readable by a screen reader,
and they don't announce every second.

Verdicts: the taskbar shows with the desktop and holds our logo, the game's
button and the tower's clock; a click on the clock opens Tower Monitor.
Tower Monitor (Window menu and taskbar): frames a second, step time, people
drawn, tower size, sampled once a second only while open. `?debug=fps`
stays for testing.

### Round 2c: little tray icons (Naftali, 02:24Z)

Naftali: small icons on the bottom bar, like whether you're playing offline
or online, and other useful ones for fun.

📐 **Juno:** One tray, two homes: the right end of today's status bar when
maximized, the taskbar's corner when restored. Then it can ship before the
desktop does.

🕸️ **Theo:** "Online" from `navigator.onLine` lies on captive Wi-Fi. What's
true and useful is whether the game is ready to play offline (the service
worker has this version cached). So the icon says "Ready offline" or "Needs
the internet to load", plus "An update is waiting" when one is.

⏱️ **Tess:** Every icon changes on an event (online and offline events, a
save landing, an update found, mute). No polling, nothing per frame.

😤 **Grumbal:** Four icons, tops. A tray full of junk was the worst part of
the era.

🎲 **Samus:** Then make the four good: offline-ready, the last save (a floppy
that lights for a moment when the autosave lands, hover says when), sound
(click to mute), and the update waiting.

♿ **Wren:** Each one is a button or has a name a screen reader says, never
color alone, and the floppy's light is one slow blink, never a flicker.

📣 **Bea:** The floppy is the one people will love. "Did it save?" is the
most common question we get.

🤖 **Lucia:** Phones have no status bar, so no tray there; the update prompt
and save notices already reach them.

Verdicts: a tray of at most four icons (offline-ready, last save, sound,
update waiting), event-driven only, on the status bar when maximized and on
the taskbar when restored; desktop computers only. It can ship ahead of the
desktop.

### Round 2d: closing down to the desktop icon (Naftali, 02:25Z)

🏢 **Kenji:** That's exactly how programs worked. File > Close closed the
document and left you at the program's empty screen. The ✕ on the title bar
closed the program, and you double-clicked its icon to start it again.

🎨 **Sally:** So both: File > Close goes to the title screen (shipping first),
and once the desktop exists, the window's ✕ saves and closes the game down
to a Verticopolis icon on the desktop. Double-click (or Enter) opens the
title screen again.

😤 **Grumbal:** Saves first, same rule as Close. A failed save keeps the
window open.

Verdict: File > Close stays as built. The title bar ✕ arrives with the
desktop and closes to the icon.

### Round 2e: an easter egg hunt and a badge (Naftali, 02:26Z)

Naftali: a Reddit post ("find all the easter eggs"), and a badge on the
player's own browser profile for finding them all, like the 2.0 founder
mark, that could later be a Steam achievement.

📣 **Bea:** Love it, with one timing rule: the 4.0 post can't ask people to
find eggs that aren't in 4.0. The 4.0 post can say "there's more hiding in
4.x". The hunt post goes up the day the desktop ships.

🧢 **Dale:** Say how many there are. "7 hidden things" gets a thread full of
people comparing notes. "Some hidden things" gets nothing.

🏢 **Kenji:** "Ground floor" is taken, that's the 2.0 founder mark. Give it a
period name: "Power User".

😤 **Grumbal:** It lives in browser storage, so clearing site data wipes it.
Say so. And it is never a tower milestone: the engine's milestones are tower
progress, and nothing a profile badge does may touch the sim.

🎲 **Samus:** About box shows it: "Easter eggs found: 3 of 7", and the badge
once all seven are found. Each find gets a small toast the first time.

♿ **Wren:** Every egg reachable by keyboard and touch too. No mouse-only
secret clicks.

⏱️ **Tess:** Event-driven, a latch per egg. Zero cost.

Verdicts: a per-profile "Power User" badge (name open) for finding every
easter egg, shown in About with a found count; presentation only, never in
the save or the sim; every egg reachable without a mouse; the count is
public; the hunt post goes out when the desktop ships, and the 4.0 post may
only tease. A Steam achievement for it later goes through the native
client's store-neutral sink.

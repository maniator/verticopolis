# Party findings: a windowed game, and separate windows inside it (2026-11-15)

Room: Web Game Room (Theo, Juno, Sally, Samus, Wren, Tess, Priya, Femi,
Lucia, Ben, Tomasz, Grumbal, Boundary), with Kenji (the 1994 game) and Kai
summoned and Dale (r/SimTower) back as a walk-on. Mode: session.

Owner's asks (Naftali, 2026-11-15 20:20Z to 20:33Z):

1. A blue app title bar with the Verticopolis name, minimize and close, and
   whether the whole game window can be moved. Mockups:
   `/mnt/project-files/app-title-bar-design/`.
2. "If we're making this pseudo-windowed, all the little [windows] also should
   be things on the taskbar, no? To be able to close and open."
3. "Even in the original game, the HUD also was a separate little window, the
   tower itself is a separate little window, and all the options to things to
   build is a separate little window. It would be cool to be sort of emulating
   of that, but if that's too much and it feels like that would be
   over-engineering, please let me know with a proper party round table."

Facts on the table: the 1994 game opened a new tower with three windows, the
Map window, the Info window (money, population, date, time) and the Edit
window (the tower close-up), plus a separate tool bar of build items (a
January/February 1995 Inside Mac Games guide). Fan guides tell players to
close the Map window and shrink the main window for speed. Today the game has
one maximized window with a docked Tools window, the top bar (our Info
window), and three floating windows (Map, Bulletin, Tower Info) that
`src/ui/movableWindow.ts` already moves.

## Round 1: separate windows, or over-engineering?

🏢 **Kenji:** He's right about the original. You opened a tower and got
three windows and a tool bar, and you shoved them around until the tower had
room. Everybody I knew maximized the Edit window in the first five minutes
and parked Info and the tool bar on top of the sky.

🎲 **Samus:** Which is the fun part. Your desk was yours. Two players' screens
never looked the same.

😤 **Grumbal:** Your desk was a mess. A tower inside a window inside a window
inside a browser tab. Three frames before you see a single office. Somebody
closes the tower window and Reddit posts "my tower vanished".

📐 **Juno:** Split it. There are three different things in that ask. The Info
window and the tool bar: those are our top bar and our Tools window, and
Tools is already a window with a title bar. Letting them float is a
`movableWindow` call we already have. The tower as its own window is a
different animal: the canvas, the camera, pointer capture, resize, focus,
z-order.

🕸️ **Theo:** And the canvas fills its container, so a tower window you resize
by its corner means a GL resize on every pointer move unless we resize with an
outline and apply it once. Doable. Not free. Restoring the whole game window
already gives you a tower in a small window.

⏱️ **Tess:** Numbers side: a floating Info or Tools window costs nothing per
frame. A smaller tower window draws fewer pixels, so cheaper, never slower.
What I won't sign is per-frame layout during a drag. Outline drags only, the
way the mockup does it.

🎨 **Sally:** Here's the period trick nobody's said. Office 95 toolbars. Docked
by default, and you could drag one off the edge and it became a little
floating window, and drag it back to dock it. That's the 1994 desk without
making anyone build it. Default stays today's layout; float it if you want
the old look.

🌐 **Priya:** As long as "today's layout" is still what I get when I open it
on my lunch break. I am not arranging windows before I can build a lobby.

😤 **Grumbal:** Docked by default, float on purpose. Fine. And the tower is
never a window you can close. It's the program.

🎲 **Samus:** Agreed. The tower is the window's own inside. Nobody closes the
Edit window.

♿ **Wren:** Then I want the keyboard rules before anyone draws a pixel. A
floating window must be reachable without a mouse: the Window menu lists it,
F6 moves between the tower and the open windows, and a window dragged off the
screen comes back with Window > Arrange.

🌶️ **Boundary:** And a window floated on a 1920 screen and loaded on a 1366
laptop lands on screen. `movableWindow` already refits on resize; Tools and
Info need the same, plus "the dock is gone" if the game window is restored
small.

💻 **Tomasz:** On my 1366x768, floating anything over the tower is a loss.
Docked must stay one click away.

## Round 2: the taskbar, or the bottom of the window?

🖥️ **Kai:** Map, Bulletin, Tower Info, Tools, each a button on the taskbar.
Click to open, click to close. That's what he asked for and I want it.

📐 **Juno:** Problem: the taskbar only exists when the game is restored or
minimized. We agreed that in round 2b (no second bottom bar while maximized).
Everyone plays maximized. So the buttons would be missing exactly where
people play.

🏢 **Kenji:** And 95 never did it. The taskbar listed programs. The windows
inside a program lived in its Window menu. But 3.1 had the thing you want:
minimize a window inside a program and it dropped to a little title strip at
the bottom of the program's window. Click it, it came back. That's the era
the tower game came from.

🎲 **Samus:** Little strips along the bottom of the tower view. Map, Bulletin,
Tools. That's adorable, and it's there when you're maximized.

😤 **Grumbal:** Two places to find a window means nobody finds it. One place.

🎨 **Sally:** One place: the bottom of the game window, maximized or restored.
The taskbar gets one button, the game's, with the tower clock and the tray.
The Window menu keeps its check marks.

🖥️ **Kai:** I still want them on the taskbar.

🧢 **Dale:** As a Reddit guy: the strip is the screenshot. A taskbar full of
"Map" and "Bulletin" looks like any web app.

♿ **Wren:** Each strip is a button with the window's name, Tab reaches it,
Enter restores it. A window's minimize button says "Minimize Map" to a screen
reader, not just "Minimize".

## Round 3: phones

🤖 **Lucia:** None of it. 390 px, one hand, a bus. Floating windows on that are
windows on top of the only thing I'm looking at. The bottom tool strip and the
Map button work.

📱 **Ben:** Same on iPhone. On an iPad, maybe one day, but not this round.

🎒 **Femi:** Chromebook is a laptop. Treat it as desktop.

📐 **Juno:** So the line is the one we already use: desktop computers (fine
pointer, desktop layout) get the windowed features; phones and tablets in the
phone layout get none of them. The phone title bar question is still the
owner's (✕ only, or nothing).

## Verdicts (vote 11-2: Kai and Samus wanted the full MDI tower window)

1. **Not over-engineering:** the outer game window (title bar, minimize,
   maximize and restore, drag by the title bar, close), as already planned.
2. **Worth it, cheaply:** the Info window (today's top bar) and Tools become
   dockable. Docked by default, exactly today's layout; drag one by its title
   bar to float it, drag it back to dock it, as 1995 toolbars did. Reuses
   `movableWindow.ts`; outline drags only; positions refit to the screen.
3. **Over-engineering for now:** the tower view as its own movable, resizable,
   closable window. The tower is the game window's own inside. Restoring the
   whole game window already gives a tower in a small window. Revisit only if
   players ask after the rest ships.
4. **Small windows (Map, Bulletin, Tower Info, floating Tools and Info):** each
   gets Minimize next to its ✕. A minimized one becomes a small title strip at
   the bottom of the tower view (3.1 style), there whether the game is
   maximized or restored; click or Enter restores it. The taskbar lists only
   the game (with the tower clock and the tray). The Window and Tower menus
   keep their check marks. Kai and Samus dissent on the taskbar; owner's call.
5. **Phones and tablets in the phone layout:** none of the windowed features.
6. **Keyboard:** F6 cycles the tower and the open windows; every window is in a
   menu; Window > Arrange brings every floating window back on screen and
   re-docks Tools and Info.
7. **Cost:** nothing per frame while idle; a minimized game stops drawing; drags
   move an outline and apply once.

Build order for the preview: the outer window and taskbar first, then the
minimize strips, then docking and floating for Tools and Info.

## Round 4: phones, again (Naftali, 20:34Z: "focus on desktop", any options for mobile?)

Naftali: phones can probably stay as they are; desktop can be a very retro
desktop. Asked whether the room sees any mobile options worth having.

🤖 **Lucia:** Three things you could do, and I'd ship one of them. One, nothing:
today's phone layout. Two, a slim blue title bar with ✕ and the tower's name,
which costs 30 px of tower. Three, a "window switcher": Map, Bulletin and
Tower Info open one at a time as full-width panels with a blue title bar, and
a row of little strips above the tool bar for the ones you minimized.

📱 **Ben:** Three is the iPad one. On an iPhone it's a sheet with extra
chrome. I'd play it, but I'd never ask for it.

🎨 **Sally:** The phone already has its own period look: the menu bar, the
beveled tool strip, the Map button. Adding a title bar to a screen that IS the
window is a costume.

😤 **Grumbal:** 30 px of tower for a name I already know. No.

🎲 **Samus:** The strips are cute on a tablet in landscape. Park it.

♿ **Wren:** Whatever you pick, a phone gets nothing it can only reach by
dragging.

Verdict: phones keep today's layout (option M1), 12-1 (Samus wants the
switcher on landscape tablets later). The title bar (M2) and the switcher
(M3) go on the options page so the owner sees them, marked not recommended.

## Round 5: desktop settings on the taskbar (Naftali, 20:35Z)

Naftali: on the desktop, things like sound or display can live on the new
bottom bar: changing the settings of your desktop versus the settings of the
game.

🏢 **Kenji:** That's exactly how it was. The speaker by the clock was the
computer's volume, not the game's. The game had its own sound on/off in its
menu.

🕸️ **Theo:** And it maps cleanly onto what we store. Sound, full screen,
screen saver, window size and reduced motion are device preferences. Rules,
autosave and bridging are the tower's or the game's. Two homes that match
two kinds of data.

📐 **Juno:** So the tray grows a little. Round 2c capped it at four. Make it:
sound (click: a volume slider with Mute, double-click: the full Sound
window), display (Display Properties: window size, Full Screen, screen saver,
colors later), last save, offline-ready, and the clock opening Tower Monitor.
Update-waiting shows only when there is one.

😤 **Grumbal:** Four was the cap for a reason. And when you're maximized
there's no taskbar, so your "desktop settings" vanish exactly when people
play.

📐 **Juno:** Round 2c already answered that: maximized, the tray sits at the
right end of the status bar. Same icons, same popups.

♿ **Wren:** And every tray item stays in a menu: Options > Sound and Options >
Screen Saver… don't move out, they just gain a second door. Tray icons are
buttons with names, popups close on Escape and return focus.

🌐 **Priya:** Game Settings stays where I know it. Fine by me.

🖥️ **Kai:** Display Properties with a little monitor picture and the tower as
the wallpaper preview. I'm in.

😤 **Grumbal:** Five icons, no more, and the update one doesn't count because
it's usually gone. I'll live.

Verdict (11-1, Grumbal grudging yes): the tray holds the device's settings
(sound with a volume popup, Display Properties with window size, Full Screen
and the screen saver), the last save, offline-ready, the clock (Tower
Monitor) and update-waiting when there is one. Game Settings (rules,
autosave, tower options) stays in Options > Settings. Tray items keep their
menu paths. Maximized, the tray lives at the right end of the status bar.

## Owner notes to fold in when work resumes (Naftali, 20:36Z)

- The screen saver setting moves into a Control Panel-style window (with
  Display Properties and Sound), on the desktop's side of the split.
- The taskbar's start-style button wears the Verticopolis icon, never an OS
  logo.
- Queued for a party round (21:08Z): Help as one of our windows (an iframe of
  the help site that can be closed, minimized and maximized) instead of a new
  tab, keeping the help site the single source. Weigh it against the help
  site's own Win95 menu bar queued with the help subdomain move.
- Requirement (21:09Z): every window states whether it can be resized,
  maximized and minimized, with its min and max sizes. A per-window table goes
  on the options page, and later into the repo docs.

## Round 6: Help as one of our windows (Naftali, 21:08Z)

Naftali: Help could pop up as a window in front that you close or maximize,
an iframe of the help site, instead of today's new tab, so the help site stays
the one place help is written.

🕸️ **Theo:** It's buildable today. The manual is served from our own origin
(`/help/`) and sends no header that forbids framing, so an iframe just works.
If it moves to the help subdomain, that site has to allow our origin to frame
it (`frame-ancestors`), nothing more.

🤖 **Lucia:** This fixes my complaint from the Help-in-a-tab round. On the
installed app, a new tab throws me out of the app into the browser. A window
keeps me in the game.

😤 **Grumbal:** And offline? Help offline is the dinosaur. Now the dinosaur
lives inside our window.

🕸️ **Theo:** Then the window shows our own page: "The Player's Manual needs
the internet", with the built-in Getting Started and a Try again button. We
know when the frame fails to load, and the service worker can answer for it.

📐 **Juno:** Double chrome is the real problem. The help site is getting its
own Win95 menu bar with the subdomain move. Inside our window that's a title
bar, then a menu bar, then the page's own window frame. So the help site
drops its frame and menu bar when it is framed (an `?embed` flag), and our
window's title bar and a small toolbar (Contents, Back, Open in a new tab)
take over. People who arrive from a search still get the full help site with
its menu bar. One source, two frames.

♿ **Wren:** Focus goes into the help page when the window opens, Escape
closes the window even when the focus is inside the frame (the framed page
passes Escape up), and focus comes back to the menu item.

🎲 **Samus:** Help menu items open the right page in the same window: Classic
vs Modern opens that page, not a second window.

🌐 **Priya:** Keep "Open in a new tab". Sometimes I want the manual on my
other monitor.

📱 **Ben:** On a phone it opens full screen inside the game with a ✕, like a
sheet, no minimize or maximize.

😤 **Grumbal:** An iframe that loads a whole Astro site every time someone
misclicks Help. Fine, if it loads only when opened and unloads when closed.

⏱️ **Tess:** Agreed: nothing loads until the window opens, and closing it
removes the frame. Minimized keeps it (the player expects their page back).

Verdict (12-1, Grumbal: yes, if it loads on open and unloads on close): Help >
Player's Manual opens a Help window holding the help site in a frame:
resizable, minimizable, maximizable, one window reused by every Help item,
with Contents, Back and Open in a new tab. The help site hides its own menu
bar and frame when framed, and keeps them for visitors. Offline shows our own
page with Getting Started. Phones open it full screen with ✕ only.

## Round 7: the Control Panel and the start button (Naftali, 20:36Z)

Naftali: the screen saver setting can move to a Control Panel style window,
and the start button wears a Verticopolis icon instead of an OS logo.

🏢 **Kenji:** In 95 the screen saver was a tab inside Display. Put it there.

📣 **Bea (summoned):** "Control Panel" is a fine generic name; the Mac had
Control Panels too. The button says "Verticopolis" with our tower icon, never
"Start", never a flag. Its menu's side banner reads VERTICOPOLIS in our own
type.

🎨 **Sally:** Control Panel holds three icons, no padding: Display (window
size, Full Screen, the Screen Saver tab), Sound (volume, mute, effects and
music), and Accessibility (reduced motion, larger text later). Everything
there is about this device. The game's Settings keeps the tower's rules.

♿ **Wren:** Accessibility in the Control Panel is right for the period, and it
must also stay reachable from Options, because a player who needs reduced
motion should not have to find a pretend desktop first.

😤 **Grumbal:** And the start menu doesn't grow into a second menu bar. Six
items.

Verdict: the Verticopolis button opens a short menu: New Tower…, Open…,
Player's Manual, Control Panel, Tower Monitor, About Verticopolis…, Close
Verticopolis. Control Panel holds Display (with the Screen Saver tab), Sound
and Accessibility. Options > Screen Saver… becomes Options > Control Panel…;
Options > Sound stays as the quick toggle.

## Round 8: what each window may do (Naftali, 21:09Z)

Naftali: every window has to say whether it can get bigger or smaller, and
which ones can't; write down what's what.

📐 **Juno:** One table, one row per window, and the code reads the same
rules from one place. Rules the room agreed: the tower is never closable or
minimizable on its own (it is the game); dialogs that wait for an answer
never minimize, maximize or resize; small floating windows never maximize;
nothing is ever smaller than its content's minimum; a window's title bar is
always reachable on screen.

🌶️ **Boundary:** Sizes are CSS pixels at 100% zoom, and a saved size is
clamped to the screen it opens on.

Verdict: the per-window table on the options page is the spec; it moves into
the repo docs with the first PR.

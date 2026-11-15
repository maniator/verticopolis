# Menu bar order and the opening screen: party findings, 2026-11-15

Room: Web Game Room (bmad-party-mode, session mode), plus Kenji (SimTower
veteran) from the Player Panel.

Questions from Naftali:

1. Call Fire Rescue… should be grayed when it can't be used. Should Modern
   have a Call Exterminator… beside it?
2. Which menus and items should show on the opening (title) screen at all?
3. Full Screen from Window to Options, and Bulletin from Window to Tower?
   Settle the menu bar's order.

Facts on the table: the engine refuses Call Fire Rescue with `none` (no fire
burns) or `pending` (a choice already waits). Modern has an exterminator
(`Simulation::call_exterminator`, refused `unavailable` in Classic, `pending`
once a crew is booked, `none` with no infested hotel room, `funds`), booked
today from Tower Statistics. Today the title screen shows all six menus with
the tower commands grayed. On a phone, Window's Tools and Status Bar items
are already left out.

## The round

🎨 **Sally:** Start with the opening screen. A grayed command says "not
now, but soon". A whole menu of grayed commands says "this program is
broken". With no tower open, Edit, Tower and Window have nothing to offer,
so they shouldn't be there.

🏢 **Kenji:** That's how my old programs behaved with no document open. The
menu bar shrank to File and Help, and grew back when you opened something.
Nobody was confused.

😤 **Grumbal:** Menus jumping in and out moves the bar under your mouse.
Somebody aims at Options and lands on Window.

🎨 **Sally:** It changes once, when a tower arrives or Close takes you back.
Never while you're looking at the bar.

♿ **Wren:** And hiding is kinder to a screen reader than six menus of
"dimmed, dimmed, dimmed". Hide with the `hidden` attribute so nothing is
announced, and make sure the arrow keys skip a menu that isn't shown.

🌐 **Priya:** Inside File, same rule. New Tower, Open and Load work on the
opening screen. Save, Save As and Close have nothing to act on, so hide
them too, and their lines.

🌶️ **Boundary:** Then Help's Replay Getting Started goes too: it replays a
tutorial in a tower you don't have. Options stays whole: Settings, Sound and
Screen Saver all work before a tower is open.

🤖 **Lucia:** On my phone the bar is tight. Fewer titles on the title screen
is a free win.

🎲 **Samus:** Now the fire. Gray it when no fire burns. A grayed "Call Fire
Rescue…" is a little bit of drama in itself: the moment it lights up, you
know something is wrong.

🏢 **Kenji:** Gray it, don't hide it. In Classic that item is part of the
furniture.

🎲 **Samus:** The exterminator is the same shape: a call you make when
something is wrong. Put it right under Fire Rescue. Lit when there are
infested rooms and no crew booked yet, grayed otherwise.

🏢 **Kenji:** In Modern. In Classic it must not appear at all. A grayed item
in Classic would tell me there's some way to get it, and there isn't.

♿ **Wren:** Agreed: hidden in Classic, grayed in Modern when there's nothing
to treat.

😤 **Grumbal:** Does a grayed exterminator in a tower with no hotel nag
Modern players?

🎲 **Samus:** It's one line in a menu they opened. It also teaches that the
service exists before they need it.

⏱️ **Tess:** How do you know there's a fire? Not a per-frame read, please.

🕸️ **Theo:** Read it once, as the Tower menu opens, the way Undo and Redo
are grayed today. Classic asks the cheap stats strip for the fire count.
Modern asks the stats sheet the Statistics window already reads, which has
the infested count and whether a crew is booked, and uses the same rule as
the button in Statistics. Nothing runs while the menu is closed.

⏱️ **Tess:** One read per menu open is fine. Not per pointer move.

🎨 **Sally:** Naftali's moves. Bulletin next to Tower Info and Map makes the
Tower menu "this tower's windows", and that's right: all three are about
your tower.

📱 **Ben:** And Full Screen to Options is right too: it's a setting for the
program, and on my iPad it's the one Window item I ever used.

🌶️ **Boundary:** Then Window is down to Tools and Status Bar, and on a phone
both are already left out. An empty menu on a phone is a bug. Hide the
Window title on phones, the way Status Bar already hides there.

😤 **Grumbal:** Rename it View then, if it's only toolbars?

🏢 **Kenji:** It held windows two days ago; players just learned it. Leave
the name. Tools is a window.

📐 **Juno:** And Full Screen doesn't need a tower, so it's still there on the
opening screen, now that it lives in Options.

🌍 **Lior:** Keep the labels as they are: "Call Exterminator…" with the
ellipsis, because it opens a confirm with the price, the same as fire rescue.

## Verdict

**Opening screen (no tower open):**

- Show only **File**, **Options** and **Help**. Hide **Edit**, **Tower** and
  **Window** (Sally, Kenji, Wren; Grumbal's worry answered: the bar changes
  only when a tower arrives or Close returns to the title screen).
- **File** shows New Tower…, Open… and Install app (when offered). (File >
  Load left the menu on main the same day, #2325.)
  Save, Save As… and Close are hidden, with their separator lines (Priya).
- **Help** hides Replay Getting Started (Boundary). Everything else in Help
  and all of Options stays.
- Hidden menus and items use the `hidden` attribute; the arrow keys and Alt
  letters skip them (Wren).

**In a tower, the order:**

| Menu | Items |
| --- | --- |
| File | New Tower…, Open… / Save, Save As… / Install app / Close (unchanged) |
| Edit | Undo, Redo (unchanged) |
| Tower | Tower Info, Map, **Bulletin** / Statistics…, Rename Tower… / Call Fire Rescue…, **Call Exterminator…** (Modern) / This Tower's Rules… |
| Window | Tools, Status Bar (computers only; the whole menu is hidden on a phone) |
| Options | Settings…, Sound, Screen Saver… / **Full Screen** |
| Help | Player's Manual, Classic vs Modern, Replay Getting Started / Sponsor Verticopolis, About Verticopolis… (unchanged) |

**Fire and pests:**

- **Call Fire Rescue…** is grayed unless a fire burns and no choice is
  already waiting (Samus, Kenji). Both modes.
- **Call Exterminator…**: Modern only, hidden in Classic (Kenji, Wren).
  Lit only when a hotel room is infested and no crew is already booked;
  it opens the same priced confirm as the button in Tower Statistics.
- Both are read once as the Tower menu opens, never per frame (Tess, Theo).

The Window menu keeps its name (Kenji over Grumbal).

## Owner amendment (Naftali, 2026-11-15, after the round)

Asked what Window held, Naftali chose to fold it into Options: the Window
menu goes, and Options reads Settings…, Sound, Screen Saver… / Tools, Status
Bar (computer only, and not on the title screen), Full Screen. The bar is
File, Edit, Tower, Options, Help on every layout, and File, Options, Help on
the title screen.

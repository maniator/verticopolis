# The 1994 desk: window rules

On a computer (a window at least 1024 by 600 whose main pointer is a mouse or trackpad, touchscreen laptops included, tablets with a pen or a keyboard trackpad left out; `?desk=on` turns it on on any screen 768 wide or more, such as a phone in its browser's desktop mode) the game runs as a
1994 desktop: each part of the game is its own window on a teal desk with a
taskbar. Phones, tablets, small windows and the title screen keep the
ordinary layout. The code is `src/ui/desk/`; the numbers below live in
`src/ui/desk/deskGeometry.ts` and its tests.

| Window | Moves | Resizes | Minimize | Maximize | Close | Starts at |
| --- | --- | --- | --- | --- | --- | --- |
| Tower (menu bar, tower, status bar) | Title bar | Grip, at least 320 by 240 | Yes | Yes, button or double-click the title | File > Close | Under Info, between Tools and the side column, to the foot of the desk |
| Info (meters, speed and undo buttons) | Title bar | No (the width between Tools and the column, set by the desk) | Yes | No | Never (Window > Info brings it up) | A strip across the top between Tools and the column; it wraps to two lines on a narrow desk |
| Tools | Title bar | Grip, height only, at least 200 | Yes | No | Never (Window > Tools brings it up; a Tools window folded off the desk opens) | Top left, 184 wide |
| Map | Title bar | No | Yes | No | ✕, Window > Map | Top of the right column |
| Bulletin | Title bar | No | Yes | No | ✕, Window > Bulletin | Bottom of the right column (on a desk too short for it under the Map, over the tower's sky at the left, clear of the menu bar, the toasts and the ground line) |
| Tower Info | Title bar | No | Yes | No | ✕, Window > Tower Info | Under Info, left of the column |
| Control Panel | Title bar | No | Yes | No | ✕; opens from the Verticopolis menu and the tray | The middle of the desk |

- Windows stack in the order they were pressed, the tower like any other, and
  only the last one pressed has a lit title bar (owner, 2026-11-15). A
  maximized tower fills the desk and stays under the small windows; one over
  its title bar or menus steps down below the menu bar and steps back on
  restore unless the player moved it meanwhile. On restore the tower comes to
  the front.
- Info and Tools never close on the desk (owner, 2026-11-15), so nothing the
  player plays with can be lost. The tower's menu bar has a Window menu on
  the desk (Tools, Info, Map, Bulletin, Tower Info, then Status Bar and Full
  Screen moved in from Options): each item brings its window up, closed or
  minimized, and is checked while it is open. Options drops Tools there.
- A right-click on a window's title bar or taskbar button (or Shift+F10 or the
  context menu key on a taskbar button) opens its window menu: Restore,
  Minimize, Maximize (the tower), Close, each grayed when it does not apply.
- A minimized window keeps its layout (it is only hidden), so the tower's
  canvas never re-sizes while it waits on the taskbar.
- A resize draws a dotted outline and sets the size once on release.
- The taskbar has the Verticopolis button (New, Open, the Player's Manual,
  Screen Saver, Control Panel, Settings, About, Close; an item whose menu-bar
  twin is hidden, such as Close on the title screen, is left out), one button
  per open window (press to bring it up, press the front one to minimize it)
  and the tray (the monitor that opens the Control Panel, sound, clock).
  The Control Panel's Sounds icon reads Sounds: On or Off, and the tray's
  speaker follows a change at once.
- Places and sizes are kept in `vc-desk-places` (the layout before the Info
  strip, `vc-desk-layout`, is no longer read), the maximized tower in
  `vc-desk-max`; `vc-desk` = `off`
  turns the desk off and `any` puts it on any screen 768 wide or more (the
  testing switches `?desk=off` and `?desk=on`; there is no player switch,
  owner 2026-11-15).
- The Bulletin, the Map and Tower Info move with the game's own movers; the
  desk hears those moves too and keeps their places.
- When the browser window gets smaller, every open window is pulled back onto
  the desk (once per frame at most, on `resize` only); a maximized tower
  already fills it.
- Analytics (`app_action`, codes in `src/ui/desk/deskAnalytics.ts`, every
  row in docs/analytics-data-map.md): `desk_shown` is the desk coming up over
  a tower and `desk_title_shown` around the title screen (each once per page
  life); `desk_window` is a window changing, detail `<window>_<verb>` with
  windows `tower`, `info`, `tools`, `map`, `bulletin`, `tower_info`,
  `control_panel` and verbs `min`, `restore`, `max`, `unmax`, `resize`,
  `move` (the first move in a page life) and `close` (the tower's and the
  Control Panel's ✕; the Map, Bulletin and Tower Info ✕ keep their own
  `window_close`, which a window-menu Close does not send), from whichever button, double-click, taskbar press or window menu
  did it; `desk_task` is a taskbar window button, detail `<window>_front`,
  `_min` or `_restore` (`title` on the title screen); `desk_start_open` is the
  Verticopolis button opening its menu (`title` or `tower`) and `desk_start` a
  pick on it, detail the game menu item it ran (`btn-new`, `mb-import`,
  `btn-help`, `mb-screensaver`, `desk-control-panel`, `btn-settings`,
  `btn-about`, `mb-close`); `desk_tray` is the tray's `display` or `sound`;
  `desk_win_menu_open` is a window menu opening from the `taskbar` or a
  `title_bar`, and `desk_win_menu` its pick, `<window>_<command>`;
  `desk_control` is a Control Panel icon, detail `display`, `sounds` or
  `settings`. The Window menu's picks are `menu_pick` events with `menu`
  `window` and `window_*` item codes. The title screen's own buttons are
  `title_pick` (`src/game/titlePicks.ts`).

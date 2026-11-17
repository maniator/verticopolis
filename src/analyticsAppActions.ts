/* The app-chrome action names, split out of analyticsCore.ts (which
   re-exports them) to keep that file under the line ceiling. */

/** The closed set of app-chrome actions {@link import("./analyticsActions").trackAppAction}
 *  reports. A union (not a bare string) so every call site is checked and the
 *  dashboard's action list is discoverable from one place. */
export type AppActionName =
  // Persistence. The FACT only, never tower contents or the fidelity report.
  | "quick_save"
  // The Auto-save loaded (its row in the Open window; File > Load up to 4.2).
  // 4.2 and earlier also sent save_slot, delete_save, rename_slot and this
  // for the numbered slots; My Towers replaced them (owner, 2026-11-15).
  | "load_slot"
  // A File key that ran its command (version 4.1): `detail` is `open`
  // (Ctrl+O), `save` (Ctrl+S) or `save_as` (Ctrl+Shift+S). Keys are not
  // menu trips, so they never send a menu_pick.
  | "file_key"
  // My Towers, the Open and Save As windows (owner, 2026-11-15). Codes and
  // counts only, never a file's name; each `detail` is in the data map's
  // "My Towers" section (docs/analytics-data-map.md).
  | "files_open" | "file_open" | "file_save" | "file_add" | "file_dropped"
  | "file_rename" | "file_copy" | "file_delete" | "file_failed"
  | "files_copied" | "files_waited" | "file_ask"
  // The tower left behind by a swap, kept in My Towers (owner, 2026-11-16).
  | "tower_kept"
  // A tower given its own file, or its file caught up at boot (#2380), and
  // the Previous versions… window and its opens.
  | "tower_file" | "file_versions"
  // The Open and Save As windows' right-click menu opened: a right-click
  // (`pointer`), a finger held on a row (`hold`), or a key (`key`).
  | "file_menu"
  // File > Open Recent found the file it named gone at its pick
  // (2026-11-16): `towers` (My Towers) or `folder` (the linked folder).
  | "recent_missing"
  // The folder linked on the player's computer (owner, 2026-11-15), in the
  // data map's "Linked folder" section. Codes only, never a name.
  | "folder_link" | "folder_allow" | "folder_unlink" | "folder_open"
  | "folder_save" | "folder_copy" | "folder_failed" | "folder_mirror"
  | "export_save"
  | "import_save"
  | "export_tdt"
  | "import_tdt"
  // Persistence FAILURES (the 3.0 reliability gate, #1533). `autosave_failed`
  // is latched once per page life (a full disk fails every 30 s tick), with
  // `detail` `timer` (every non-interactive save) or `manual` (Quick Save and
  // slot saves). `load_failed` is a slot or title-screen load that adopted nothing (an empty or unreadable
  // slot; the two read alike). `import_failed` is a refused or unreadable file,
  // `detail` `save` (.vctower) or `tdt` (.TDT). The fact only: never the
  // message, the file name or any tower content.
  // `export_failed` is an export that wrote no file: the engine threw (a
  // memory failure on a huge tower) or refused (#1655), `detail` `save`
  // (.vctower) or `tdt` (.TDT). A download the browser blocks is not seen.
  | "autosave_failed"
  | "load_failed"
  | "import_failed"
  | "export_failed"
  // A lost WebGL context the game rebuilt in place (2026-11-16): `detail`
  // `game` (mid-game) or `title` (behind the title screen). A failed or
  // repeat loss is the `crash` event instead.
  | "graphics_recovered"
  // Dialogs / navigation.
  | "settings_open"
  // The manual opened in a new tab; `detail` = where (src/ui/fromGame.ts
  // GameHelpSource): `game_menu` (Help > Player's Manual) or `title` (How to Play).
  | "help_open"
  // A problem line's Help link (#2036), or F1 on the room card; `detail` is
  // the surface and the topic, `inspector_parking` or `stats_recycling`
  // (src/ui/helpTopics.ts names the topics).
  | "help_topic_open"
  // The game panel's About…, which opens About this game (the version, the
  // engine diagnostics, the privacy link); help_open is the manual itself.
  | "about_open"
  | "compare_open"
  | "stats_open"
  | "replay_onboarding"
  | "page_help"
  | "page_gallery"
  | "page_changelog"
  // One help page view on every page (help-site/src/components/Header.astro);
  // `detail` = its path under the site's base ("rooms/hotels", "home" or
  // "other": site.mjs helpPageDetail). page_help/page_changelog count landings,
  // `detail` = where the visit started (src/ui/fromGame.ts HelpSource: a place
  // in the game, `game` or `direct`; #2037).
  | "help_page_view"
  // A press on the Help bar of a page the game opened (#2035, HelpBar.astro);
  // `detail` = run (Keep my tower running), pause (Pause it) or back.
  | "help_bar_pick"
  // A help site menu bar pick; `detail` = its data-help-item code (MenuBar.astro).
  | "help_menu_pick"
  // The 404 page (src/notFoundPage.ts): a view (detail game or help) and a pick (its NotFoundPick).
  | "not_found_view"
  | "not_found_pick"
  // Preference toggles (detail carries the new on/off state).
  | "mute"
  | "reduced_motion"
  | "steady_clock"
  // Modern's "Bridge floors between rooms", detail on/off: found_bridged is the
  // box at a Modern founding (unticked by default), auto_bridge the Settings switch.
  | "found_bridged"
  | "auto_bridge"
  // The Sky Bridge tool laid a bridge (Modern, 2026-11-16): detail `new`, or
  // `finish` for the rest of a half bridge from a save made before the tool.
  | "sky_bridge"
  // The star-up message box opened, detail the mode and the rating it
  // announces, such as `modern-3`.
  | "star_notice"
  // Coarse engagement bit, latched once per session via `trackAppActionOnce`:
  // `volume` = the player touched the audio sliders (latched so the pointer-move
  // slider cannot flood; no value, just the fact). (Deliberately NOT tracked, per
  // the design party: undo, redo, overlay, and rename, the last because the tower
  // name is player-authored. `speed` is deferred: its only clean user-only site,
  // the speed button handler, sits in a file at the line-size ceiling, and the
  // command callback it would otherwise hook is also the dialog pause path.)
  | "volume"
  // The app was installed (the `appinstalled` event, however it was triggered:
  // our in-game offer or the browser's own menu). Latched once per session; the
  // `display` common prop already carries standalone-vs-browser reach.
  | "install_app"
  // The player tapped an install affordance (SPEC-pwa-install CAP-4). `detail`
  // carries which surface: `splash`, `chip`, or `menu`. NOT latched: an install
  // tap is a deliberate, low-volume action, so the raw per-surface count is the
  // signal, and it is the engagement half of the funnel that `install_app` (the
  // completion) cannot attribute (the OS `appinstalled` event names no surface).
  | "install_offer"
  // A tap on a Sponsor link (the GitHub Sponsors tip jar). `detail` carries
  // which surface: `splash` (the title screen's corner link), `menu` (the
  // game's Help menu) or `help` (any help site link to the Sponsors page). NOT latched, like install_offer. It
  // counts the tap only; whether anyone went on to sponsor is never known here.
  | "sponsor_click"
  // The version 4 windows and cards (owner, 2026-11-14, with the menu events).
  // `window_close` is a player's press on a Tower Info, Bulletin or Map
  // window's ✕, `detail` `tower`, `bulletin` or `map`; `window_move` is the
  // first drag of a window this page life (latched per window), `detail`
  // `tower`, `bulletin`, `map` (off the desk), `dialog` or `card`. `welcome_shown` is the welcome window opening;
  // `welcome_close` is how it went, `detail` `ok`, `x`, `escape`, `backdrop`
  // or `displaced` (another dialog took its place); `welcome_link` is one of
  // its help links, `detail` `first_tower`, `modes` or `whats_new`.
  | "window_close"
  | "window_move"
  // The player scrolled the Bulletin down to older lines, latched once per
  // page life (src/ui/bulletinReadBack.ts). No detail.
  | "bulletin_read_back"
  | "welcome_shown"
  | "welcome_close"
  | "welcome_link"
  // The screen saver (party 2026-11-15). `screensaver_start` is one coming
  // up, `detail` `idle` (the paused tower sat untouched for the wait),
  // `return` (the player came back to the tab after the wait) or `preview`
  // (the dialog's Preview). `screensaver_end` is it ending, `detail` how long
  // it was up: `under_1m`, `1_5m` or `over_5m`. `screensaver_set` is the
  // dialog's OK, `detail` the saver picked (`night`, `stars`, `express`,
  // `endless`, `marquee`) or `none`.
  | "screensaver_start"
  | "screensaver_end"
  | "screensaver_set"
  // The 1994 desk on a computer; names and details in docs/ui/desk-windows.md
  // (src/ui/desk/deskAnalytics.ts holds the codes).
  | "desk_shown"
  | "desk_title_shown"
  | "desk_window"
  | "desk_start"
  | "desk_start_open"
  | "desk_task"
  | "desk_tray"
  | "desk_win_menu"
  | "desk_win_menu_open"
  | "desk_control"
  // A press on a title-screen button (src/game/titlePicks.ts): `detail`
  // `continue`, `open`, `new`, `help`, `mute`, `install` or `sponsor`.
  | "title_pick"
  // The manual's Play and Back to game links (help-site Header.astro):
  // `detail` `<where>_<what>`, where `bar` (the title bar) or `front` (the
  // front page), what `play` or `back`.
  | "help_game_link"
  // A drag's release said why it stopped (src/game/dragRefusal.ts, #1847,
  // #2046): `detail` `extend` (an elevator's arrow) or `bulldoze`.
  | "drag_stopped";

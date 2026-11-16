# Analytics data map

Every event the game sends, what it carries, why it is collected, and how long
it is kept. A new event or field lands here in the same change that adds it to
the vocabulary (`GameplayEvents` in `src/analyticsCore.ts`), before it ships to
production. `src/analyticsDataMap.test.ts` fails when an event in the vocabulary
has no row in the Events table, when an `engine_status` field or code is
missing from its entry or listed there without the game sending it, and when
the limits below drift from the code.

The player-facing summary of this posture is the Help site's Privacy page
(`help-site/src/content/docs/privacy.md`, which About this game links to,
drafted in
`_bmad-output/specs/spec-analytics-posthog-migration/transparency-note.md`).
Anything here that would make that copy untrue changes the copy in the same
change. Every claim on that page is an identity claim, on purpose: the
session-scoped id and the on-device returning bucket are kept, and what the
page promises is that none of it identifies the player or links one visit to
the next. Keep any edit on that side of the line.

What each measure can and cannot tell us, and which ones are not measurable
under this posture, is in
[`analytics-measurement-status.md`](./analytics-measurement-status.md).

## Posture

- **Cookieless and personless.** The game posts each event to its own relay
  (`/api/ingest`, `src/analyticsIngest.ts`), which forwards it to PostHog with
  `$process_person_profile: false`. No cookie is set and no person profile
  exists.
- **The session id is per tab.** `distinct_id` is a random id kept in
  `sessionStorage` (`src/analyticsRelay.ts`). It survives a same-tab reload, so
  one session can span several page lives, and it dies with the tab. Nothing
  links one visit to the next.
- **No IP.** The relay uses the client IP only as its rate-limit key, never logs
  or forwards it, and sets `$geoip_disable: true`.
- **Production is separate.** The relay stamps `environment` from the
  deployment (`production`, `preview`, or `development` under `vercel dev`;
  `unknown` when it has none); every governed number filters on `production`.
- **Host gated.** Nothing is sent from localhost, the e2e preview server or any
  host outside `telemetryHostAllowed` (`src/telemetry.ts`).
- **Bounded.** The relay caps bodies at 8 KiB and each IP at 100 posts a minute.
  Repeating client events are capped: `crash` and `$exception` per page life,
  `engine_status` per page life as its section below sets out, and
  `economy_action`'s `demolish` at 40 a minute (its `price_tune` and
  `capacity_tune` are latched once a session).

## Fields on every event

| Field | Values | Set by | Why |
| --- | --- | --- | --- |
| `distinct_id` | random per-tab session id | relay | Counts sessions (never people) |
| `environment` | `production`, `preview`, `development`, `unknown` | relay | Keeps preview and local traffic out of production numbers |
| `$process_person_profile` | `false` | relay | No person profile |
| `$geoip_disable` | `true` | relay | No location from the relay's own IP |
| `version` | the build's `package.json` version | client | Ties every event to the build that sent it |
| `platform`, `distribution_channel` | closed label set (`INGEST_PLATFORM_LABELS`) | client, checked by the relay | Which surface the game runs on |
| `returning` | boolean | client | Coarse on-device returning signal |
| `tenure`, `recency` | coarse buckets | client | How established the tower is, how long since the last save |
| `display` | `standalone`, `browser` | client | Installed app or browser tab |

The last five arrive with the boot enrichment (`src/analyticsEnrichment.ts`);
an event sent before boot carries `version` only.

## Events

| Event | Fields | When | Why |
| --- | --- | --- | --- |
| `new_game_started` | `mode` | A tower is founded | Funnel entry: new towers |
| `first_build` | `tool` | First facility in a tower | Funnel: did they build anything |
| `tool_used` | `tool` | First use of each tool in a session | Tool mix |
| `star_reached` | `star` | Each star rung crossed | Progression depth |
| `milestone_reached` | `id` | An optional milestone is achieved (from the engine's event) | Which goals players reach, beyond stars |
| `session_end` | `seconds`, `final` | Every tab hide and page hide | Session length, read only through the `session_lengths` view |
| `boot` | `reason`, `version`, `mode`, `star`, `floors`, `population` | Once per page life | Why a session started and the tower it opened |
| `crash` | `kind`, `repeat`, `recoveryFailed`, `saveFlushed`, `behindSplash`, `version`, `star`, `population` | A crash screen | Crash reliability |
| `update` | `from`, `to` | The player applies an update | Update adoption |
| `tool_session_uses` | `tool`, `uses` | Session end, per tool used | Per-tool depth |
| `session_builds` | `builds` | Session end | Build volume |
| `session_peak_floors` | `floors` | Session end | Height reached |
| `session_fps` | `p50`, `low`, `samples` | Session end | Frame rate |
| `app_action` | `action`, `detail` | An app-chrome action | Which saves, dialogs and settings get used, and whether saves, loads and imports fail (see below) |
| `economy_action` | `action`, `detail` | Demolish, price or capacity tuning, or a Modern exterminator booking (`exterminator`, `detail` `menu` or `stats`, since 4.3) | The removal and tuning side of play, and which surface books the exterminator |
| `menu_open` | `menu`, `via`, `screen` | A trip into the menu bar begins (owner, 2026-11-14) | Which menus players open, and how (see below) |
| `menu_pick` | `menu`, `item`, `via`, `screen`, `browsed`, `after`, `grayed`, `state` | A menu item is clicked or chosen from the keyboard, grayed items included | Which commands players use from the menus, in what order, and what they look for that is grayed (see below) |
| `menu_dismiss` | `menu`, `how`, `screen`, `browsed` | A trip into the menus ends with no pick | Where players look and give up (see below) |
| `emergency_choice` | `kind`, `decision` | An answered emergency prompt | Accept and decline split |
| `bomb_outcome` | `outcome` | A bomb threat ends: `paid`, `found` or `exploded` | How bomb threats end, and whether Security wins the race |
| `session_emergencies` | `fires`, `firesGutRooms`, `bombs` | Session end | How often emergencies happen |
| `session_crashes` | `crashes` | Terminal page hide, only when a crash screen showed (approved 2026-11-03, #841) | How many crash screens a page life showed, which the capped `crash` rows cannot say |
| `file_imported` | `format`, `mode`, `star`, `population` | A `.vctower` or `.TDT` import finished and its tower is open (approved 2026-11-13) | Whether imports succeed, per format; `import_failed` (below) counts the refusals |
| `file_exported` | `format`, `mode`, `star`, `population` | A `.vctower` or `.TDT` download was handed to the browser (approved 2026-11-13) | Whether exports succeed, per format; `export_failed` (below) counts the refusals |
| `tdt_import_read` | `star`, `floors`, `basements`, `rooms`, `shafts`, `flights`, `decoded`, `hasRoster`, `notes`, `anomalies`, and one count per importer workaround (`unknown`, `droppedFloors`, `offLot`, `overlapping`, `misplaced`, `clamped`, `widthMismatch`, `asleepConverted`, `droppedShafts`, `adjustedShafts`, `droppedFlights`) | A 1994 `.TDT` read cleanly and its import report is on screen (approved 2026-11-13). A report that waits behind another dialog is counted when it opens, and not at all if it is dropped first | What old towers hold that the importer has to work around. Counts and flags only: the tower name and the report's note text are never sent |
| `$pageview` | `$referring_domain`, `$pathname`, `utm_source`, `utm_medium`, `utm_campaign` | Once per page life, with `boot` (approved 2026-11-13) | Where players come from (a launch post, a search, a direct visit), read beside what they did. Only the referrer's host travels, never its path or query; an IP address or local machine name goes as `$other`, a landing path outside the game's own as `/other`, and a UTM value only as a short plain token. A lower bound on visits: a page that never reaches boot (no WebGL, a failed engine start, an early close) sends none, so it reads below Vercel's count. It carries no `$session_id`, so PostHog's web analytics session and channel views stay empty; trend breakdowns work |
| `engine_status` | see below | See below | Engine reliability for the 3.0 release |

The fields of each event are documented where they are declared
(`GameplayEvents` in `src/analyticsCore.ts`). `session_end` re-fires on every
tab hide, so never count its rows; the dashboard's `session_lengths` view is
the governed read.

Outside the typed vocabulary:

- **`$exception`** (`src/analyticsErrors.ts`): an uncaught error or rejection,
  with its type, message, a fingerprint and a raw stack clamped to 2,000
  characters, at most 10 a page life. This is the one place a player's own words
  can travel: an error message can quote game text such as a tower name. The
  Help copy says so.
- **Vercel page-view counts and Speed Insights** (`src/telemetry.ts`): anonymous
  page visits and page performance metrics, on the same host gate.

## Persistence failure actions

Four `app_action` codes report a save, load, import or export that failed (#1533 and #1655, approved 2026-11-03). Each is the fact only, never a message, file name or tower content.

| `action` | `detail` | When | Reading |
| --- | --- | --- | --- |
| `autosave_failed` | `timer` or `manual` | A background or system save (`timer`: the timer and tower-swap autosaves, the pre-update flush, the context-loss flush and the .TDT adoption flush) or a Quick Save or slot save (`manual`) threw, such as a full or blocked `localStorage` | Latched once per page life, so events can exceed sessions; read sessions with a failed save, not failures. The `detail` is the first source that failed |
| `load_failed` | none | A slot load from the saves manager or the title-screen picker adopted nothing | An empty slot and an unreadable one read alike. Quick Load ("No saved tower found") is not counted |
| `import_failed` | `save` (.vctower) or `tdt` (.TDT) | An imported file was refused or unreadable | Counted per attempt |
| `export_failed` | `save` (.vctower) or `tdt` (.TDT) | An export wrote no file: the engine threw (a memory failure on a huge tower) or refused (a Modern tower cannot become a `.TDT`) | Counted per attempt. A download the browser blocks is not seen |

These are lower bounds like every client event: a failure that kills the tab, or
a blocked relay, reports nothing. `docs/analytics-measurement-status.md` rows 8
to 10 and 24 say what they can and cannot support.

## Graphics recovery

One `app_action` counts the WebGL losses the game survived (2026-11-16). The fact and where it happened only.

| `action` | `detail` | When | Reading |
| --- | --- | --- | --- |
| `graphics_recovered` | `game` or `title` | The device dropped the game's WebGL graphics and the game rebuilt them in place, mid-game (`game`) or behind the title screen (`title`) | Counted per recovery, a lower bound like every client event. Read it beside `crash` with `repeat` false (a first loss that ended on the crash screen). `crash` is deduped per page life on its flag set, so do not add the two as a count of first losses |

## My Towers (Open, Save As, Load)

Version 4.3 replaced Saved Towers… and its three numbered slots with My Towers,
a folder of tower files kept on the device (owner, 2026-11-15). Each event is
an `app_action` with a code, or a count, in `detail`. A file's name is the
player's own text and is never sent, and neither is a tower's contents.

| `action` | `detail` | When |
| --- | --- | --- |
| `files_open` | `open`, `open_key`, `open_title` or `save_as` | The Open or Save As window opened. Open says where the player asked: `open` for File > Open… in the menu, `open_key` for its Ctrl+O key, and `open_title` for the title screen's Open Tower… button (called Load Tower up to 4.2). `save_as` is File > Save As… |
| `files_waited` | `open` or `save_as` | That window opened while My Towers was still getting ready (its first open on the device, or the old slots still copying in); it said "Opening My Towers…" and filled in once ready. Before 4.3 shipped, File > Open… showed the device's file picker at that moment |
| `file_open` | `tower`, `tdt` or `auto` | A row opened: a tower file, a 1994 `.TDT` file, or the Auto-save |
| `file_save` | `new`, `replace` or `current` | The tower written into My Towers: under a new name, over a file the player agreed to replace, or into the live tower's own file by File > Save |
| `file_add` | `picked`, `drop` or `folder` | A file added to My Towers: `picked` once a file opened from the device has loaded, `drop` for a file dropped onto the Open or Save As window, `folder` for each tower file From a folder… copied in (from 4.4) |
| `file_dropped` | none | A file dropped on the game itself, to open as a picked file does |
| `file_rename` | none | A file renamed |
| `file_copy` | none | A file duplicated (Duplicate, or Copy then Paste) |
| `file_delete` | none | A file deleted |
| `file_ask` | `replace` or `delete` | The window asked in its message box before replacing or deleting a file. A Yes (Replace) goes on to `file_save` `replace` or `file_delete`; from 4.4 the replace box also offers the next numbered name ("Sky (2)"), which goes on to `file_save` `new`. So the asks a player declined are the asks less all three |
| `file_failed` | `full` or `error` | A write to My Towers refused: the device is out of room, or another error |
| `files_copied` | a count | Once per device: the old save slots copied into My Towers, and how many |

`load_slot` still counts the Auto-save loading as the live tower (its row in
the Open window; File > Load in 4.1 and 4.2), and `load_failed` a load that
failed. Up to
4.2 the slots sent `save_slot`, `delete_save`, `rename_slot`, `saves_open`
(the Saved Towers window) and `splash_load_open` (the title screen's picker);
no build from 4.3 sends them, so a series that reads them stops there. A
`file_open` is not also an `import_save` or `import_tdt`: those still count
files picked from the device. A tower that opens sends `file_imported` either
way.

### Linked folder

The Open and Save As windows can also use a folder the player links on their
computer, in Chromium browsers (`docs/architecture/linked-folder.md`). Each
event is an `app_action` with a code in `detail`. A folder's name and a file's
name are the player's own text and are never sent.

| `action` | `detail` | When |
| --- | --- | --- |
| `folder_link` | `linked`, `cancel` or `refused` | The player chose Link a folder…: a folder linked, the picker closed without one, or the browser refused it |
| `folder_allow` | `granted` or `denied` | The player clicked Allow access… (or File > Save needed the OK again) and the browser answered |
| `folder_unlink` | none | The folder unlinked. Its files stay on disk |
| `folder_open` | `tower` or `tdt` | A file in the folder opened: a tower file or a 1994 `.TDT` file. It is not also a `file_open` or an `import_save`/`import_tdt` |
| `folder_save` | `new`, `replace` or `current` | The tower written into the folder: under a new name, over a tower file the player agreed to replace, or into the live tower's own file by File > Save |
| `folder_copy` | none | A file in the folder duplicated |
| `folder_failed` | none | A folder step failed: the browser refused access, the disk was full, a name was taken, or another error |

There is no `folder_delete` or `folder_rename`: the game never deletes or
renames a file on the player's computer (owner, 2026-11-15).

`app_action` `file_key` counts a File key that ran its command (version 4.1): `detail` is `open` (Ctrl+O, or Cmd+O on a Mac), `save` (Ctrl+S) or `save_as` (Ctrl+Shift+S). A key pressed in a text box, over a dialog, after the engine stopped, as a held key's repeat, or for a save on the title screen runs nothing and sends nothing. Its command's own event follows (`quick_save`, `files_open` and the rest), so a command's total stays the command's own event; `file_key` says how many of them came from the keys.

## Sponsor link taps

`app_action` `sponsor_click` counts a tap on a link to the GitHub Sponsors page (owner, 2026-11-14). `detail` is `splash` for the title screen's corner link, `menu` for the menu bar's Help > Sponsor Verticopolis, or `help` for any help site link to that page (the sidebar's "Sponsor Verticopolis" entry and the front page's text). It is the tap only: whether anyone went on to sponsor is never known here, and the Android app shows no Sponsor link. It is not latched, so read taps, or sessions that tapped, and say which. A click, keyboard Enter or middle-click counts; a link opened from the right-click menu does not. The "Sponsor link taps" dashboard tile splits it by `detail`.

## Page not found

The "page not found" page (`src/404.html`) reports two `app_action` codes, so a broken link people follow shows up beside the pages that work. Neither carries the missing address: a mistyped path can hold anything a person typed or pasted.

| `action` | `detail` | When |
| --- | --- | --- |
| `not_found_view` | `game` or `help` | The page opened for a missing address on the game's site or the manual's (help.verticopolis.com, or /help on a build that serves the manual there) |
| `not_found_pick` | `game`, `manual`, `changelog`, `rooms`, `close` or `taskbar` | One of its buttons (Play the game, Player's Manual, Release notes, Every room), the window's close box, or the taskbar's Verticopolis button. A click, keyboard Enter or middle-click counts; a link opened from the right-click menu does not |

The "Page not found" dashboard tile splits both by `detail`. Read picks against views for the share of lost visitors who went on.

## The menu bar

Three events follow the version 4 menu bar (owner, 2026-11-14), from
`src/analyticsMenus.ts`. A trip into the menus is the time from a menu opening
with none open until the menus close. Each trip sends one `menu_open`, then one
`menu_pick` or one `menu_dismiss`; pointing from menu to menu inside a trip
sends nothing and is counted in `browsed` instead. A grayed item's click sends
a `menu_pick` with `grayed: true` and the trip goes on, so a trip can carry
more than one pick row. Every value is a code from a closed list: never an
item's label, and never anything the player typed (Rename reports the pick,
never the name).

| Field | Values | Meaning |
| --- | --- | --- |
| `menu` | `file`, `edit`, `tower`, `window` (up to 4.2, and the 1994 desk's own Window menu after it), `options`, `help` | The menu opened, picked from, or open when the trip ended |
| `via` (open) | `click`, `keys`, `alt` | A click on a title, the keyboard on a focused title, or Alt with the underlined letter |
| `via` (pick) | `pointer`, `keys` | A mouse, pen or finger, or the keyboard |
| `screen` | `title`, `tower` | Over the title screen, or over a tower |
| `item` | `new_tower`, `quick_save`, `close`, `import`, `export`, `install_app`, `undo`, `redo`, `tower_info`, `map`, `statistics`, `rename`, `fire_rescue`, `exterminator`, `rules`, `tools`, `bulletin`, `status_bar`, `full_screen`, `settings`, `sound`, `screen_saver`, `manual`, `compare`, `replay`, `sponsor`, `about`, `window_tools`, `window_info`, `window_map`, `window_bulletin`, `window_tower_info`, `other` | The item, by a code that does not change with its label (`MENU_ITEM_CODES`) |
| `browsed` | a count | Menus the trip showed, the last one included |
| `after` | an `item` code or `none` | The page life's previous real pick, so a breakdown shows what follows what without a paths query. A grayed click never becomes the next pick's `after` |
| `grayed` | `true`, `false` | The item was grayed out, so nothing happened |
| `state` | `on`, `off` | A checkmark item's new state (Tower Info, Map, Tools, Bulletin, Status Bar, Full Screen, Sound); absent on the others and on a grayed click |
| `how` | `outside`, `escape`, `tab`, `title`, `blur` | How a trip ended with no pick: a press outside the menus, Escape, Tab, the open menu's own title, or the window losing focus |

The 1994 desk (owner, 2026-11-15) has a Window menu of its own, with
`window_*` codes so its picks never mix with the Tower and Options items of
the same windows; on the desk, Status Bar and Full Screen move into it and keep
their codes, with `menu` reading `window`.

Version 4.3 removed the Window menu (party and owner, 2026-11-15): Bulletin
moved to Tower, and Tools, Status Bar and Full Screen to Options. They kept
their codes, so their `menu` changes from that version on while `item` runs
on: count `bulletin`, `tools`, `status_bar` and `full_screen` by `item` across
the move, and expect no new `menu: window` rows. It also took Edit and Tower,
and File's Save, Save As and Close, Options' Tools and Status Bar and Help's
Replay, off the title screen, so `screen: title` rows for those end there.

Options > Full Screen is left out of the installed app on a phone (owner,
2026-11-15; `src/game/fullScreenItem.ts`). The common `display` property
(`standalone` or `browser`) already rides on every `menu_pick`, so the
"Menu bar: Full Screen by display mode" tile splits `full_screen` picks by it
and by `state`: from the release that carries the change, rows from phones in
`standalone` stop, while tablets, computers and browser tabs run on. No new
event or field was added.

Version 4.1 renamed the File items and kept their codes, so a series runs on
across the rename: `import` is Open…, `export` is Save As…, `quick_save` is
Save, and `saves` was Saved Towers… (gone in 4.3). File > Load (4.1 and 4.2)
sent `load_auto` and `load_slot_1` to `load_slot_3`; 4.3 removed it, and the
Auto-save and every tower open from the Open window (`files_open`,
`file_open`, `load_slot`). The File
keys are not menu trips, so they send no `menu_pick` and the menu funnels count
menus only: a key that ran sends `app_action` `file_key` (below), and the
command then sends its own event as from the menu.

The commands keep their own events too, so Settings from the menu sends
`menu_pick` `settings` and then `app_action` `settings_open`. Count the menu's
share of a command from `menu_pick`, and the command's total from its own event.
A funnel reads `menu_open` to `menu_pick`, and PostHog's paths read the order
of picks within a session; the "Menu bar" dashboard tiles are both
(`scripts/posthog-dashboard.mjs`).

The windows and cards that came with the menu bar report through `app_action`:

| `action` | `detail` | When |
| --- | --- | --- |
| `window_close` | `tower` or `bulletin` | The Tower Info or Bulletin window's ✕ (the menus' own toggles are `menu_pick` rows) |
| `window_move` | `tower` or `bulletin` | The first drag of that window in a page life (latched per window) |
| `welcome_shown` | none | The welcome window opened |
| `welcome_close` | `ok`, `x`, `escape`, `backdrop` or `displaced` | How it went: its OK, its ✕, Escape, a click beside it, or another dialog taking its place. A page closed while it is up sends none |
| `welcome_link` | `first_tower`, `modes` or `whats_new` | One of its help links |
| `screensaver_start` | `idle`, `return` or `preview` | The screen saver came up: the paused tower sat untouched for the wait, the player came back to the tab after the wait, or the dialog's Preview |
| `screensaver_end` | `under_1m`, `1_5m` or `over_5m` | The screen saver ended, with how long it was up as a bucket |
| `screensaver_set` | `night`, `stars`, `express`, `endless`, `marquee` or `none` | The Screen Saver dialog's OK, with the saver picked |
| `desk_shown` | none | The 1994 desk came up on a computer (once per page life) |
| `desk_window` | `<window>_<verb>`: windows `tower`, `info`, `tools`, `map`, `bulletin`, `tower_info`, `control_panel`; verbs `min`, `restore`, `max`, `unmax`, `resize`, `move` | A desk window's title-bar button or size grip, or its first move in a page life (`docs/ui/desk-windows.md`) |
| `desk_start` | the menu item it ran (`btn-new`, `mb-import`, `btn-help`, `mb-screensaver`, `desk-control-panel`, `btn-settings`, `btn-about`, `mb-close`) | A pick on the taskbar's Verticopolis menu |
| `desk_control` | `display`, `sounds` or `settings` | A Control Panel icon (the Screen Saver dialog, sound on or off, or Settings) |

## `engine_status`

The reliability instrument for the 3.0 web release (release plan section 4.1,
step A1, in PR #1080; issue #1081). Code: `src/analyticsEngineStatus.ts`. Governed
definition: `scripts/engine-reliability.mjs`, pinned by
`src/engine-reliability.test.ts`.

**Why it is collected.** The #945 Reliability gate needs the share of engine
sessions that fell back to TypeScript (or stopped), counted by reason and by
build, with a confidence bound. Nothing else the game sends can tell a fallback
from a clean run. It also records when the engine save writer turns itself off,
the one silent failure the save path has.

**When rows go out.** One `settle` row per page life once boot has picked its
engine, sent before the boot's later steps so a throw in one of them cannot
lose it. A boot that throws before the game exists ran no engine and sends no
row; `$exception` reports it. Then one row for each later fallback or writer
latch-off. Past 10 such rows a page life drops repeats: the first row of a
reason it has not sent yet and the latch-off row still go out, so at most one
more row per code. When the cap drops a row, the next tab hide or page hide
sends a `summary` row with the true count, so a capped loop keeps its size
(the #841 lesson); `summary` rows are outside the cap, at most one a hide and
only after a drop. A reload is a new page life with its own `settle` row.

**What it never carries.** No error message, stack, tower name, path or URL.
Every value below is a code from a closed list in the code; the messages stay on
the device's console and on `window.__vcEngineBoot`, and the emitter is never
handed one. (A boot that throws still reaches `$exception`, as any uncaught
error does; see above.)

| Field | Values | Meaning |
| --- | --- | --- |
| `trigger` | `attempt`, `settle`, `fallback`, `crash-reload`, `writer-latch`, `summary`, `engaged` | Why this row was sent. `attempt` (#1090) goes once per page life when boot has chosen the engine, before the package loads, so a tab that closes or crashes during the load is still counted; it carries the settle row's fields as they stand then. `engaged` (#1090) goes once per page life at the first engagement (the running engine accepts a player's gameplay command, or 30 s of foreground play pass with the splash and dialogs closed and the game clock moving in every counted second) and names the engine running then. Neither counts toward the cap. `crash-reload` is a running Rust engine that trapped, sent just before the page reloads from its last autosave (#1422); it keeps the `engine` that crashed and counts as that page life's fallback |
| `engine_requested` | `ts`, `wasm`, `wasm-frame`, `wasm-worker` | The engine the page life asked for. A wasm-only build, which every deploy is, always sends `wasm`, whatever the URL says. The other values come from dev serves and tooling builds, and from rows sent before the Rust engine became the only engine. |
| `engine` | `ts`, `wasm`, `wasm-frame`, `wasm-worker`, `ts-fallback`, `none` | What runs when the row is sent. `ts-fallback` is a switchable build back on TypeScript (old rows and tooling builds only); `none` is a wasm-only build that stopped. After a fallback it stays `ts-fallback` for the rest of the page life. After a running engine's fault (#874) that is exact, since no later tower is hosted; after a refused tower the host can take a later one again, and no row reports that. |
| `build` | `switchable`, `wasm-only` | The bundle kind (`src/build/engineBundle.ts`) |
| `fallback_reason` | `none`, `boot-timeout`, `boot-error`, `package-mismatch`, `unverifiable`, `attach-refused`, `trap-command`, `trap-tick`, `trap-undo`, `trap-save`, `trap-census`, `other` | The latest fallback's reason. `package-mismatch` is a package this shell cannot use (engine files that are not the package this shell was built with, which the page's byte check refuses (#985), missing exports, a link error, a catalog of another version or one this build cannot draw, or, in a wasm-only build, no save writer), which is the deploy race (#1046), and sits outside the rate. (After the byte check has passed, a link error or a missing export is a broken build, not a mixed deploy, but it keeps this code for now.) `unverifiable` is a browser that cannot hash the engine files (an insecure context, a disabled `crypto.subtle`, or a digest call that failed), so the page refuses to run them (#985): the files may be fine, so it sits outside the rate, on its own line, like `package-mismatch`. `boot-error` also covers engine files that did not arrive whole. `attach-refused` is a tower the host would not take, including an engine that could not hand over its catalog. `other` is a boot step outside the engine that failed after the worker host started, or, on a running engine, a save or the reads when a tower is let go. The first three `trap-*` codes are a running engine's fault on the main-thread host (#874): a command (the undo capture's save just before an edit included), a tick, a frame sync or the per-frame event drain, and anything during an undo or redo. `trap-save` is a trap in the engine's save writer (#1205), such as the autosave a tab hide runs, and `trap-census` one in the slot census that reads a save's population (#1612). Builds that predate these two codes sent both as `trap-tick`. |
| `fallback_stage` | `none`, `load`, `start`, `adopt`, `undo` | Where the latest fallback happened: loading the package, the first tower (or a boot step just after it, for `other`), a later tower (a load or new game) or an undo or redo step (or a tooling restore). For a running engine's fault, how the faulted tower was hosted |
| `fallbacks` | integer | The running count for this page life. A reader takes its highest value per `page_life`, never the row count. |
| `writer_latched` | boolean | The engine save writer turned itself off this page life (also `writerLatched` on `window.__vcEngineBoot`). A running engine's fault (#874) also turns the writer off, and is reported as that fallback rather than here |
| `page_life` | random id | Minted in memory at the page life's first row and never stored, so a reload gets a new one. It only groups rows from one page life; it cannot link a page life to anything else. |
| `version` | the build's version | Which release sent the row |
| `sha` | the build's short commit (`__APP_SHA__`) | Which exact build, so two deploys of one version stay apart |
| `engaged_by` | `command`, `play` | Only on `engaged` rows: which branch engaged the page life. Absent reads as `none` |
| `trap_kind` | `none`, `unreachable`, `out-of-bounds`, `stack-overflow`, `poisoned`, `other` | Only once a running engine trapped in this page life (approved by Naftali 2026-11-13): what kind of trap it was, read from the error's type and message by `trapKind` in `src/wasmhost/hostFault.ts`, so no message is sent. `unreachable` is a Rust panic or abort, which is also how a failed allocation ends (a browser cannot tell the two apart); `out-of-bounds` a memory access outside the module's memory; `stack-overflow` a stack that ran out; `poisoned` a call on an object an earlier trap left borrowed; `other` any other trap. Absent reads as no trap |

**No longer sent.** The staged engine cohort is gone, since the Rust engine is
the only engine the shipped game runs. Builds before app 2.70.0 also sent
`stage`, `assigned_arm`, `selected_by` and `size_gated`, and the fallback
reasons `unclean-exit` and `marker-blocked`. They are not sent now, and old
rows keep them; the governed definition still reads them, and an absent value
reads as `none`, `default`, false, no attempt row or not engaged.

**Planned, not collected yet.** #954 adds `divergence_reports`, a count of
commands the engine refused after the TypeScript instance accepted them (the
report moved there from #874). It lands in this table, with its reason, in the
change that sends it.

**How it is counted.** Only through `scripts/engine-reliability.mjs`: a window
holds the page lives whose `settle` (or `attempt`) row falls in it; sessions are
distinct `distinct_id`s in production, as in the `session_lengths` view; a page
life carrying a value the game never sends is left out and counted on its own
line. The overall rate counts the sessions with a settled page life that ran the
engine (one whose settle row already fell back on `package-mismatch` or
`unverifiable` alone did not); a session is a fault when any of those page lives
fell back for a reason other than those two, each of which is reported on its
own line. Rows from the retired cohort are read as they were sent: overrides and
the `unassigned` arm are left out unless asked for, and safety-suppressed page
lives (which ran TypeScript) are always left out and counted on their own line.
The bound is the exact one-sided 95% Clopper-Pearson bound, by build and by arm
as well. That rate is early telemetry. The fault count is a lower bound and the rate is
observed and coverage-limited, with unknown bias, because the relay has no
offline queue and a per-IP limit, a tab closed or crashed while the engine loads
is counted as having left (its `attempt` row is the only one it sent), runtime traps are reported only from
builds that carry #874, and the worker host reports only its first tower. The
script's header comment carries every rule and every gap.

## Retention and deletion

Events live in the PostHog project (US Cloud, project 524085) for as long as the
project's plan retains event data: one year on the free plan and seven years on
paid plans, per PostHog's events retention page as of 2026-10-20
(<https://posthog.com/docs/data/events-retention>). Retention cannot be
shortened to remove data. Nothing is copied
elsewhere apart from the aggregate reports the scripts print.

Because every event is personless, there is no person to delete and no way to
tie an event to a player who asks. To stop collecting a field, remove it from
the code and from this map in one change; old builds keep sending it until they
update. To remove events already stored, use PostHog's data deletion tools
(<https://posthog.com/docs/privacy/data-storage#data-deletion>) or its support,
filtered by event name; otherwise they age out with the plan's retention.

# The Help bar (#2035)

A manual page the game opened (`?from=game`) shows a status bar along its
bottom edge with the tower's date, money, population and stars, and buttons
to keep the tower running, pause it, or go back to it. This page records how
the two tabs talk, and what that depends on.

## The parts

| Part                 | File                                                                     | Runs on                                                  |
| -------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| The words they trade | `src/ui/helpBarProtocol.ts`                                              | both                                                     |
| The game's side      | `src/ui/helpBarHost.ts`, wired by `wireHelpBar` in `src/ui/uiHelp.ts`    | the game's tab                                           |
| The bar              | `src/ui/helpBar.ts`, mounted by `help-site/src/components/HelpBar.astro` | the manual page                                          |
| The bridge page      | `src/help-bridge.html`, `src/helpBridge.ts`                              | a hidden frame of the game's host inside the manual page |

The game and the bar share one `BroadcastChannel` (`vc-help-bar`). Where the
manual is served under `/help` on the game's own host (previews, staging, a
local build), the bar opens the channel itself. In production the manual has
its own host, help.verticopolis.com, and a channel never crosses origins, so
the bar frames `https://verticopolis.com/help-bridge.html`, which relays
messages both ways with `postMessage` and checks each sender's origin and
window.

## The same-site dependency

The bridge works because verticopolis.com and help.verticopolis.com are the
**same site** (one registrable domain). Browsers partition storage and
`BroadcastChannel` for a third-party frame by the top-level site, so a frame
of the game's host inside the manual joins the game tab's own channel only
when both hosts share a site. If the manual ever moves to a domain of its
own, the frame lands in a separate partition, the game never hears the bar,
and the bar simply never shows (nothing breaks, but the feature is gone).

The bridge page sends `Content-Security-Policy: frame-ancestors 'self'
https://help.verticopolis.com` (`vercel.json`), so no other site can frame
it, and the service worker leaves it alone (`navigateFallbackDenylist` and
`globIgnores` in `vite.config.ts`).

## Two towers in two tabs

Each game tab has a random tab id (16 hex digits, never stored) that it sends
with every status. The bar keeps to the first tab that answers and names it
in every later hello, run and pause. A host acts only on a request naming its
own tab, or on a hello that names none, so one press never runs or pauses two
towers, and the other tab stops answering ten seconds after its last hello.
When the chosen tab goes quiet the bar hides and lets go, and the next tab to
answer (the same tower reloaded, for one) takes its place.

## Timing

The bar says hello every 4 seconds. The game answers each hello as it
arrives, then once a second for ten seconds after the last one. The game tab
is out of sight while the player reads, and browsers slow a hidden tab's
timers (to once a minute after a few minutes in Chrome), so the bar cannot
count on the game's own ticks: the answers to hellos keep it fed, and it
waits 9 seconds (two hello gaps and a tick) before it decides the game is
gone.

## Tests

The protocol, the host and the bar are unit tests beside their files, and
`src/tests/integration/helpBar.integration.test.ts` runs the game's side on
the real UI over a real channel. `e2e/helpBar.spec.ts` runs the real game on
`game.test` with a manual page on `help.game.test` in a Chromium that
partitions storage (Playwright turns that off by default), and checks that a
frame of the game's host hears the game and pauses one tower of two. Its
second test puts the manual page on another site and checks it hears
nothing, the case this page warns about above.

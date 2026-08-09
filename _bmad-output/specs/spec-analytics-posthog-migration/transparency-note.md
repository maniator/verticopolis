# Transparency note (player-facing copy)

Spec-authored companion to `SPEC.md`. Ready-to-drop copy for the "what we measure and why" line that ships with the migration (Help or Settings). Plain, human, American English, no em-dashes. The claim must stay true to the SPEC and `reverse-proxy.md`: only anonymous, low-cardinality counts leave the device, with no cookie and no cross-session identifier.

**Updated 2026-08-07 for the desktop build (issue #781).** Two claims below were true of the web edition only and are gone: that the counts travel "through our own site" (a same-origin phrasing that a packaged app posting across the internet does not keep), and that there is no consent banner "because there is nothing here to consent to" (one edition now asks). The crash-report caveat was also promoted out of a subordinate clause: it is the one place a player's own words can travel, so it says so on its own.

**Corrected 2026-08-08 in review.** Every anonymity line here is an IDENTITY claim, and two of them had slipped into being data claims. The desktop notice said "nothing carries over from one visit to the next" and the Help paragraph said there is no browser consent banner "because nothing is kept about you to consent to". Both are false as written: `returning`, `recency`, and `tenure` ride on every event and are derived from on-device state that outlives a visit, and the session id and returning bucket described in the copy rules below are kept too. They are coarse buckets rather than identifiers, so the posture was sound and the sentences were the problem. The notice also gained the fourth measured signal (returning players), whose absence is how an absolute claim slipped past in the first place.

## Short line (Settings footer or Help privacy row)

> **What we measure.** The game keeps a few anonymous counts to see how new players get started, how far towers get, and whether returning players progress further. We use no cookies and store nothing that identifies you. In a browser there is nothing to accept or turn off. The desktop app asks the first time you open it, and its switch lives in Settings, under Privacy.

## Longer paragraph (Help "Privacy" subsection)

> Verticopolis keeps a small, anonymous read on how the game is going: whether new players place their first facility, how far towers climb the star ladder, which tools get used, and whether returning players get further than first-timers. Those signals are worked out on your own device and sent as coarse, anonymous counts to our own site (not to a third-party tracker in your browser), with no cookie and nothing that could point back to you across visits.
>
> Crash reports are the one place your own words can travel. They carry the technical details of the error and the same kind of anonymous totals, and an error message can occasionally quote a bit of game text, such as a tower's name.
>
> There are no accounts and no ads. In a browser there is no consent banner, because nothing that identifies you is kept. The desktop app is the one edition that asks. It runs from your own machine rather than from a page we serve, so its counts travel across the internet to our site, and it puts the question to you the first time you open it; the switch then lives in Settings, under Privacy. The counts help decide what to improve; they are never sold or shared.

## Desktop first-run notice (shown once, before anything is sent)

Lives in `src/ui/templates/desktopAnalytics.ts`. Shown only on a packaged desktop build whose consent is still `pending`. The primary button grants, "No thanks" declines, and any other dismissal the player performs (Esc, the backdrop, the title-bar x) grants, per the party ruling's default-on posture. The notice leaving the screen without the player dismissing it is not an answer: a programmatic close, or another modal taking the shared dialog, leaves the consent `pending` and the next launch asks again.

> **A word about counts**
>
> Verticopolis keeps a few anonymous counts: whether players place a first facility, how far towers climb, which tools get used, and whether returning players get further than first-timers.
>
> Nothing here identifies you, and nothing is kept that could point back to you across visits.
>
> Crash reports carry the technical details of the error. An error message can occasionally quote a bit of game text, such as a tower's name.
>
> You can turn this off at any time in Settings, under Privacy. The full privacy note is in Help, under Privacy.
>
> `[No thanks]` `[Sounds good]`

It links to nothing. The shell's external-link policy allows one host (github.com), and the full privacy text already ships in-app, so the notice points at Help rather than at a URL. A test reads the template file and fails on the sight of a web anchor, comments included.

## Copy rules

- No em-dashes; use commas, colons, parentheses, or separate sentences.
- No "X, not Y" emphatic-restatement pattern; no AI-marketing vocabulary.
- If the data posture changes (for example if a persistent identifier is ever introduced), this copy and the relevant `SPEC.md` capabilities change together (CAP-3, the returning signal and on-device buckets; and CAP-2, the cookieless transport). The line "nothing that identifies you across visits" must remain literally true: the transport uses a session-scoped id that dies with the tab (kept in `sessionStorage` only so a mid-play reload does not split one session in two) and an anonymous on-device returning bucket, never a persisted cross-visit identifier.
- The switch answers for the session as well as for the wire. The per-session summaries (`session_builds`, `session_peak_floors`, `tool_session_uses`, `session_fps`, `session_emergencies`, `session_end`) are computed from running totals and sent at a page hide, so the answer changing starts those totals over: turning sharing on begins measuring from the grant, and turning it off drops the window up to that moment instead of sending a parting summary. `GameplaySession.startEpoch` in `src/analytics.ts` is the one place that happens, hung off the single consent write.
- The desktop consent state (`pending` / `granted` / `declined`, in localStorage under `vc.desktop-analytics`) is the one persisted value this feature adds, and it is a setting rather than an identifier: it says what the player answered, nothing about who they are, and it never leaves the machine. The first-run hold that keeps early events until the answer arrives is memory only, bounded at 32, and discarded on a decline. A failed send is dropped rather than retried or written down. If that ever changes, the change is a persisted behavioral record and this copy changes with it.

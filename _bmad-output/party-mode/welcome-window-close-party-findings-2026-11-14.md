# Welcome window close: party findings, 2026-11-14

Room: Player Panel (bmad-party-mode, session mode), plus Sally (UX).
Question from Naftali: should the one-time welcome (4.0 launch fireworks,
PR #2225) close only by hand, close itself on a timer, or something in
between? It also shows to brand-new players after 4.0, and now carries
three first-time help links.

## The round

♿ **Wren:** A timer on a window with links is a trap. My reader is still on
"Good places to start" when it vanishes. WCAG 2.2.1: no time limit I can't
extend. Kill the timer.

🏢 **Kenji:** The 1994 game never closed a dialog on you. You read it, you
pressed OK. Fireworks can fade; the window waits.

🤖 **Lucia:** Fine, no timer, but don't make me hunt a tiny ✕ one-handed on a
bus. A tap anywhere on the dark part should close it. Every app does that.

📱 **Ben:** Same. Tap outside to dismiss is the iOS sheet habit.

🎨 **Sally:** Agreed, with one guard: tap outside closes, a tap inside the
window never does, so nobody loses it while aiming for a link. OK, ✕ and
Escape all close.

🎒 **Femi:** And opening a link must not close it. I tap "Your first tower",
read it in the new tab, come back, and I want the other two links still
there.

🌐 **Priya:** If it waits forever, it must never come back. Once. Latch it
the moment it shows, which it already does.

💻 **Tomasz:** As long as the fireworks stop on their own. A canvas looping
behind a forgotten window is my fan at full speed. (It stops when the sky
empties.)

😤 Kenji to Lucia: "A stray tap closing it is how my mother misses every
dialog." Lucia: "Your mother can reopen Help." Kenji conceded: the links all
live in Help anyway, so an accidental close loses nothing.

🖥️ **Kai:** Any key closing it is too twitchy; I hit Tab to get to a link
and it was gone. Escape only.

🎮 **Rhea:** With a controller the B button maps to Escape on most handhelds,
and A presses the focused button. Escape plus a focused OK covers me.

🍎 **Marco:** Copy: say "Welcome to Verticopolis™" and nothing versioned in
the title, but returning players need a nod or they'll think it's a bug that
they got a welcome. One line: "Coming back? See what's new." with the link.

## Verdict

No timer (unanimous). Easy dismissal, nothing twitchy:

- Closes on OK, the title bar ✕, Escape, or a click or tap on the dark sky
  outside the window (Lucia, Ben, Sally; Kenji conceded since every link is
  also in Help).
- Never closes on a click inside the window, on Tab, or on following a link
  (Femi, Kai).
- Fireworks end on their own; the frame loop stops (Tomasz).
- Copy greets both audiences: a line for new players with "Your first tower"
  and "Classic or Modern?", and "Coming back? See what's new" for returning
  ones (Marco). No version in the window.
- Skip the show on a boot whose save could not be read, so it never sits on
  top of that warning; it plays on a later boot (from the independent
  review's optional note).

# Party: should Modern evolve into a Windows XP-era look?

Date: 2026-11-17. Room: Web Game Room, with Winston (architect), Murat (test
architect), Dale (r/SimTower regular) and Bea (community) summoned for this
round. Question from Naftali: "Would it be crazy for modern version to evolve
into a windows xp style?"

## What the code does today (read before the round)

- One look for both modes. Every color, the font and the bevels come from
  about 20 tokens in `src/styles/retro-tokens.css` (`--r-face #c0c0c0`,
  `--r-title #000080`, `--bevel-out/--bevel-in` as box-shadows). No CSS file
  styles Classic and Modern differently; the only mode-aware CSS is the
  Modern-only reveal in the New Tower dialog.
- About 5,660 lines of CSS across `src/styles/`, with 56 bevel uses and very
  few stray hex colors, so the palette swaps in one place. The shape does not:
  Win95 is square corners and 2 px bevels; an XP-era look needs gradients,
  rounded corners and 1 px borders, which means a component layer on top of
  the tokens, not just new token values.
- The help site imports the same tokens (`retro-page.css`), so a scheme must
  say whether the manual follows it.
- The 1994 desk (desktop only) already has a Control Panel with a Display
  icon (today: Screen Saver). That is the natural home for an Appearance tab.
- The tower view is canvas (Excalibur); the chrome is DOM. A chrome scheme
  never touches the frame loop.

## The round (condensed)

🎲 **Samus:** I'll say it first: Modern feels like Classic with extra
buttons. Players don't *feel* the switch. An era jump, 1994 to 2001, is a
gorgeous tell. I like the instinct.

🎨 **Sally:** The instinct, yes. The hinge, no. Mode belongs to a tower, the
look belongs to the player. Open a Classic tower after a Modern one and the
whole desk changes costume under you. That's disorienting, not delightful.

😤 **Grumbal:** Teal IS Windows 95, I said it on Sunday. Now we want blue
rounded title bars and a green button? The first Reddit comment writes
itself: "Windows XP skin." Second comment: a lawyer's.

👩‍💼 **Bea:** Then we don't make a skin. Never the name "XP", "Luna" or
"Windows". No Start button, no flag, no rolling green hill, no Microsoft
fonts in the bundle, none of their bitmaps. We take the *era*: soft
gradients, rounded tops, friendlier buttons, and paint it in our own colors.

📐 **Juno:** Our own colors are sitting right there: the splash dusk. Navy to
violet title bars, the amber sun as the accent, a warm off-white face.
That's Verticopolis, not Redmond. Mechanically it's a `[data-scheme]` block
that swaps the tokens plus maybe 400 to 600 lines of component overrides:
buttons, title bars, menus, tabs, the taskbar.

🏗️ **Winston:** And it lives as a player preference, beside the screen
saver settings. Never in the save, never near the engine. Set the attribute
on `<html>` before first paint so nobody sees a gray flash. If it ever
follows the tower's mode, that's one listener on tower open, but then every
Open/New becomes a full restyle mid-session. I'd keep that out of v1.

🕸️ **Theo:** Cost is CSS only. Linear gradients and border-radius are
cheap. What I'll block: `backdrop-filter`, blurred box-shadows on every
window, animated gradients, and any PNG title-bar art. Fonts: the stack
already falls back to Tahoma and Segoe UI where the OS has them; we ship none.

⏱️ **Tess:** Pre-registering now. Frame time on the canvas: unchanged,
because nothing in the loop moves. CSS added: 12 KB raw ceiling. First paint:
no regression on the low-end laptop profile. Desk window drag: paint time
measured with the scheme on, since a gradient title bar repaints while it
moves. Miss one and it doesn't ship.

♿ **Wren:** Warm off-white face means every text token gets rechecked:
`--muted`, `--money`, `--bad-ink`. White title text has to clear 4.5:1 on the
*lightest* stop of the gradient, not the darkest. Focus rings stay visible on
rounded buttons. Forced colors keeps working. And while we're building a
scheme picker: put a High Contrast scheme in it. That's a real win for one
in twenty players, not a costume.

🤖 **Lucia:** Phones: touch targets don't change, so fine. The menu bar and
dialogs pick up the scheme, the theme-color meta follows it. Keep phones on
today's look unless I pick otherwise.

🧪 **Murat:** No doubling the 83-shot gallery. One new screenshot shard for
the scheme, a dozen states: menu open, a dialog, the Tools window, the desk
with taskbar, a phone shot. A unit test for the preference read and write
with storage mocked. No guard tests.

🌐 **Priya:** And it's free for everyone. Not a Modern perk, not a sponsor
perk.

🧑‍💻 **Dale:** r/SimTower would eat this up, honestly. "Modern looks like
2001" is a fun line. Just don't call it what it obviously evokes.

😤 **Grumbal:** Fine. An option. Default stays 95, everywhere, forever, and
the help manual stays a 90s manual. You give the default away and I'm out.

🎲 **Samus:** Then give me the checkbox: "Match the tower's mode." Off by
default. People who want the era jump get it.

🏗️ **Winston:** Second PR. Ship the picker, watch who picks it, then add the
checkbox if the analytics say people use it.

## Vote

| Option | What it means | Votes |
| --- | --- | --- |
| A. No change | One Win95 look for everything | 1 (Grumbal) |
| **B. Optional scheme** | New original XP-era scheme in Options / Control Panel > Display > Appearance; default stays 95; any mode | **8** (Sally, Juno, Winston, Theo, Tess, Wren, Murat, Priya) |
| C. Modern switches automatically | The literal ask: every Modern tower wears the new look | 0 |
| D. B plus "Match tower mode" | Same picker, with an opt-in checkbox that flips the look on Modern towers | 4 (Samus, Dale, Lucia, Bea) |

Verdict: not crazy as a look, but tie it to the player, not to the mode.
Build B; D's checkbox is a cheap follow-up if analytics show people use the
scheme.

## Rules the room set (if it goes ahead)

1. Original design: own palette from the splash dusk (navy to violet,
   amber accent), no Microsoft names, logos, bitmaps, Start button,
   wallpapers or bundled fonts. Working name "Skyline" (Bea).
2. Default stays the 95 look on every device; the help manual stays 90s.
3. A preference, not save data; applied before first paint.
4. Perf thresholds (Tess): canvas frame time unchanged, CSS +12 KB raw max,
   first paint unchanged, desk drag paint measured. No blur, no
   backdrop-filter, no images, no animation.
5. Contrast: every text token rechecked on the new face and on the light end
   of the title gradient; forced colors and focus rings verified. Add a High
   Contrast scheme in the same picker (Wren).
6. Free in every build, both modes.
7. One screenshot shard for the scheme; no gallery doubling; no guard test.
8. Same PR updates the help manual (Options page) and adds a PostHog
   `app_action` for the scheme choice (standing rule).

## Effort

One medium PR: the scheme CSS (about 400 to 600 lines plus token block), the
Appearance tab and the Options entry, the preference, the before-paint
attribute, a High Contrast scheme, one screenshot shard, the help page and the
analytics event. `app: minor` (new feature), `crate: none`.

Mockups (redone 2026-11-17 from the real game, kept in the project files, not the repository): the desk-hero and desk-title screenshot scenes rendered from a local build, once as-is and once with `src/skyline.css` injected as `html[data-scheme="skyline"]`. Host Chromium, so preview only. The first hand-drawn pair is in `hand-drawn-v1/`. Owner follow-ups: no star-based change; the switch is instant on Apply. Not legal
advice: the IP rules above are the room's caution, not counsel's opinion.

## Owner decisions after the round

- Stars never drive the look, and the switch is instant on Apply.
- The orange accent buttons went. Naftali picked variant B: a rose close button,
  a cream Verticopolis button and violet for the selected tool.
- "Default Windows 95, unless a user finds this setting themselves", with
  proper analytics (`appearance_set` and the common `scheme` property).
- The manual follows the scheme after all ("shouldn't the same change apply
  to the help automatically as well?"), which replaces rule 2's "the help
  manual stays 90s": a page the game opens wears the game's scheme, and a
  direct visit wears Standard until the game has opened it once.

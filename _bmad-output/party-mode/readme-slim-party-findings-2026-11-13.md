# README slim-down party, 2026-11-13

Room: Web Game Room, with Paige (Technical Writer) and John (Product Manager)
summoned. Owner ask (Naftali): "remove a lot of the docs like stuff from the
readme that now live at the docs domain or on the help site", then "the readme
can have _some_ doc like data, but right now it is much".

## What the room checked first

Each README section was matched against the two sites and the repository's
own developer docs before anyone argued about it.

| README section (268 lines) | Where it already lives | Gap found |
| --- | --- | --- |
| Intro, play link, hero image | README only | Keep |
| Play (npm install, wasm:build, dev, other scripts) | CONTRIBUTING.md "Getting started", engine-rs/README.md | `npm run preview` is only in the README |
| Install it (PWA): player half | /help/your-towers/installing/ | None |
| Install it (PWA): developer half (vite-plugin-pwa, tooling pages kept out of the worker's scope, icons from code, `npm run icons`) | Nowhere | Move to ARCHITECTURE.md |
| How to play | /help/first-tower/, /help/tower/stars/, /help/classic-vs-modern/ | None |
| Controls | /help/controls/ | None |
| Features | Spread over the whole manual | Buried treasure is missing from /help/tower/events/ |
| Saving and loading: player half | /help/your-towers/saving/, /help/your-towers/importing-exporting/ | None |
| Saving and loading: how it works | ARCHITECTURE.md "Persistence" | Two facts only in the README: the scene is never saved, and the loader drops unknown units and clamps car counts and shaft heights |
| 1994 SimTower parity table | PARITY.md (the full list) | None |
| Desktop vs. mobile | /help/controls/ (touch, phone layouts) | None |
| Architecture | ARCHITECTURE.md, engine-rs/README.md, docs.verticopolis.com | None |
| Screenshots and the star ladder | docs/screenshots.md, CONTRIBUTING.md (milestones spec) | None |
| Tests | CONTRIBUTING.md "Testing & coverage" | None |
| License | README only | Keep |

## The round

📚 **Paige:** A README has one job: the front door. Who are you, can I play,
can I build it, where do I go next. Everything after line 45 is a second
manual, and it already disagrees with the first one in small ways.

😤 **Grumbal:** It disagrees *now*. Give it a release. "2★ at 300 population,
3 named slots, 2–5 person households." Every number in that file is a copy of
something the engine catalog owns, and nothing checks it. The help site reads
those from the catalog at build time. The README reads them from someone's
memory.

🌐 **Priya:** Fine, but I landed on the repo from a Reddit thread and I want to
know what the game *is* before I click anything. Don't gut it to a link farm.

🎲 **Samus Shepard:** Agreed. Keep a short "what's in it": the rooms, the
transport, Classic and Modern, the TOWER, events, the soundtrack, the 1994
saves. Feelings, not tables.

😤 **Grumbal:** Bullets with no numbers. A number in a bullet is a bug with a
delay on it.

📚 **Paige:** That's the rule, then: highlights, each one a link to the manual
page that owns the detail. The README promises, the manual proves.

📋 **John:** Who reads this README? Three people. A player who found the repo,
a contributor, and someone embedding the engine. Each gets one line that sends
them to the right site. Why is a 30-row parity table on the front page when
PARITY.md is the source?

🕸️ **Theo:** Careful with the PWA section. Half of it is player copy, which
/help/your-towers/installing/ already says better. The other half is the only
place we wrote down that the gallery and preview tooling pages sit outside the
service worker's scope, and that the icons come from an in-code SVG with
`npm run icons`. Delete that and it's gone. It goes to ARCHITECTURE.md.

🌶️ **Boundary:** Same trap in "Saving & loading". ARCHITECTURE.md says the
loader coerces bad values and migrates. It doesn't say the scene graph is
never saved, or that unknown units are dropped and car counts and shaft
heights are clamped. Move those two sentences before cutting. And the Features
list says buried treasure; the help site's Events page never mentions it. The
engine has it: a basement room on ground nobody dug before has a chance at
$400,000 to $600,000, at most three finds a tower.

♿ **Wren:** If treasure goes into the manual, say it in words, not just a coin
emoji. And the README's controls table can go: /help/controls/ has the
keyboard-only and touch paths the README never had.

⏱️ **Tess:** The star-ladder images. The paragraph under them is pipeline
detail that CONTRIBUTING.md and docs/screenshots.md already carry. But six
images that CI re-renders are the best proof the game is winnable.

😤 **Grumbal:** Six images on a front page is a gallery. Keep day and night.

🎲 **Samus Shepard:** The ladder *is* the game's arc. One row, no paragraph.

📐 **Juno:** Day and night as the visual, and a "Learn more" table where the
star ladder used to sit. Two columns: playing, building. Links to
verticopolis.com/help pages on the left, CONTRIBUTING, ARCHITECTURE,
engine-rs/README and docs.verticopolis.com on the right.

🌍 **Lior:** And let the link labels match the manual's page titles word for
word. The README says "Saving & loading", the manual says "Saving and
loading". One name per page, or search and translation both trip on it.

📋 **John:** Badges?

😤 **Grumbal:** There are none today. A CI badge on a repo with forty
workflows tells nobody anything.

📚 **Paige:** Agreed for now. A link row under the title does the badge job
honestly: Play, How to play, Engine docs, Release notes.

(Samus and Grumbal never settled the star ladder. It goes to the owner.)

## The plan

Keep in the README (about 80 lines):

1. Title, one-paragraph pitch (Rust engine on WebAssembly, TypeScript and
   Excalibur around it, Tone.js soundtrack, every sprite drawn in code), the
   hero image.
2. A link row: Play, How to play, Engine docs, Release notes.
3. "What's in it": six or seven highlight bullets with no numbers, each
   linking to its manual page.
4. Quick start: `npm install`, `npm run wasm:build`, `npm run dev`, the one-step
   Linux script, and a pointer to CONTRIBUTING.md for the quality gates.
5. "Learn more": a table that sends players to verticopolis.com/help pages and
   contributors to CONTRIBUTING.md, ARCHITECTURE.md, engine-rs/README.md,
   docs.verticopolis.com, PARITY.md and the TDT format notes.
6. Screenshots: day and night.
7. License and the clean-room line.

Remove from the README: How to play, Controls, the full Features list, the
player and internals halves of Saving and loading, the parity table, Desktop
vs. mobile, Architecture, the star-ladder paragraph, Tests, the "Other
scripts" block.

Move before cutting (nothing lost):

- ARCHITECTURE.md gets a short "The installable app (PWA)" section:
  vite-plugin-pwa and Workbox, the update path that saves first, tooling pages
  outside the worker's scope, icons from an in-code SVG and `npm run icons`.
- ARCHITECTURE.md "Persistence" gets the two missing sentences (the scene is
  derived and never saved; unknown units dropped, car counts and shaft heights
  clamped).
- CONTRIBUTING.md "Getting started" gets `npm run preview`.
- /help/tower/events/ gets buried treasure under "Nicer surprises", with the
  engine's numbers (`engine-rs/src/build.rs`). Content only; no help-site code.

Owner's call: keep the six-image star ladder as one row (Samus, Tess) or drop
it for day and night only (Grumbal, Paige). Room leans to dropping it.
Owner chose day and night only (2026-11-13 15:02 UTC); the ladder is linked
from Learn more.

Out of scope: putting ARCHITECTURE.md or CONTRIBUTING.md on
docs.verticopolis.com. That is site work, and another thread owns the shared
site header right now.

## Follow-up round: should PARITY.md move to the help site?

Owner question, 15:21 UTC. Same room.

🎲 **Samus Shepard:** The fans who care most about parity are players, and we send them to a GitHub blob full of ✅ marks and issue numbers. The parity issue form even links there as "the list of known differences".

📚 **Paige:** But half of PARITY.md is not for players: owner rulings with dates, issue numbers, version tags, the Verification section. Pour that onto a manual page and the 90s voice dies by the second bullet.

😤 **Grumbal:** And if you copy it, you have two lists that drift. We just spent a round deleting the README's copy of the manual. Don't build a new copy the same afternoon.

🌶️ **Boundary:** Then make the drift impossible to miss. Each divergence and known gap in PARITY.md gets an anchor tag pointing at its help section, and a test fails when one side has an entry the other lacks.

⏱️ **Tess:** Agreed. Prose can't stop drift. A test can.

🌐 **Priya:** I'd read a page called "Differences from the 1994 game". I would never open PARITY.md.

📋 **John:** So it's a split, not a move. The player half goes to the help site in manual voice, the engineering checklist stays in the repo, and a test ties them together.

Recommendation: a new help page, "Differences from the 1994 game", next to Classic and Modern, in manual and wiki style (what matches, the deliberate differences, the known gaps, how to report one). PARITY.md stays as the developer checklist with a pointer to it at the top. The parity issue form and the README link to the help page. A guard test keeps every divergence and gap listed on both. Its own PR, after #2098.

Owner add-on, 15:21 UTC: "it's just long as well, and can probably be split into easy to read sections."

📚 **Paige:** Then the help side is sections that follow the manual's own outline: Building, Rooms, Elevators and stairs, Money, People and ratings, Events, Saves. Each opens with a two-line summary and a small wiki table, 1994 / Classic / Modern, with a link to the manual page that explains the rule.

🎲 **Samus Shepard:** And the known gaps get their own short section at the end, in plain words: "the 1994 game let you schedule each car; we don't yet."

😤 **Grumbal:** The repo file needs the same diet. Some bullets are a whole paragraph of owner rulings. One line per item, the issue number, and the ruling lives in the issue.

♿ **Wren:** Tables with real header rows, please, and no ✅ or ◑ standing alone as the only signal. Write "Same", "Different on purpose", "Not yet".

import { html, type TemplateResult } from "lit-html";
import { compareTemplate } from "./compare";

/**
 * The How-to-play guide content, as the single source shared by BOTH the in-game
 * Help modal (`help.ts`) and the standalone `/help` page (`helpPage.ts`). The
 * modal wraps each section in a collapsible `<details class="help-modes">`; the
 * page renders the same sections expanded under headings. Keeping the bodies here
 * means the guide copy has one home and cannot drift between the two surfaces,
 * the same discipline `compareTemplate()` already brings to the Classic vs Modern
 * section (which is one of these sections).
 *
 * Section `id`s are the page's anchor targets (e.g. `/help#classic-vs-modern`,
 * which the in-game "Open full page" link deep-links to). The copy is trusted
 * static prose; only the app `version` in About is interpolated (auto-escaped by
 * lit). The `help.test.ts` drift guard inspects the Classic vs Modern section, so
 * keep that section rendering `compareTemplate()` verbatim.
 */
export interface HelpSection {
  /** Anchor id on the standalone page (also the section's stable key). */
  id: string;
  /** Heading text (the modal's `<summary>`, the page's `<h2>`). */
  title: string;
  /** The section body. */
  body: () => TemplateResult;
}

/** The lead paragraphs under the "How to play" heading (premise + mouse/touch lines). */
export function helpLede(): TemplateResult {
  return html`
    <p>Build a thriving high-rise and earn your way to a coveted <b>TOWER</b> rating.</p>
    <p style="color:var(--muted)">Mouse: drag to pan with the Inspect tool; with a build tool, hold <b>Shift</b> (or Space) and drag to pan, and a middle or right button drag pans too. Scroll to zoom, click to build, Inspect tool to edit a room. Made a mistake? <b>Undo with Ctrl+Z</b> (or the Undo button). Redo with Ctrl+Shift+Z. Music changes with whatever part of the tower you're viewing. Try scrolling around!</p>
    <p style="color:var(--muted)">Touch: press and drag on the tower to build (a ghost shows where the room lands), two fingers to pan, pinch to zoom, tap a room with Inspect to edit it. Full guide under <b>Playing on a phone</b> below.</p>
  `;
}

/** The how-to-play sections, in order. "The basics" is the essentials section the
 *  modal opens on first paint; the rest are reference. Classic vs Modern renders
 *  the shared `compareTemplate()`. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "basics",
    title: "The basics",
    body: () => html`
      <ul>
        <li><b>Floors first.</b> Lay <b>Floor</b> tiles, then place rooms on them.</li>
        <li><b>Move people.</b> Every floor needs an <b>elevator</b> or <b>stairs</b> chain back to the ground lobby, or tenants leave.</li>
        <li><b>Make money.</b> Offices pay quarterly rent, condos sell once, hotels earn nightly, shops &amp; restaurants earn from foot traffic.</li>
        <li><b>Grow your rating.</b> 2★ at 300 pop, 3★ at 1,000 (needs Security), 4★ at 5,000 (needs Medical, enough Recycling, suites &amp; a VIP), 5★ at 10,000 (needs a Metro). At 5★ a floor-100 payoff wins the game (under Going further).</li>
        <li><b>Keep it moving.</b> People will ride as many elevators as it takes to reach a floor, but every transfer is another wait. Add <b>sky lobbies</b> (every ~15 floors) and <b>express</b> elevators so long trips stay quick; a tower that makes people transfer over and over crawls, and they give up.</li>
      </ul>
    `,
  },
  {
    id: "going-further",
    title: "Going further",
    body: () => html`
      <ul>
        <li><b>Take out the trash.</b> One <b>Recycling Center</b> processes ~2,500 population. It visibly fills through the day and a garbage truck empties it each morning. Outgrow your centers and 4★ locks until you build more.</li>
        <li><b>Win.</b> At 5★ with a Metro station, build the <b>Wedding Hall</b> on floor 100 and pass the VIP inspection. The <b>TOWER</b> rank needs 15,000 occupants: office workers, residents, and venue customers. Hotel guests don't count at this stage, even when dining.</li>
        <li><b>Parking</b> spaces only work when they touch a <b>Parking Ramp</b> or a connected space. Chain them off a ramp, or they sit empty. Offices want a space per ~24 workers (one per four offices) from 3★, and every hotel suite needs one of its own (the VIP drives).</li>
        <li><b>Book the films.</b> Cinemas book a film monthly. A <b>Blockbuster</b> costs twice as much but pulls a far bigger crowd (great in a busy tower, a money-loser in a quiet one). Leave it on <b>Auto</b> or set a policy on the cinema.</li>
        <li><b>Price in bulk.</b> Inspect any office, condo or hotel room and use <b>“Set all …”</b> to re-price every unit of that kind at once (or reset them to the default). No need to edit each room. A preview shows how many change before you apply.</li>
        <li><b>The clock breathes.</b> As in 1994, real time isn't spent evenly: the clock crawls through the lunch crush (watch your elevators earn their keep) and races through the small hours. A full day still takes the same real time, and the speed buttons still multiply it. Prefer an even pace? Toggle <b>Steady clock</b> in Settings.</li>
      </ul>
    `,
  },
  {
    id: "classic-vs-modern",
    title: "Classic vs Modern",
    body: () => compareTemplate(),
  },
  {
    id: "touch",
    title: "Playing on a phone",
    body: () => html`
      <p style="color:var(--muted)">Everything works by touch. With a build tool chosen from the bottom menu:</p>
      <ul>
        <li><b>Place a room.</b> Press the tower and drag: a ghost floats just above your finger so you can see where it lands, gold where it fits, red where it will not. Lift to place, or slide to a valid spot first. A quick tap drops one too.</li>
        <li><b>Lay a run.</b> Drag with <b>Floor</b>, <b>Lobby</b>, or a <b>Parking</b> space to lay a whole strip at once.</li>
        <li><b>Size an elevator.</b> Drag up or down to set a shaft's height. Stairs and escalators place with a single tap.</li>
        <li><b>Move around.</b> Drag with <b>two fingers</b> to pan (or one finger with <b>Inspect</b> selected), and <b>pinch</b> to zoom.</li>
        <li><b>Peek at a room.</b> Press and hold a room (any tool) to read its card without opening it, the way a mouse hover does. Lift to close. A quick tap still does the armed tool's action: with <b>Inspect</b> it opens the full panel.</li>
        <li><b>Edit or remove.</b> Tap a room with <b>Inspect</b> to open its panel; tap with <b>Bulldoze</b> to demolish it.</li>
        <li><b>Menus.</b> The build menu groups tools under category tabs, and a tab with a dot just gained new tools. The <b>menu</b> button (top bar) opens stats and the game menu, and the <b>Undo</b> button steps a change back.</li>
      </ul>
    `,
  },
  {
    id: "keyboard",
    title: "Keyboard play",
    body: () => html`
      <p style="color:var(--muted)">Play entirely without a mouse. Pick a tool in the palette (Tab to it, Enter to select), then:</p>
      <ul class="help-keys">
        <li><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> (or <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>) move the build cursor. Hold <kbd>Shift</kbd> for ×10</li>
        <li><kbd>Enter</kbd> / <kbd>Space</kbd> build (or inspect) at the cursor. For an elevator or stairway, press once to anchor and again at the far end to size the shaft</li>
        <li><kbd>Delete</kbd> / <kbd>Backspace</kbd> / <kbd>X</kbd> bulldoze at the cursor · <kbd>Esc</kbd> cancel</li>
        <li><kbd>+</kbd> / <kbd>−</kbd> zoom · <kbd>C</kbd> re-center · <kbd>0</kbd>–<kbd>3</kbd> game speed · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo</li>
      </ul>
    `,
  },
];

/** The About section body (attribution + the interpolated app version). */
export function helpAboutBody(version: string): TemplateResult {
  return html`<p style="color:var(--muted)">An unofficial, from-scratch homage to SimTower (1994). Original code and art; no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.<br />Verticopolis <span class="app-version">v${version}</span></p>`;
}

/** The Privacy section body, shared by the in-game Help modal and the standalone
 *  `/help` page (each surface supplies its own heading, like About). One home for
 *  the promise so the two surfaces can never disagree about what is collected.
 *  Keep this in step with reality: the gameplay counters (`analytics.ts`, relayed
 *  by `analyticsIngest.ts`), the page/performance metrics (`telemetry.ts`), and
 *  the error reporter (`analyticsErrors.ts`) are all cookieless and carry no
 *  personal data or durable identifier; if any of that posture changes, this copy
 *  must change in the same PR.
 *
 *  Two sentences were rewritten for the desktop build (issue #781), and the
 *  reasons are worth keeping: the old text said counts go "through our own site",
 *  which read as a same-origin promise that a packaged app posting across the
 *  internet does not keep; and it said there is no consent banner "because there
 *  is nothing here to consent to", which stopped being true the moment one
 *  edition started asking. The crash-report caveat was also moved out of the
 *  middle of a long sentence into its own paragraph, because it is the one place
 *  free text can travel and it should not have to be hunted for.
 *
 *  Every claim in here is an IDENTITY claim, and that is deliberate. The
 *  replacement for the consent-banner sentence briefly said "nothing is kept
 *  about you to consent to", which is a data claim and a false one: the
 *  transparency note two paragraphs down describes a session-scoped id in
 *  `sessionStorage` and an on-device returning bucket, both of them kept. What
 *  is true, and what this copy says instead, is that none of it identifies you
 *  or points back to you across visits. Keep any future edit on that side of the
 *  line. */
export function helpPrivacyBody(): TemplateResult {
  return html`<p style="color:var(--muted)">
      Verticopolis keeps a small, anonymous read on how the game is going: whether new players place their first
      facility, how far towers climb the star ladder, which tools get used, and whether returning players get further
      than first-timers. Those signals are worked out on your own device and sent as coarse, anonymous counts to our
      own site, with no cookie and nothing that could point back to you across visits, plus anonymous page-visit
      counts and page performance metrics.
    </p>
    <p style="color:var(--muted)">
      Crash reports are the one place your own words can travel. They carry the technical details of the error and the
      same kind of anonymous totals, and an error message can occasionally quote a bit of game text, such as a tower's
      name.
    </p>
    <p style="color:var(--muted)">
      There are no accounts and no ads: the game never asks for your name or email, keeps no profile, and nothing
      recognizes you from one day to the next. In a browser there is no consent banner, because nothing that identifies
      you is kept. The desktop app is the one edition that asks. It runs from your own machine rather than from a
      page we serve, so its counts travel across the internet to our site, and it puts the question to you the first
      time you open it; the switch then lives in Settings, under Privacy. Saves live in your own storage and leave your
      device only when you export them. The counts help decide what to improve; they are never sold or shared.
    </p>`;
}

/** The "Found a bug?" report call to action (heading + blurb + external link).
 *  The wrapping `<p>` keeps `class="help-report"` so the modal controller's
 *  `.help-report a` selector finds the link and routes it through the platform
 *  wrapper (`routeExternalInWrapper`).
 *
 *  The heading level is caller-chosen so each surface keeps a consistent document
 *  outline without forking the prose: the modal uses `h3` (matching its
 *  `aria-level="3"` section summaries), the standalone page uses `h2` (a
 *  top-level section like the guide sections around it). */
export function helpReportBlock(heading: "h2" | "h3" = "h3"): TemplateResult {
  const title =
    heading === "h2" ? html`<h2>Found a bug? Have an idea?</h2>` : html`<h3>Found a bug? Have an idea?</h3>`;
  return html`
    ${title}
    <p style="color:var(--muted)">Help us improve Verticopolis. Report a bug, request a feature, or flag anything that doesn't match the 1994 original.</p>
    <p class="help-report"><a class="btn" target="_blank" rel="noopener noreferrer" href="https://github.com/maniator/verticopolis/issues/new/choose">Let us know…<span class="visually-hidden"> (opens GitHub in a new tab)</span></a></p>
  `;
}

import { html, type TemplateResult } from "lit-html";
import { compareTemplate } from "./compare";
import * as helpIndex from "../../../help-site/src/content/docs/index.md";
import * as basics from "../../../help-site/src/content/docs/getting-started.md";
import * as goingFurther from "../../../help-site/src/content/docs/going-further.md";
import * as classicVsModern from "../../../help-site/src/content/docs/classic-vs-modern.md";
import * as phones from "../../../help-site/src/content/docs/phones.md";
import * as keyboard from "../../../help-site/src/content/docs/keyboard.md";
import * as privacy from "../../../help-site/src/content/docs/privacy.md";

/**
 * The How-to-play guide content for the in-game Help modal (`help.ts`). The
 * Help site at `/help` serves the same pages. The copy itself
 * lives in the Help site's Markdown pages (`help-site/src/content/docs/`),
 * compiled into lit templates at build time (`src/build/helpMarkdown.ts`). The
 * modal wraps each section in a collapsible `<details class="help-modes">`.
 * Keeping the copy in those pages means it has one home and cannot drift
 * between the game and the site, the same discipline `compareTemplate()`
 * brings to the Classic vs Modern section (which is one of these sections).
 *
 * Section `id`s are the old `/help#id` anchors, which the site still sends to
 * their pages (each page's `helpId` front matter). The copy is trusted
 * static prose; only the app `version` in About is interpolated (auto-escaped by
 * lit). The `help.test.ts` drift guard inspects the Classic vs Modern section, so
 * keep that section rendering `compareTemplate()` verbatim.
 */
export interface HelpSection {
  /** The section's stable key (its old `/help#id` anchor). */
  id: string;
  /** Heading text (the modal's `<summary>`, the page's `<h2>`). */
  title: string;
  /** The section body. */
  body: () => TemplateResult;
}

/** The lead paragraphs under the "How to play" heading (premise + mouse/touch
 *  lines): the Help site's front page before its first section. */
export function helpLede(): TemplateResult {
  return html`<div class="help-md help-lede">${helpIndex.intro()}</div>`;
}

/** One guide page as a Help section. The `help-md` wrapper carries the Help
 *  window's Markdown styling (muted paragraphs, key caps on the keyboard page). */
function section(page: typeof basics, id: string): HelpSection {
  return { id, title: page.title, body: () => html`<div class="help-md" data-help=${id}>${page.body()}</div>` };
}

/** The how-to-play sections, in order. "The basics" is the essentials section the
 *  modal opens on first paint; the rest are reference. Classic vs Modern renders
 *  the shared `compareTemplate()`, which reads the same Classic vs Modern page. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  section(basics, "basics"),
  section(goingFurther, "going-further"),
  { id: "classic-vs-modern", title: classicVsModern.title, body: () => compareTemplate() },
  section(phones, "touch"),
  section(keyboard, "keyboard"),
];

/** The About section body (attribution, the interpolated app version and a
 *  link to the third-party license notices the build generates,
 *  `scripts/gen-third-party-notices.ts`, #951). The in-game modal uses the
 *  default relative href, which resolves against the game page's own URL (the
 *  site root on the web, where the file sits beside `index.html`); a page at
 *  a deeper path passes the root-relative one. */
export function helpAboutBody(version: string, engine = "", licensesHref = "third-party-notices.txt"): TemplateResult {
  return html`<p style="color:var(--muted)">An unofficial, from-scratch homage to SimTower (1994). Original code and art; no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.<br />Verticopolis <span class="app-version">v${version}</span>${engine}</p><p class="help-licenses"><a href=${licensesHref} target="_blank" rel="noopener noreferrer">Third-party licenses<span class="visually-hidden"> (opens in a new tab)</span></a></p>`;
}

/** The Privacy section body for the in-game Help modal, compiled from the Help
 *  site's privacy page (the modal supplies its own heading, like About). One
 *  home for the promise so the game and the site can never disagree about what
 *  is collected.
 *  Keep this in step with reality: the gameplay counters (`analytics.ts`, relayed
 *  by `analyticsIngest.ts`), the page/performance metrics (`telemetry.ts`), and
 *  the error reporter (`analyticsErrors.ts`) are all cookieless and carry no
 *  personal data or durable identifier; if any of that posture changes, this copy
 *  must change in the same PR.
 *
 *  Every claim in here is an IDENTITY claim, and that is deliberate: the
 *  transparency note describes a session-scoped id in `sessionStorage` and an
 *  on-device returning bucket, both of them kept. What is true, and what this
 *  copy says, is that none of it identifies you or points back to you across
 *  visits. Keep any future edit on that side of the line. */
export function helpPrivacyBody(): TemplateResult {
  return html`<div class="help-md">${privacy.body()}</div>`;
}

/** The "Found a bug?" report call to action (heading + blurb + external link).
 *  The wrapping `<p>` keeps `class="help-report"` for its styling.
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

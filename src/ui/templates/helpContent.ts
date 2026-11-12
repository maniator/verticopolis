import { html, type TemplateResult } from "lit-html";
import * as privacy from "../../../help-site/src/content/docs/privacy.md";

/**
 * The Help window pieces the game still draws itself: the About line and the
 * privacy note. The guide is the Help site at /help, which the game opens in a
 * new tab; the privacy copy is that site's privacy page, compiled at build
 * time (`src/build/helpMarkdown.ts`), so the game and the site say the same.
 */

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

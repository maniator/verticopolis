import { html, type TemplateResult } from "lit-html";

/**
 * The About line, the one Help piece the game still draws itself. The guide,
 * the release notes and the privacy page are the Help site at /help, which the
 * game opens in a new tab.
 */

/** The About section body (attribution, the interpolated app version and a
 *  link to the third-party license notices the build generates,
 *  `scripts/gen-third-party-notices.ts`, #951). The in-game modal uses the
 *  default relative href, which resolves against the game page's own URL (the
 *  site root on the web, where the file sits beside `index.html`); a page at
 *  a deeper path passes the root-relative one. */
export function helpAboutBody(version: string, engine = "", licensesHref = "third-party-notices.txt"): TemplateResult {
  return html`<p style="color:var(--muted)">An unofficial, from-scratch homage to SimTower (1994). Original code and art; no ripped assets. Not affiliated with or endorsed by Maxis / OPeNBooK / Vivarium.<br />Verticopolis™ <span class="app-version">v${version}</span>${engine}</p><p class="help-licenses"><a href=${licensesHref} target="_blank" rel="noopener noreferrer">Third-party licenses<span class="visually-hidden"> (opens in a new tab)</span></a></p>`;
}

import { html, render, nothing, type TemplateResult } from "lit-html";
import { pageShell } from "./ui/templates/pageShell";
import { HELP_SECTIONS, helpLede, helpAboutBody, helpPrivacyBody, helpReportBlock } from "./ui/templates/helpContent";
import { compareFigures } from "./ui/templates/compareFigures";
import { injectVercelTelemetry } from "./telemetry";
import { trackAppAction } from "./analytics";

/**
 * Entry for the standalone `/help` page: the shareable, canonical How-to-play
 * guide at a clean URL. It renders the SAME `HELP_SECTIONS` (the basics, going
 * further, Classic vs Modern, keyboard) the in-game Help modal renders, from the
 * one shared `helpContent` source, inside the retro page shell (CAP-6), so the
 * guide copy has a single home and this page can never drift from the in-game
 * text. Classic vs Modern is one section here, anchored at `/help#classic-vs-modern`
 * (the in-game "Open full help page" link deep-links to it).
 *
 * No game code runs here: no Excalibur canvas, no simulation, nothing to pause.
 * The page reports the same host-gated Vercel telemetry the game and the gallery
 * report (production and preview only). The shell's navigation links ("Back to
 * game" and the sibling nav) are plain same-origin anchors, so they work with JS
 * disabled, from a cold shared link, and inside the installed PWA; the report
 * call to action links out to GitHub.
 */

/** Compile-time app version (see vite.config.ts `define`); "dev" outside a build. */
const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/** The page body: the lead block, then every guide section expanded under a
 *  heading, then About and the report call to action, wrapped in the retro window
 *  shell. Pure (no DOM side effects) so the page test can render it directly. */
export function helpPageTemplate(): TemplateResult {
  const body = html`
    <div class="page-lede">
      <h1>How to Play</h1>
      <p class="sub">The full guide, from the basics to how the Classic and Modern rule-sets differ.</p>
    </div>
    ${helpLede()}
    ${HELP_SECTIONS.map(
      (s) => html`<section id=${s.id} class="help-section">
        <h2>${s.title}</h2>
        ${s.body()}${s.id === "classic-vs-modern" ? compareFigures() : nothing}
      </section>`,
    )}
    <section id="about" class="help-section"><h2>About</h2>${helpAboutBody(APP_VERSION)}</section>
    <section id="privacy" class="help-section"><h2>Privacy</h2>${helpPrivacyBody()}</section>
    <section class="help-section">${helpReportBlock("h2")}</section>
  `;
  return pageShell({
    title: "Verticopolis: How to Play",
    backHref: "/",
    main: body,
    links: [{ href: "/gallery", label: "Sprite Gallery" }],
  });
}

function main(): void {
  injectVercelTelemetry();
  trackAppAction("page_help"); // landing on the standalone /help page (host-gated inside)
  const root = document.getElementById("app");
  if (!root) return;
  // The build prerenders this page's markup into #app (scripts/prerender-help.ts)
  // so crawlers and no-JS visitors get the guide without running this script.
  // lit-html appends rather than adopting foreign children, so the prerendered
  // copy must go or the guide doubles; it is removed only AFTER a successful
  // render, so a render error leaves the prerendered guide on screen instead
  // of a blank page. Both steps run in one synchronous frame, so the swap is
  // not visible.
  const prerendered = [...root.childNodes];
  render(helpPageTemplate(), root);
  for (const node of prerendered) node.remove();
  // Signal readiness for screenshot tooling (mirrors the gallery's flag).
  (window as unknown as { helpReady: boolean }).helpReady = true;
}

main();

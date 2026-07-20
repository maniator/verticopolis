import { html, render, type TemplateResult } from "lit-html";
import { pageShell } from "./ui/templates/pageShell";
import { HELP_SECTIONS, helpLede, helpAboutBody, helpReportBlock } from "./ui/templates/helpContent";
import { injectVercelTelemetry } from "./telemetry";

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
      (s) => html`<section id=${s.id} class="help-section"><h2>${s.title}</h2>${s.body()}</section>`,
    )}
    <section id="about" class="help-section"><h2>About</h2>${helpAboutBody(APP_VERSION)}</section>
    <section class="help-section">${helpReportBlock()}</section>
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
  const root = document.getElementById("app");
  if (!root) return;
  render(helpPageTemplate(), root);
  // Signal readiness for screenshot tooling (mirrors the gallery's flag).
  (window as unknown as { helpReady: boolean }).helpReady = true;
}

main();

import { html, render, type TemplateResult } from "lit-html";
import { pageShell } from "./ui/templates/pageShell";
import { compareTemplate } from "./ui/templates/compare";
import { injectVercelTelemetry } from "./telemetry";

/**
 * Entry for the standalone `/help` page: a shareable, canonical home for the
 * Classic vs Modern comparison at a clean URL. It renders the SAME
 * `compareTemplate()` the Help modal, the in-game compare modal, and the
 * founding screen render (CAP-1), inside the shared retro page shell (CAP-6), so
 * the copy has one source and this page can never drift from the in-game text.
 *
 * No game code runs here: no Excalibur canvas, no simulation, nothing to pause.
 * The page reports the same host-gated Vercel telemetry the game and the gallery
 * report (production and preview only), and every link is a plain same-origin
 * anchor, so "Back to game" and the sibling nav work with JS disabled, from a
 * cold shared link, and inside the installed PWA.
 */

/** The page body: the lead block over the shared comparison, wrapped in the
 *  retro window shell with "Back to game" and a sibling link to the gallery.
 *  Pure (no DOM side effects) so the page test can render it directly. */
export function helpPageTemplate(): TemplateResult {
  const body = html`
    <div class="page-lede">
      <h1>Classic vs Modern</h1>
      <p class="sub">
        You pick a rule-set when you found a Verticopolis tower, and it is fixed for that tower's life. Here is exactly
        what changes between the two.
      </p>
    </div>
    ${compareTemplate()}
  `;
  return pageShell({
    title: "Verticopolis: Classic vs Modern",
    backHref: "/",
    main: body,
    links: [{ href: "/gallery", label: "Sprite Gallery" }],
    footer: html`Spot something in Classic that does not match the 1994 original, or an idea for Modern?
      <a href="https://github.com/maniator/verticopolis/issues/new/choose" target="_blank" rel="noopener noreferrer"
        >Let us know</a
      >.`,
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

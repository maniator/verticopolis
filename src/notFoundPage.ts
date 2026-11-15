import { html, render, type TemplateResult } from "lit-html";
import { pageShell } from "./ui/templates/pageShell";
import { injectPageTelemetry } from "./telemetry";
import { takeFromGameFlag } from "./ui/fromGame";
import { GAME_HOME, helpUrl } from "./helpAddress";

/**
 * Entry for the site's "page not found" page, `404.html`. The host serves it,
 * with a 404 status, for any path the site does not have, so a mistyped or
 * old link (`/help/changlog`, a page from a later build) gets the retro page
 * frame and a way on instead of the host's own error page. The manual's own
 * host (help.verticopolis.com) serves it too, so its links name their host.
 * No game code runs here, and the page is kept out of the offline precache.
 */

/** Where a lost visitor most likely meant to go. */
export const NOT_FOUND_LINKS: readonly { href: string; label: string }[] = [
  { href: helpUrl("/help"), label: "How to Play" },
  { href: helpUrl("/help/changelog"), label: "Release notes" },
  { href: helpUrl("/help/rooms"), label: "Every room" },
];

/** The page body inside the retro page shell. `path` is the address that was
 *  not found, shown as plain text (lit escapes it). `fromGame` makes "Back to
 *  game" close this tab, as on /help, when the game opened it (a sibling page
 *  reached from a game-opened tab carries that in session storage). Pure, so
 *  the test renders it directly. */
export function notFoundPageTemplate(path: string, fromGame = false): TemplateResult {
  const body = html`
    <div class="page-lede">
      <h1>Page not found</h1>
      <p class="sub">There is no page at <code>${path}</code>.</p>
      <p>The link may be mistyped, or the page may have moved. Try one of these:</p>
    </div>
    <nav class="page-links" aria-label="Pages">
      <a class="btn primary" href=${GAME_HOME}>Play the game</a>
      ${NOT_FOUND_LINKS.map((l) => html`<a class="btn" href=${l.href}>${l.label}</a>`)}
    </nav>
  `;
  return pageShell({
    title: "Verticopolis™: Page not found",
    backHref: GAME_HOME,
    main: body,
    // The body lists the pages as buttons; repeating them in the title bar
    // pushed Back to game off a phone screen.
    fromGame,
  });
}

function main(): void {
  injectPageTelemetry();
  const root = document.getElementById("app");
  if (!root) return;
  const fallback = [...root.childNodes];
  render(notFoundPageTemplate(location.pathname, takeFromGameFlag(location, history)), root);
  for (const node of fallback) node.remove();
}

main();

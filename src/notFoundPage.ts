import { html, render, type TemplateResult } from "lit-html";
import { pageShell } from "./ui/templates/pageShell";
import { injectVercelTelemetry } from "./telemetry";

/**
 * Entry for the site's "page not found" page, `404.html`. The host serves it,
 * with a 404 status, for any path the site does not have, so a mistyped or
 * old link (`/help/changlog`, a page from a later build) gets the retro page
 * frame and a way on instead of the host's own error page. No game code runs
 * here, and the page is kept out of the offline precache.
 */

/** Where a lost visitor most likely meant to go. */
export const NOT_FOUND_LINKS: readonly { href: string; label: string }[] = [
  { href: "/help", label: "How to Play" },
  { href: "/help/changelog", label: "Release notes" },
  { href: "/gallery", label: "Sprite Gallery" },
];

/** The page body inside the retro page shell. `path` is the address that was
 *  not found, shown as plain text (lit escapes it). Pure, so the test renders
 *  it directly. */
export function notFoundPageTemplate(path: string): TemplateResult {
  const body = html`
    <div class="page-lede">
      <h1>Page not found</h1>
      <p class="sub">There is no page at <code>${path}</code>.</p>
      <p>The link may be mistyped, or the page may have moved. These pages are here:</p>
    </div>
    <section class="help-section">
      <ul>
        <li><a href="/">Play the game</a></li>
        ${NOT_FOUND_LINKS.map((l) => html`<li><a href=${l.href}>${l.label}</a></li>`)}
      </ul>
    </section>
  `;
  return pageShell({
    title: "Verticopolis: Page not found",
    backHref: "/",
    main: body,
    links: [...NOT_FOUND_LINKS],
  });
}

function main(): void {
  injectVercelTelemetry();
  const root = document.getElementById("app");
  if (!root) return;
  const fallback = [...root.childNodes];
  render(notFoundPageTemplate(location.pathname), root);
  for (const node of fallback) node.remove();
}

main();

import { html, type TemplateResult } from "lit-html";
import * as classicVsModern from "../../../help-site/src/content/docs/classic-vs-modern.md";
import { fromGameHref } from "../fromGame";

/**
 * The Classic vs Modern comparison body: the Help site's Classic and Modern
 * page (`help-site/src/content/docs/classic-vs-modern.md`) up to its first
 * section, the summary and the at-a-glance table, compiled at build time
 * (`src/build/helpMarkdown.ts`). The founding screen and the in-game Compare
 * modal show it; the site shows the whole page, pictures and all, so the copy
 * has one home and cannot drift.
 *
 * The table links to the manual's pages. In the game a link must not replace
 * the game itself, so every one opens its page in a new tab, marked
 * `?from=game` (src/ui/fromGame.ts).
 *
 * The drift guard in `./compare.test.ts` checks this body names every Modern
 * divergence the engine publishes, so a new one has to be described on that
 * page before it can ship.
 */
export function compareTemplate(): TemplateResult {
  return html`<div class="help-md" @click=${openLinksInNewTab}>${classicVsModern.intro()}</div>`;
}

/** Send a click on a manual link to a new tab instead of away from the game. */
function openLinksInNewTab(e: MouseEvent): void {
  const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
  const href = link?.getAttribute("href");
  if (!href || !href.startsWith("/")) return;
  e.preventDefault();
  window.open(fromGameHref(href), "_blank", "noopener");
}

/**
 * The in-game Compare modal body: the shared {@link compareTemplate} under an
 * `<h2>` title bar, with a plain "Got it" close. Opened by `uiDialogs.showCompare`
 * through the single `#modal`, so it inherits the standard close/Esc/backdrop
 * grammar. The controller pauses the tower on open and restores the prior speed
 * on close, so reading the reference never costs the player elevator time.
 */
export function compareModalTemplate(): TemplateResult {
  return html`
      <h2>Classic vs Modern</h2>
      ${compareTemplate()}
      <div class="modal-actions"><button class="btn primary" data-act="close" autofocus>Got it</button></div>
    `;
}

import { html, type TemplateResult } from "lit-html";
import type { ModalView } from "@verticopolis/components/windows/uiModal";
import { fromGameHref } from "../fromGame";
import { helpUrl } from "../../helpAddress";

/**
 * The one-time version 4 welcome (`src/ui/launchFireworks.ts`), in the shared
 * modal like every other dialog: an `<h2>` the window grammar turns into the
 * title bar with its ✕, a short body, and the standard `.modal-actions` OK.
 * New players see it as well as returning ones, so it greets rather than
 * announces a version (owner, 2026-11-14). The returning players' line keeps
 * the first draft's menu bar news and thanks (player panel, 2026-11-14). The help links open in a new tab,
 * marked `?from=game` (src/ui/fromGame.ts), so the game stays where it is.
 */

/** The welcome's first-time help links. */
export const WELCOME_LINKS = {
  firstTower: { label: "Your first tower", href: "/help/first-tower/" },
  modes: { label: "Classic or Modern?", href: "/help/classic-vs-modern/" },
  whatsNew: { label: "See what's new", href: "/help/changelog" },
} as const;

function helpLink(link: { label: string; href: string }): TemplateResult {
  return html`<a href=${fromGameHref(helpUrl(link.href), "welcome")} target="_blank" rel="noopener noreferrer">${link.label}<span class="visually-hidden"> (opens in a new tab)</span></a>`;
}

export function welcomeModalTemplate(): ModalView {
  return {
    title: "Welcome to Verticopolis™",
    body: html`
      <p>Build a tower floor by floor, from one lobby to a five-star skyscraper. New here? Good places to start:</p>
      <ul>
        <li>${helpLink(WELCOME_LINKS.firstTower)}</li>
        <li>${helpLink(WELCOME_LINKS.modes)}</li>
      </ul>
      <p>Coming back? There's a new menu bar across the top. ${helpLink(WELCOME_LINKS.whatsNew)}. Thanks for building with us.</p>
      <div class="modal-actions modal-footer"><button class="btn primary" data-act="close" autofocus>OK</button></div>
    `,
  };
}

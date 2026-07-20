import { html, nothing, type TemplateResult } from "lit-html";

/** A sibling-page link in the title-bar nav (e.g. the Sprite Gallery). */
export interface PageShellLink {
  href: string;
  label: string;
}

export interface PageShellOptions {
  /** Title-bar text shown in the navy window title bar. (The document `<title>`
   *  is set by each page's own static HTML head, not from this value.) */
  title: string;
  /** Where "Back to game" points. Standalone pages use "/" (the game root). */
  backHref: string;
  /** The page body, rendered inside the window's `.win-body`. */
  main: TemplateResult;
  /** Sibling-page links shown in the title bar (before Back to game). */
  links?: PageShellLink[];
  /** Optional left-side footer content; the shell always adds Back to game at the right. */
  footer?: TemplateResult;
  /** Title-bar emoji app icon. */
  icon?: string;
}

/**
 * The reusable retro window frame for a standalone page (the /help page, the
 * sprite gallery, and future pages like a changelog or credits). It renders the
 * shared Windows-3.1 chrome from `retro-components.css`: a navy sticky title bar
 * with the app icon, the page title, any sibling-page links, and a "Back to
 * game" button, wrapping the page body, with a footer carrying a second "Back to
 * game" link. Every link is a plain same-origin anchor, so navigation works with
 * JS disabled, from a cold shared link, and inside the installed PWA.
 *
 * Style comes entirely from `src/styles/retro-page.css` (which the page loads);
 * this helper only supplies structure and the shared class names.
 */
export function pageShell(opts: PageShellOptions): TemplateResult {
  const { title, backHref, main, links = [], footer, icon = "🏙" } = opts;
  const back = (cls: string): TemplateResult =>
    html`<a class="btn ${cls}" href=${backHref}>◄ Back to game</a>`;
  return html`
    <main class="page-win win">
      <div class="win-title">
        <span class="page-icon" aria-hidden="true">${icon}</span>
        <span class="page-title-text">${title}</span>
        <nav class="page-nav" aria-label="Pages">
          ${links.map((l) => html`<a class="btn xs" href=${l.href}>${l.label}</a>`)}
          ${back("xs primary")}
        </nav>
      </div>
      <div class="win-body">
        ${main}
        <div class="page-foot">
          <span>${footer ?? nothing}</span>
          <span class="actions">${back("")}</span>
        </div>
      </div>
    </main>
  `;
}

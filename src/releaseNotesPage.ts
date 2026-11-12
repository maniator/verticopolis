import { html, render, type TemplateResult } from "lit-html";
import { pageShell } from "./ui/templates/pageShell";
import { takeFromGameFlag } from "./ui/fromGame";
import type { ReleaseNotes } from "./changelog";
import { injectVercelTelemetry } from "./telemetry";
import { trackAppAction } from "./analytics";

/**
 * Entry for the standalone release notes page, `/help/changelog`: every
 * version's player notes, newest first, each note whole. The notes are the
 * ones the update prompt shows, read from `CHANGELOG.md` at build time
 * (`allReleaseNotes` in `src/changelog.ts`, injected as `__RELEASE_NOTES__` by
 * vite.config.ts), so a player who tapped Update now, or skipped the prompt,
 * can still read what changed. Each version is a section whose id is the
 * version, so `/help/changelog#3.2.0` deep-links to it.
 *
 * Plain text only, as in the update prompt: the notes arrive already flattened
 * and lit auto-escapes them, so no markup from the file reaches the page. No
 * game code runs here. The page is kept out of the offline precache, like
 * `/help` and `/gallery`, so it always shows the latest deploy's notes.
 */

/** The version below which the file's sections were written after the fact
 *  (see the note at the top of CHANGELOG.md). */
const FIRST_SHIPPED_NOTES = "1.51.1";

/** This build's notes, or none outside a build (tests pass their own). */
const RELEASES: readonly ReleaseNotes[] = typeof __RELEASE_NOTES__ !== "undefined" ? __RELEASE_NOTES__ : [];

/** The page body: a lead, then one anchored section per version, inside the
 *  retro page shell. Pure, so the page test renders it directly. `fromGame`
 *  turns "Back to game" into closing this tab (see src/ui/fromGame.ts). */
export function releaseNotesPageTemplate(releases: readonly ReleaseNotes[], fromGame = false): TemplateResult {
  const body = html`
    <div class="page-lede">
      <h1>Release notes</h1>
      <p class="sub">Every update's changes, newest first, as the update prompt shows them.</p>
      <p>Notes for versions before ${FIRST_SHIPPED_NOTES} were written later, from the project's history, so no update showed them at the time.</p>
    </div>
    ${releases.length === 0
      ? html`<section class="help-section"><p>No release notes are available in this build.</p></section>`
      : releases.map(
          (r) => html`
      <section id=${r.version} class="help-section" aria-labelledby=${`v-${r.version}`}>
        <h2 id=${`v-${r.version}`}>${r.version}</h2>
        <ul>${r.notes.map((n) => html`<li>${n}</li>`)}</ul>
      </section>`,
        )}
  `;
  return pageShell({
    title: "Verticopolis: Release notes",
    backHref: "/",
    main: body,
    links: [
      { href: "/help", label: "How to Play" },
      { href: "/gallery", label: "Sprite Gallery" },
    ],
    fromGame,
  });
}

/** The section a `#<version>` fragment names, or null. A malformed escape in
 *  a hand-typed fragment (`#3.2%`) finds nothing rather than throwing, so the
 *  page still finishes loading. */
export function versionSection(hash: string, doc: Document = document): HTMLElement | null {
  if (hash.length < 2) return null;
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  return doc.getElementById(id);
}

function main(): void {
  injectVercelTelemetry();
  trackAppAction("page_changelog"); // landing on the standalone release notes page (host-gated inside)
  const root = document.getElementById("app");
  if (!root) return;
  const fallback = [...root.childNodes];
  render(releaseNotesPageTemplate(RELEASES, takeFromGameFlag(location, history)), root);
  for (const node of fallback) node.remove();
  // A fragment that names a version scrolls to it once the sections exist.
  versionSection(location.hash)?.scrollIntoView();
  (window as unknown as { releaseNotesReady: boolean }).releaseNotesReady = true;
}

main();

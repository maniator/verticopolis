// The title bar the three docs surfaces share: the player help site at
// verticopolis.com/help, the engine docs at docs.verticopolis.com, and the
// Rust API reference cargo doc writes under docs.verticopolis.com/rust/.
// Both Starlight sites draw it with src/components/TitleBar.astro (each
// site's Header override), scripts/rustdoc-chrome.mjs writes the same markup
// into rustdoc's pages, and src/styles/title-bar.css styles it in all three.
//
// The bar holds the logo and the site's name, the site's search where it has
// one, a button to the game, the GitHub link, and on a phone the one menu
// button. A phone shows the short name and the short button label; the full
// ones stay for screen readers.

/** The game. */
export const GAME = "https://verticopolis.com/";

export const GITHUB = "https://github.com/maniator/verticopolis";

// The GitHub mark, as Starlight's own header draws it.
export const GITHUB_ICON =
  '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.38c.6.12.83-.26.83-.57L9 21.07c-3.34.72-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.08-.74.09-.73.09-.73 1.2.09 1.83 1.24 1.83 1.24 1.08 1.83 2.81 1.3 3.5 1 .1-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.14-.3-.54-1.52.1-3.18 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.55 3.29-1.23 3.29-1.23.64 1.66.24 2.88.12 3.18a4.65 4.65 0 0 1 1.23 3.22c0 4.61-2.8 5.63-5.48 5.92.42.36.81 1.1.81 2.22l-.01 3.29c0 .31.2.69.82.57A12 12 0 0 0 12 .3Z"/></svg>';

export const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** A label written twice: in full, and the short form a phone shows. */
export function twoLengths(full, short) {
  return `<span class="vc-full">${escapeHtml(full)}</span><span class="vc-short" aria-hidden="true">${escapeHtml(short)}</span>`;
}

/** The site's name beside the logo. */
export function siteName(full, short) {
  return `<span class="vc-name" translate="no">${twoLengths(full, short)}</span>`;
}

/**
 * The bar's right-hand links: the button to the game and the GitHub mark.
 * The game button carries `data-game-link`, so the help site can turn it into
 * Back to game in a tab the game opened (help-site/src/components/Header.astro).
 */
export function barLinks({ game = GAME } = {}) {
  return (
    `<a class="vc-bar-game" href="${escapeHtml(game)}" data-game-link>${twoLengths("Play the game", "Play")}</a>` +
    `<a class="vc-bar-github" href="${GITHUB}"><span class="vc-sr-only">GitHub</span>${GITHUB_ICON}</a>`
  );
}

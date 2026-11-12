// What the help site's config and its tests share: where it lives, its side
// menu, and the script that sends an old /help#section link to its new page.

/** The site's path on verticopolis.com. */
export const HELP_BASE = "/help";

export const GITHUB_ISSUES = "https://github.com/maniator/verticopolis/issues/new/choose";

/** The share card's alt text, the same words as OG_IMAGE_ALT in the game's
 *  vite.config.ts (src/tests/helpSite.test.ts keeps the two equal). */
export const OG_IMAGE_ALT =
  "Verticopolis: an art-deco skyline at dusk with the tagline Build a SimTower-style skyscraper in your browser and a Play free call to action.";

/** The head tags every page of the game's own build shares (SHARED_HEAD_TAGS
 *  in vite.config.ts) that Starlight does not already write: the share card,
 *  the title bar color and the home screen icon. Starlight writes the title,
 *  description, canonical link, og:title, og:type, og:site_name, og:locale and
 *  twitter:card itself. */
export const sharedHead = [
  { tag: "meta", attrs: { name: "robots", content: "index, follow, max-image-preview:large" } },
  { tag: "meta", attrs: { property: "og:image", content: "https://verticopolis.com/og-image.png" } },
  { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
  { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
  { tag: "meta", attrs: { property: "og:image:alt", content: OG_IMAGE_ALT } },
  { tag: "meta", attrs: { name: "twitter:image", content: "https://verticopolis.com/og-image.png" } },
  { tag: "meta", attrs: { name: "twitter:image:alt", content: OG_IMAGE_ALT } },
  { tag: "meta", attrs: { name: "theme-color", content: "#000080" } },
  { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
];

/** Starlight's sidebar. A `slug` entry takes its label from the page's title.
 *  Starlight puts the site's base (/help) in front of every `link` that starts
 *  with a slash, so the release notes page (src/pages/changelog.astro) is
 *  "/changelog/", and the gallery, outside /help, climbs out of it
 *  ("/help/../gallery" is /gallery). */
export const sidebar = [
  { label: "How to Play", link: "/" },
  {
    label: "Guides",
    items: [
      { slug: "getting-started" },
      { slug: "going-further" },
      { slug: "classic-vs-modern" },
      { slug: "phones" },
      { slug: "keyboard" },
    ],
  },
  {
    label: "More",
    items: [
      { label: "Release notes", link: "/changelog/" },
      { label: "Sprite gallery", link: "/../gallery" },
      { label: "Report a problem", link: GITHUB_ISSUES, attrs: { target: "_blank", rel: "noopener noreferrer" } },
      { slug: "privacy" },
    ],
  },
];

/**
 * The old /help page was one long page with a section per topic
 * (/help#classic-vs-modern). Each topic is its own page now; this script, run
 * in every page's head, sends an old link to the new page before anything
 * draws, keeping the query (the game's ?from=game mark). `helpIds` maps an old
 * section id to its page's slug (each page's `helpId` front matter).
 */
export function oldAnchorRedirects(helpIds) {
  const map = JSON.stringify(helpIds);
  return `(function(){var p=location.pathname.replace(/\\/+$/,"");if(p!==${JSON.stringify(HELP_BASE)})return;var id=location.hash.slice(1);var to=Object.prototype.hasOwnProperty.call(${map},id)?${map}[id]:null;if(to)location.replace(${JSON.stringify(HELP_BASE + "/")}+to+"/"+location.search);})();`;
}

/**
 * The analytics landing a page view counts as: `page_changelog` on the release
 * notes, `page_help` on any other page, or null for a step from one help page
 * to another (a referrer under /help on the same site), so a visit counts once
 * however many pages it reads, as the old one-page /help did.
 */
export function landingAction(pathname, referrer, origin) {
  let from = null;
  try {
    const ref = new URL(referrer);
    if (ref.origin === origin) from = ref.pathname;
  } catch {
    // No referrer, or not a URL: a landing.
  }
  const inSite = (path) => path === HELP_BASE || path.startsWith(HELP_BASE + "/");
  if (from !== null && inSite(from)) return null;
  return /^\/help\/changelog\/?$/.test(pathname) ? "page_changelog" : "page_help";
}

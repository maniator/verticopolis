// What the help site's config and its tests share: where it lives, its side
// menu, and the script that sends an old /help#section link to its new page.

/** The site's path on verticopolis.com. */
export const HELP_BASE = "/help";

/** The engine developer docs (docs/engine-site), for players who want the
 *  rules as code. */
export const ENGINE_DOCS = "https://docs.verticopolis.com/";

export const GITHUB_ISSUES = "https://github.com/maniator/verticopolis/issues/new/choose";

/** The head tags every page of the game's own build shares (SHARED_HEAD_TAGS
 *  in vite.config.ts) that Starlight does not already write: the share card's
 *  size, the title bar color and the home screen icon. Starlight writes the
 *  title, description, canonical link, og:title, og:type, og:site_name,
 *  og:locale and twitter:card itself, and the Head override
 *  (src/components/Head.astro) writes each page's own card and its alt text
 *  ({@link cardUrl}, {@link cardAlt}). */
export const sharedHead = [
  { tag: "meta", attrs: { name: "robots", content: "index, follow, max-image-preview:large" } },
  { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
  { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
  { tag: "meta", attrs: { name: "theme-color", content: "#000080" } },
  { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
];

/** Starlight's sidebar. A `slug` entry takes its label from the page's title.
 *  Starlight puts the site's base (/help) in front of every `link` that starts
 *  with a slash, so the release notes page (src/pages/changelog.astro) is
 *  "/changelog/". */
export const sidebar = [
  { label: "How to Play", link: "/" },
  {
    label: "Getting started",
    items: [{ slug: "first-tower" }, { slug: "classic-vs-modern" }, { slug: "controls" }],
  },
  {
    label: "Your towers",
    items: [{ slug: "your-towers/saving" }, { slug: "your-towers/importing-exporting" }, { slug: "your-towers/installing" }, { slug: "your-towers/settings" }],
  },
  {
    label: "Rooms",
    items: [
      { label: "All rooms", slug: "rooms" },
      { slug: "rooms/offices" },
      { slug: "rooms/homes" },
      { slug: "rooms/hotels" },
      { slug: "rooms/food-and-shops" },
      { slug: "rooms/venues" },
      { slug: "rooms/services" },
      { slug: "rooms/wedding-hall" },
    ],
  },
  {
    label: "Building",
    items: [
      { slug: "building/floors-and-lobbies" },
      { slug: "building/elevators" },
      { slug: "building/stairs-and-escalators" },
      { slug: "building/limits" },
      { slug: "building/bulldoze-and-undo" },
    ],
  },
  {
    label: "How the tower works",
    items: [
      { slug: "tower/money" },
      { slug: "tower/people" },
      { slug: "tower/ratings" },
      { slug: "tower/stars" },
      { slug: "tower/clock" },
      { slug: "tower/events" },
      { slug: "tower/map-and-windows" },
    ],
  },
  {
    label: "More",
    items: [
      { label: "Release notes", link: "/changelog/" },
      { label: "Engine docs", link: ENGINE_DOCS, attrs: { target: "_blank", rel: "noopener noreferrer" } },
      { label: "Report a problem", link: GITHUB_ISSUES, attrs: { target: "_blank", rel: "noopener noreferrer" } },
      { slug: "privacy" },
    ],
  },
];

/**
 * Where each section of the old one-page /help went (its `/help#id` anchor,
 * as the game and old links name it). "going-further" and "about" stay on the
 * front page, which links to everything they covered.
 */
export const OLD_ANCHORS = {
  basics: "first-tower",
  "classic-vs-modern": "classic-vs-modern",
  touch: "controls",
  keyboard: "controls",
  privacy: "privacy",
};

/**
 * The old /help page was one long page with a section per topic
 * (/help#classic-vs-modern). Each topic is its own page now; this script, run
 * in every page's head, sends an old link to the new page before anything
 * draws, keeping the query (the game's ?from=game mark). `helpIds` maps an old
 * section id to its page's slug ({@link OLD_ANCHORS}).
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

/** The longest page path `helpPageDetail` reports; today's longest is
 *  under 40 characters. */
const MAX_PAGE_DETAIL = 80;

/**
 * The page a help page view reports in its `help_page_view` event's `detail`:
 * the path under /help without its slashes ("rooms/hotels"), "home" for the
 * front page, or "other" for a path that is not a plain lowercase page path,
 * so a mistyped or crafted address never reaches PostHog as free text. Only
 * the path is read: the query (the game's ?from=game mark) and the hash stay
 * out of it.
 */
export function helpPageDetail(pathname) {
  const inSite = pathname === HELP_BASE || pathname.startsWith(HELP_BASE + "/");
  if (!inSite) return "other";
  const slug = pathname.slice(HELP_BASE.length).replace(/^\/+|\/+$/g, "");
  if (slug === "") return "home";
  return slug.length <= MAX_PAGE_DETAIL && /^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(slug) ? slug : "other";
}

/** The site's address, for the structured data below. */
const SITE_ORIGIN = "https://verticopolis.com";

/** The section folders and the names a breadcrumb shows for them. Only a
 *  folder with an index page of its own (rooms) gets a crumb, since every
 *  crumb but the last has to link somewhere. */
const SECTION_NAMES = {
  rooms: "Rooms",
  building: "Building",
  tower: "How the tower works",
  "your-towers": "Your towers",
};

/** A page's share card file, in help-site/public/cards/: the page's slug with
 *  its slashes as dashes, and `index` for the front page. The cards are drawn
 *  by scripts/gen-help-cards.mjs and committed. */
export function cardFile(slug) {
  return `${slug ? slug.replace(/\//g, "-") : "index"}.png`;
}

/** The full URL of a page's share card, for og:image and twitter:image. */
export function cardUrl(slug) {
  return `${SITE_ORIGIN}${HELP_BASE}/cards/${cardFile(slug)}`;
}

/** A page's share card alt text: what the picture shows. */
export function cardAlt(title) {
  return `${title}, from the Verticopolis player's manual, over an art-deco skyline at dusk.`;
}

/**
 * The schema.org structured data for one help page, as the object a
 * `<script type="application/ld+json">` carries: a breadcrumb trail from the
 * help home for every page, plus a WebSite on the home page and an Article on
 * every other page, so search results can show where a page sits and what it
 * is about. `slug` is the page's Starlight id ("" for the home page,
 * "rooms/hotels" for a room page); `hasIndex` says which section folders
 * have a page of their own.
 */
export function pageJsonLd({ slug, title, description, hasIndex = ["rooms"] }) {
  const url = (path) => `${SITE_ORIGIN}${HELP_BASE}/${path ? `${path}/` : ""}`;
  const crumbs = [{ name: "Help", item: url("") }];
  const parts = slug ? slug.split("/") : [];
  if (parts.length > 1) {
    const section = parts[0];
    const name = SECTION_NAMES[section] ?? section;
    if (hasIndex.includes(section)) crumbs.push({ name, item: url(section) });
  }
  if (slug) crumbs.push({ name: title, item: url(slug) });
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, ...c })),
  };
  const game = { "@type": "VideoGame", name: "Verticopolis", url: `${SITE_ORIGIN}/` };
  const page = slug
    ? { "@type": "Article", headline: title, description, url: url(slug), inLanguage: "en-US", about: game, isPartOf: { "@type": "WebSite", name: "Verticopolis Help", url: url("") } }
    : { "@type": "WebSite", name: "Verticopolis Help", description, url: url(""), inLanguage: "en-US", about: game };
  return { "@context": "https://schema.org", "@graph": [page, breadcrumb] };
}

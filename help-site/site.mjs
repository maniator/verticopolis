// What the help site's config and its tests share: where it lives, its side
// menu, and the script that sends an old /help#section link to its new page.

/** The manual's own host, help.verticopolis.com, in a production build
 *  (scripts/vercel-build.sh sets VC_HELP_ORIGIN there), or empty in every
 *  other build: a preview, staging, CI and a local build keep the manual under
 *  /help on the game's host, which is the only host they have. Read at build
 *  time; in a page's script `process` is absent and this is empty, so browser
 *  code takes the base from Astro (`import.meta.env.BASE_URL`) instead. */
export const HELP_ORIGIN = globalThis.process?.env?.VC_HELP_ORIGIN ?? "";

/** The site's path: the root of its own host, or /help on the game's. */
export const HELP_BASE = HELP_ORIGIN ? "" : "/help";

/** The game's address as the manual links it: the game's own host when the
 *  manual has a host of its own, else the same host (an empty prefix). */
export const GAME_ORIGIN = HELP_ORIGIN ? "https://verticopolis.com" : "";

/**
 * A link as the help pages write it, `/` and other root paths for the game
 * and `/help/...` for the manual, as this build serves it: a manual path
 * moves under {@link HELP_BASE}, and a game path goes to {@link GAME_ORIGIN}.
 * Any other link (another site, a #section, a relative path) is left alone.
 * The Markdown keeps writing /help/... because the game's own Help window
 * reads the same files.
 */
export function siteHref(href, base = HELP_BASE, gameOrigin = GAME_ORIGIN) {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const manual = href.match(/^\/help(?=[/?#]|$)(.*)$/);
  if (!manual) return gameOrigin + href;
  const rest = manual[1].startsWith("/") ? manual[1] : `/${manual[1]}`;
  return base + rest;
}

/** The engine developer docs (docs/engine-site), for players who want the
 *  rules as code. */
export const ENGINE_DOCS = "https://docs.verticopolis.com/";

export const GITHUB_ISSUES = "https://github.com/maniator/verticopolis/issues/new/choose";

/** The owner's GitHub Sponsors page, the tip jar the game's splash also links
 *  (SPONSOR_URL in src/ui/splashTemplate.ts; a test holds the two equal). */
export const SPONSOR_URL = "https://github.com/sponsors/maniator";

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
  { tag: "meta", attrs: { name: "theme-color", content: "#c0c0c0" } },
  { tag: "link", attrs: { rel: "apple-touch-icon", href: `${GAME_ORIGIN}/apple-touch-icon.png` } },
];

/** Starlight's sidebar. A `slug` entry takes its label from the page's title.
 *  Starlight puts the site's base (/help) in front of every `link` that starts
 *  with a slash, so the release notes page (src/pages/changelog.astro) is
 *  "/changelog/". */
export const sidebar = [
  { label: "How to Play", link: "/" },
  {
    label: "Getting started",
    items: [{ slug: "first-tower" }, { slug: "classic-vs-modern" }, { slug: "differences" }, { slug: "controls" }, { slug: "desktop" }],
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
      { label: "Sponsor Verticopolis", link: SPONSOR_URL, attrs: { target: "_blank", rel: "noopener noreferrer" } },
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

/** The appearance schemes the game offers besides Standard
 *  (src/ui/appearance/appearancePrefs.ts), and where the manual keeps the one
 *  it wears on its own host. */
export const HELP_SCHEMES = ["skyline", "high_contrast"];
export const HELP_SCHEME_KEY = "vc.appearance";

/**
 * The manual wears the game's appearance scheme (owner, 2026-11-17). An inline
 * head script, so the page is dressed before it paints: a page the game opened
 * (`?from=game`) wears the `scheme` the link names, Standard when it names
 * none, and keeps that on this host; any other visit wears the kept one. It
 * sets `data-scheme` on `<html>`, which the game's retro-tokens.css and
 * src/styles/help-schemes.css key on. Blocked storage only loses the memory.
 */
export function schemeBootScript() {
  const known = JSON.stringify(HELP_SCHEMES);
  const key = JSON.stringify(HELP_SCHEME_KEY);
  return `(function(){try{var k=${key},ok=${known},q=new URLSearchParams(location.search),s=null;if(q.get("from")==="game"){s=q.get("scheme");if(ok.indexOf(s)<0)s=null;try{localStorage.setItem(k,s||"standard")}catch(e){}}else{try{s=localStorage.getItem(k)}catch(e){}if(ok.indexOf(s)<0)s=null}if(s)document.documentElement.setAttribute("data-scheme",s)}catch(e){}})();`;
}

/**
 * Whether a link points at the Sponsors page, so the help site's click
 * listener can count it as a `sponsor_click` app action (detail "help"). It
 * matches the sidebar's "Sponsor Verticopolis" entry and any page text that
 * links the same address, with or without a trailing slash or query.
 */
export function isSponsorLink(href) {
  try {
    const url = new URL(href);
    return url.origin + url.pathname.replace(/\/+$/, "") === SPONSOR_URL;
  } catch {
    return false;
  }
}

/** `MouseEvent.button` for the middle (wheel) button, the one that opens a
 *  link in a new tab; the right button's `auxclick` opens a menu instead. */
const MIDDLE_BUTTON = 1;

/**
 * The help site's `click` and `auxclick` listener for Sponsor taps: it calls
 * `track` once for a click, keyboard Enter or middle-click on any link to the
 * Sponsors page (the sidebar entry or a page's own text), and never for a
 * right-click or any other link. The link itself opens as before.
 */
export function sponsorTapListener(track) {
  return (e) => {
    if (e.type === "auxclick" && e.button !== MIDDLE_BUTTON) return;
    const link = e.target?.closest?.("a[href]");
    if (link && isSponsorLink(link.href)) track();
  };
}

/**
 * The analytics landing a page view counts as: `page_changelog` on the release
 * notes, `page_help` on any other page, or null for a step from one help page
 * to another (a referrer under the site's base on the same host), so a visit counts once
 * however many pages it reads, as the old one-page /help did.
 */
export function landingAction(pathname, referrer, origin, base = HELP_BASE) {
  let from = null;
  try {
    const ref = new URL(referrer);
    if (ref.origin === origin) from = ref.pathname;
  } catch {
    // No referrer, or not a URL: a landing.
  }
  const inSite = (path) => path === base || path.startsWith(base + "/");
  if (from !== null && inSite(from)) return null;
  return /^\/changelog\/?$/.test(pathname.slice(base.length)) ? "page_changelog" : "page_help";
}

/** The longest page path `helpPageDetail` reports; today's longest is
 *  under 40 characters. */
const MAX_PAGE_DETAIL = 80;

/**
 * The page a help page view reports in its `help_page_view` event's `detail`:
 * the path under the site's base (`base`, /help or the root) without its slashes ("rooms/hotels"), "home" for the
 * front page, or "other" for a path that is not a plain lowercase page path.
 * The pattern checks only the format, so a well-formed but unknown slug
 * passes it. What keeps a mistyped or crafted address out of
 * PostHog is the help site's disabled 404 page (`disable404Route` in
 * astro.config.mjs): only built help pages run this script, and any other
 * /help/... address gets the game's own 404 page, which does not. Enabling a
 * help 404 page would let such a slug through, so check it against the built
 * page list first. Only the path is read: the query (the game's ?from=game
 * mark) and the hash stay out of it.
 */
export function helpPageDetail(pathname, base = HELP_BASE) {
  const inSite = pathname === base || pathname.startsWith(base + "/");
  if (!inSite) return "other";
  const slug = pathname.slice(base.length).replace(/^\/+|\/+$/g, "");
  if (slug === "") return "home";
  return slug.length <= MAX_PAGE_DETAIL && /^[a-z0-9-]+(\/[a-z0-9-]+)*$/.test(slug) ? slug : "other";
}

/**
 * The `help_game_link` detail of a press on a link to the game (owner,
 * 2026-11-16: every new button reports): where it sits, `bar` for the title
 * bar's button and `front` for the front page's Play, then what it does,
 * `back` in a tab the game opened (Back to game closes the tab) and `play`
 * otherwise (it loads the game). `inFrontPage` is whether the link sits in
 * the front page's title screen.
 */
export function gameLinkDetail(inFrontPage, fromGame) {
  return `${inFrontPage ? "front" : "bar"}_${fromGame ? "back" : "play"}`;
}

/** The site's address, for its canonical links and the structured data
 *  below: its own host, or the game's with the manual under /help. */
export const SITE_ORIGIN = HELP_ORIGIN || "https://verticopolis.com";

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

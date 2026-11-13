/**
 * Draws the help site's share cards: one 1200x630 picture per page, with the
 * page's title and description over the "Metropolis Dusk" skyline of the
 * game's own card (scripts/gen-og-image.mjs). A help link shared on a forum or
 * in a chat shows the page it opens, not the game's front-page card. The page
 * head points at them (help-site/src/components/Head.astro, site.mjs cardUrl).
 *
 * The cards are committed to help-site/public/cards/, so the help build needs
 * no browser. Each run also records the title and description every card was
 * drawn from in help-site/share-cards.json (scripts/help-card-pages.mjs).
 * src/tests/helpSite.test.ts fails when a page has no card, a card is left
 * over, or a page's title or description no longer matches its card's record,
 * and help-site.yml checks every built page names its own.
 * Text is live, so render them in the pinned Playwright image, as the
 * screenshots are, to keep the fonts the same:
 *
 *   PW_CHROME=... node scripts/gen-help-cards.mjs           # every page
 *   PW_CHROME=... node scripts/gen-help-cards.mjs rooms/hotels   # one page
 */
// copies-package: none
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { FONT, GOLD, INDIGO, INK, PLUM, CORAL, TOWER, tower } from "./gen-og-image.mjs";
import { cardFile } from "../help-site/site.mjs";
import { CARD_MANIFEST, cardManifest, helpPages } from "./help-card-pages.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "help-site/public/cards");
const SANDBOX_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXECUTABLE = process.env.PW_CHROME || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : undefined);

const W = 1200;
const H = 630;
const GROUND = 520;

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The skyline at the card's right, on the ground line. */
function backdrop() {
  const skyline = tower(870, 120, 250, GROUND, "#241a4a") + tower(1110, 120, 230, GROUND, "#241a4a") + tower(990, 170, 340, GROUND, TOWER);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${INDIGO}"/>
        <stop offset="0.55" stop-color="${PLUM}"/>
        <stop offset="1" stop-color="${CORAL}"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#dusk)"/>
    <circle cx="990" cy="250" r="120" fill="${GOLD}" opacity="0.9"/>
    ${skyline}
    <rect x="0" y="${GROUND}" width="${W}" height="${H - GROUND}" fill="${INK}"/>
  </svg>`;
}

/** The card's page: the backdrop, the wordmark, the title, the description and the address. */
function cardHtml(page) {
  const path = `verticopolis.com/help/${page.slug ? `${page.slug}/` : ""}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${W}px; height: ${H}px; overflow: hidden; font-family: ${FONT}; }
    .bg { position: absolute; inset: 0; }
    .text { position: absolute; left: 64px; top: 56px; width: 700px; }
    .kicker { font-size: 30px; font-weight: 800; letter-spacing: 3px; color: #fff; }
    .kicker b { color: ${GOLD}; }
    .kicker sup { font-size: 14px; font-weight: 600; letter-spacing: 0; vertical-align: 14px; }
    .kicker span { font-weight: 500; color: #d7d2f0; letter-spacing: 2px; }
    h1 { margin-top: 28px; font-size: 68px; line-height: 1.08; font-weight: 800; color: #fff;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    p { margin-top: 24px; font-size: 29px; line-height: 1.32; color: #e4e0f7;
      display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .addr { position: absolute; left: 64px; top: ${GROUND + 36}px; font-size: 28px; font-weight: 500; letter-spacing: 1px; color: #d7d2f0; }
  </style></head><body>
    <div class="bg">${backdrop()}</div>
    <div class="text">
      <div class="kicker">VERTICO<b>POLIS</b><sup>™</sup> <span>· HELP</span></div>
      <h1>${escapeHtml(page.title)}</h1>
      <p>${escapeHtml(page.description)}</p>
    </div>
    <div class="addr">${escapeHtml(path)}</div>
  </body></html>`;
}

async function main() {
  const only = process.argv.slice(2);
  const all = await helpPages();
  const pages = all.filter((p) => only.length === 0 || only.includes(p.slug));
  if (pages.length === 0) throw new Error(`no help page is named ${only.join(", ")}`);
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  try {
    const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    for (const page of pages) {
      await tab.setContent(cardHtml(page), { waitUntil: "load" });
      const png = await tab.screenshot({ type: "png" });
      await writeFile(join(OUT_DIR, cardFile(page.slug)), png);
      console.log(`wrote cards/${cardFile(page.slug)}`);
    }
  } finally {
    await browser.close();
  }
  const previous = existsSync(CARD_MANIFEST) ? JSON.parse(await readFile(CARD_MANIFEST, "utf8")) : {};
  await writeFile(CARD_MANIFEST, `${JSON.stringify(cardManifest(all, pages, previous), null, 2)}\n`);
  console.log(`wrote ${CARD_MANIFEST.slice(ROOT.length + 1)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

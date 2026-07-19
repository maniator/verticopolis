/**
 * Generates the social share card (`src/public/og-image.png`, 1200x630) from an
 * in-code SVG, in keeping with the project's "every pixel drawn in code" ethos.
 * This is the image search engines and social platforms (Open Graph / Twitter
 * cards) show when a verticopolis.com link is shared.
 *
 * It reuses the "Metropolis Dusk" identity from the app icons and splash: a
 * stepped art-deco skyline of lit towers under an indigo -> plum -> coral dusk,
 * with the wordmark and a one-line pitch. It is NOT part of the drift-checked
 * `docs/screenshots/**` gallery or the visual baselines, so no PR gate blocks a
 * refresh. The card does render live text, though, so regenerate it in the same
 * Linux render container as the screenshots (or any host with the pinned fonts
 * below installed) to keep the output reproducible; the SVG source is the truth.
 *
 * Rasterized with the same headless Chromium the icon/screenshot harness uses,
 * so it needs no new image dependency. Output lands in src/public/ (Vite's
 * publicDir) and is committed, so `npm run build` needs no browser.
 *
 *   node scripts/gen-og-image.mjs                 # host (uses Playwright's browser)
 *   PW_CHROME=... node scripts/gen-og-image.mjs   # explicit browser (docker/CI)
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../src/public");
const OUT = resolve(OUT_DIR, "og-image.png");
// Browser resolution mirrors scripts/screenshot-env.ts: PW_CHROME wins (the CI
// container points it at the image's Chromium), else use the sandbox path only
// when it exists, else fall back to Playwright's own bundled browser so a normal
// `playwright install` checkout can run `npm run og-image` without any override.
const SANDBOX_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXECUTABLE = process.env.PW_CHROME || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : undefined);

const W = 1200;
const H = 630;

// Pin to fonts that ship in the Linux render container (and the Playwright/CI
// Linux images): Liberation Sans, with DejaVu Sans as a present-everywhere
// fallback. Naming host-only faces like Trebuchet MS or Segoe UI would make the
// committed PNG depend on who regenerated it, so regenerate this card in the
// Linux container (as with the screenshots) to keep its output reproducible.
const FONT = "'Liberation Sans', 'DejaVu Sans', sans-serif";

// "Metropolis Dusk" palette (matches the splash, wordmark, and app icons).
const INDIGO = "#1b1b40";
const PLUM = "#37285a";
const CORAL = "#ef6b5e";
const GOLD = "#ffc94a"; // lit windows / sun
const CROWN = "#ffe6a0"; // antenna beacon
const TOWER = "#140f2e"; // tower silhouette
const INK = "#0d0a22"; // deep foreground

/**
 * One stepped art-deco tower with lit gold windows, sitting on the ground line.
 * @param {number} cx    horizontal center
 * @param {number} baseW footprint width
 * @param {number} totalH tower height
 * @param {number} ground y of the ground line
 * @param {string} body   silhouette fill
 */
function tower(cx, baseW, totalH, ground, body) {
  const tiers = [
    { w: 1.0, h: 0.34, cols: 4 },
    { w: 0.72, h: 0.28, cols: 3 },
    { w: 0.46, h: 0.26, cols: 2 },
    { w: 0.16, h: 0.12, cols: 0 }, // spire
  ];
  let y = ground;
  let out = "";
  let spireTop = ground;
  for (const t of tiers) {
    const w = baseW * t.w;
    const h = totalH * t.h;
    const x = cx - w / 2;
    y -= h;
    spireTop = y;
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${body}"/>`;
    if (t.cols) {
      const rows = Math.max(2, Math.round(h / 26));
      const gx = w * 0.16;
      const gy = h * 0.16;
      const cw = (w - gx * (t.cols + 1)) / t.cols;
      const chh = (h - gy * (rows + 1)) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < t.cols; c++) {
          // Leave a few windows dark so the skyline reads as lived-in.
          if ((r + c) % 5 === 0) continue;
          const wx = x + gx + c * (cw + gx);
          const wy = y + gy + r * (chh + gy);
          out += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${cw.toFixed(1)}" height="${chh.toFixed(1)}" fill="${GOLD}" opacity="0.9"/>`;
        }
      }
    }
  }
  // Antenna + beacon on the spire.
  out += `<line x1="${cx}" y1="${(spireTop - 40).toFixed(1)}" x2="${cx}" y2="${spireTop.toFixed(1)}" stroke="${body}" stroke-width="6"/>`;
  out += `<circle cx="${cx}" cy="${(spireTop - 44).toFixed(1)}" r="7" fill="${CROWN}"/>`;
  return out;
}

function svg() {
  const ground = 470;
  const sunY = 250;
  // A back-to-front skyline: shorter, dimmer towers behind the hero tower.
  const skyline =
    tower(250, 150, 300, ground, "#241a4a") +
    tower(980, 150, 280, ground, "#241a4a") +
    tower(430, 130, 250, ground, "#1c1540") +
    tower(790, 130, 260, ground, "#1c1540") +
    tower(615, 210, 400, ground, TOWER); // hero tower, dead center

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${INDIGO}"/>
        <stop offset="0.55" stop-color="${PLUM}"/>
        <stop offset="1" stop-color="${CORAL}"/>
      </linearGradient>
      <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${INK}"/>
        <stop offset="1" stop-color="#05040f"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#dusk)"/>
    <circle cx="615" cy="${sunY}" r="150" fill="${GOLD}" opacity="0.9"/>
    ${skyline}
    <rect x="0" y="${ground}" width="${W}" height="${H - ground}" fill="url(#fg)"/>
    <text x="60" y="${ground + 68}" font-family="${FONT}" font-size="70" font-weight="800" letter-spacing="2" fill="#ffffff">VERTICO<tspan fill="${GOLD}">POLIS</tspan></text>
    <text x="64" y="${ground + 120}" font-family="${FONT}" font-size="30" font-weight="500" letter-spacing="1" fill="#d7d2f0">Build a SimTower-style skyscraper, free in your browser.</text>
  </svg>`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><html><head><style>*{margin:0;padding:0}html,body{width:${W}px;height:${H}px;overflow:hidden}</style></head><body>${svg()}</body></html>`,
      { waitUntil: "networkidle" },
    );
    await page.screenshot({ path: OUT, omitBackground: false });
    await page.close();
    console.log(`wrote ${OUT} (${W}x${H})`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

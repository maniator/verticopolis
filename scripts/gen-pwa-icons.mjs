/**
 * Generates the app icons (favicon + PWA + apple-touch) from an in-code SVG —
 * no external art assets, in keeping with the project's "every sprite drawn in
 * code" ethos.
 *
 * The Verticopolis mark: a stepped art-deco tower with lit gold windows and a
 * setting sun, on an indigo → plum → coral "Metropolis Dusk" sky — the same
 * identity as the top-bar wordmark and the first-run splash.
 *
 * Rasterized with the same headless Chromium the screenshot harness uses, so
 * this needs no new image dependency. Outputs land in src/public/ (Vite's
 * publicDir) and are committed, so `npm run build` needs no browser.
 *
 *   node scripts/gen-pwa-icons.mjs                 # host
 *   PW_CHROME=... node scripts/gen-pwa-icons.mjs   # docker/CI
 */
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../src/public");
const EXECUTABLE = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// "Metropolis Dusk" palette (matches the splash + wordmark).
const INDIGO = "#1b1b40";
const PLUM = "#37285a";
const CORAL = "#ef6b5e";
const GOLD = "#ffc94a"; // lit windows / sun
const CROWN = "#ffe6a0"; // antenna beacon
const TOWER = "#140f2e"; // tower silhouette

/**
 * @param {number} size    output pixel size
 * @param {boolean} maskable  keep art inside the maskable safe zone (center ~80%)
 */
function svg(size, maskable) {
  // The dusk sky bleeds to every edge; the tower stays inside the safe zone so
  // maskable crops never clip it.
  const pad = 512 * (maskable ? 0.17 : 0.06);
  const cx = 256;
  const ground = 512 - pad;
  const top = pad + (maskable ? 44 : 22);
  const H = ground - top;
  const safeW = 512 - pad * 2;

  // Stepped art-deco tiers, base (widest) → spire.
  const tiers = [
    { w: 0.42, h: 0.3, cols: 4, rows: 3 },
    { w: 0.31, h: 0.24, cols: 3, rows: 3 },
    { w: 0.2, h: 0.24, cols: 2, rows: 3 },
    { w: 0.085, h: 0.22, cols: 0, rows: 0 }, // spire
  ];

  let y = ground;
  let rects = "";
  let windows = "";
  for (const t of tiers) {
    const w = safeW * t.w;
    const h = H * t.h;
    const x = cx - w / 2;
    y -= h;
    rects += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${TOWER}"/>`;
    if (t.cols) {
      const gx = w * 0.16;
      const gy = h * 0.18;
      const cw = (w - gx * (t.cols + 1)) / t.cols;
      const chh = (h - gy * (t.rows + 1)) / t.rows;
      for (let r = 0; r < t.rows; r++) {
        for (let c = 0; c < t.cols; c++) {
          const wx = x + gx + c * (cw + gx);
          const wy = y + gy + r * (chh + gy);
          windows += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="${cw.toFixed(1)}" height="${chh.toFixed(1)}" fill="${GOLD}"/>`;
        }
      }
    }
  }
  const spireTop = y;
  const sunR = safeW * 0.26;
  const sunY = ground - H * 0.4;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${INDIGO}"/>
        <stop offset="0.52" stop-color="${PLUM}"/>
        <stop offset="1" stop-color="${CORAL}"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#dusk)"/>
    <circle cx="256" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="${GOLD}" opacity="0.92"/>
    <line x1="256" y1="${(spireTop - 34).toFixed(1)}" x2="256" y2="${spireTop.toFixed(1)}" stroke="${TOWER}" stroke-width="7"/>
    <circle cx="256" cy="${(spireTop - 38).toFixed(1)}" r="9" fill="${CROWN}"/>
    ${rects}
    ${windows}
  </svg>`;
}

const TARGETS = [
  { name: "pwa-192x192.png", size: 192, maskable: false },
  { name: "pwa-512x512.png", size: 512, maskable: false },
  { name: "pwa-maskable-512x512.png", size: 512, maskable: true },
  { name: "apple-touch-icon.png", size: 180, maskable: false },
  { name: "favicon.png", size: 64, maskable: false },
  // The desktop icon master (#761). Not referenced by the manifest: the PWA
  // needs nothing this large, but macOS icns wants a true 1024 (ic10) and
  // the mark is an in-code SVG, so the "art gap" was only ever the largest
  // size this list emitted. The private packager prefers this over the 512
  // when the dist carries it.
  { name: "icon-1024x1024.png", size: 1024, maskable: false },
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  try {
    for (const t of TARGETS) {
      const page = await browser.newPage({
        viewport: { width: t.size, height: t.size },
        deviceScaleFactor: 1,
      });
      const markup = svg(t.size, t.maskable);
      await page.setContent(
        `<!doctype html><html><head><style>*{margin:0;padding:0}html,body{width:${t.size}px;height:${t.size}px;overflow:hidden}</style></head><body>${markup}</body></html>`,
        { waitUntil: "networkidle" },
      );
      const out = resolve(OUT_DIR, t.name);
      await page.screenshot({ path: out, omitBackground: false });
      await page.close();
      console.log(`wrote ${out} (${t.size}px${t.maskable ? ", maskable" : ""})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

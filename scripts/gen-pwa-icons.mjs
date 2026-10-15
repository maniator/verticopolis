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
// copies-package: none
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { iconSvg } from "./app-icon-svg.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../src/public");
const EXECUTABLE = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

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
      const markup = iconSvg(t.size, t.maskable);
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

/**
 * Captures the build-palette unlock-visibility feature: the palette HIDES
 * locked facilities until their star tier is reached (parity with the 1994
 * original), so the toolbar GROWS as the tower earns stars rather than showing
 * a menu of dimmed, unbuildable tools.
 *
 * Shots (docs/screenshots/features/):
 *   1. palette-1star.png  — a fresh 1★ tower: only 1★ tools; no Leisure/
 *                           Services/Special headers.
 *   2. palette-3star.png  — 3★: Leisure & Services appear, 2★/3★ rows revealed.
 *   3. palette-5star.png  — 5★: the full palette, every tier unlocked.
 *   4. palette-unlock.png — the three stacked into one captioned figure (a
 *                           single image sidesteps adjacent-URL markdown mangling).
 *
 * Assumes a static server is serving the built app at BASE_URL (see
 * `vite preview`). Mirrors scripts/shot-condo-modes.mjs conventions: drives the
 * live `window.game`, deterministic, no per-tick reliance (star is set directly
 * and the palette refreshed via the public ui.update()).
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../docs/screenshots/features");
const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXECUTABLE = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

mkdirSync(OUT, { recursive: true });

/** Set the tower's star rating and refresh the palette to it. isUnlocked() keys
 *  off star alone, so no built tower is needed to show the palette's unlock set. */
function showPaletteAtStar(star) {
  const g = window.game;
  g.sim.star = star;
  g.ui.update(g.sim);
  // Expand the scroll container to its natural height so the full list is in
  // frame (the shipped panel scrolls); a capture-time style tweak only.
  const aside = document.getElementById("palette");
  const scroll = document.getElementById("palette-scroll");
  for (const el of [aside, scroll]) {
    el.style.height = "auto";
    el.style.maxHeight = "none";
    el.style.overflow = "visible";
  }
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  // Desktop width so the palette is the vertical docked sidebar (the mobile
  // layout is a horizontal bottom strip that can't show the full growing list).
  const page = await browser.newPage({ viewport: { width: 1280, height: 1280 }, deviceScaleFactor: 2 });
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.game, null, { timeout: 10000 });

  // Clear the first-run splash / onboarding overlays so the palette is unobscured.
  await page.evaluate(() => {
    try {
      localStorage.setItem("tt.onboarded", "1");
    } catch {
      /* ignore */
    }
    document.getElementById("splash")?.remove();
    document.getElementById("onboard")?.remove();
    document.querySelectorAll(".tt-pulse").forEach((n) => n.classList.remove("tt-pulse"));
  });

  const stars = [1, 3, 5];
  for (const star of stars) {
    await page.evaluate(showPaletteAtStar, star);
    await page.waitForTimeout(150);
    await page.locator("#palette").screenshot({ path: `${OUT}/palette-${star}star.png` });
    console.log(`captured palette-${star}star`);
  }

  // Stack the three into one captioned figure for the PR body / gallery.
  const dataUri = (f) => "data:image/png;base64," + readFileSync(`${OUT}/${f}`).toString("base64");
  const composite = await browser.newPage({ viewport: { width: 900, height: 640 }, deviceScaleFactor: 2 });
  await composite.setContent(
    `<style>
       *{margin:0;box-sizing:border-box}
       body{background:#c9c6be;padding:20px;font:600 13px system-ui,Segoe UI,Arial;color:#20203a;width:900px}
       .row{display:flex;gap:18px;align-items:flex-start}
       figure{margin:0;flex:1}
       figcaption{padding:6px 2px 8px;line-height:1.35}
       img{display:block;width:100%;border:1px solid #7a7a7a;background:#fff}
     </style>
     <div class="row">
       <figure><figcaption>1★ — only 1★ tools; Leisure/Services/Special headers hidden</figcaption>
         <img src="${dataUri("palette-1star.png")}"></figure>
       <figure><figcaption>3★ — Leisure &amp; Services appear; 2★/3★ rows revealed</figcaption>
         <img src="${dataUri("palette-3star.png")}"></figure>
       <figure><figcaption>5★ — the full palette, every tier unlocked</figcaption>
         <img src="${dataUri("palette-5star.png")}"></figure>
     </div>`,
    { waitUntil: "networkidle" },
  );
  await composite.waitForTimeout(150);
  await (await composite.$("body")).screenshot({ path: `${OUT}/palette-unlock.png` });
  console.log("captured palette-unlock (combined)");

  await browser.close();
  console.log("Done. Screenshots in", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

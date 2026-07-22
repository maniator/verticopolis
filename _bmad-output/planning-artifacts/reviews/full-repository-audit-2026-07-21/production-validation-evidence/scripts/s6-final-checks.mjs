/**
 * Final micro-checks: (a) /?src=twa analytics observation (AUD-036 observable
 * half) — capture all analytics-shaped requests on a marked load; (b)
 * #stat-money computed colors + WCAG contrast ratio (PROD-002 verification).
 */
import fs from "node:fs";
import { launch, attachCollectors, waitGameReady, saveJson, log, summarizeBucket, ORIGIN } from "./common.mjs";

const { ctx, profileDir } = await launch({ profile: "fresh" });
const bucket = {};
const page = ctx.pages()[0] ?? (await ctx.newPage());
attachCollectors(page, bucket);

const analyticsReqs = [];
page.on("request", (r) => {
  const u = r.url();
  if (/insights|analytics|posthog|telemetry|_vercel|collect|beacon/i.test(u)) {
    analyticsReqs.push({ url: u, method: r.method(), postData: r.postData()?.slice(0, 500) ?? null });
  }
});

await page.goto(ORIGIN + "/?src=twa", { waitUntil: "load" });
await waitGameReady(page);
await page.waitForTimeout(5000);

const contrast = await page.evaluate(() => {
  const el = document.getElementById("stat-money");
  const cs = getComputedStyle(el);
  // effective background: walk up until a non-transparent background
  let bg = null, n = el;
  while (n && n !== document.documentElement) {
    const b = getComputedStyle(n).backgroundColor;
    if (b && b !== "rgba(0, 0, 0, 0)" && b !== "transparent") { bg = b; break; }
    n = n.parentElement;
  }
  const parse = (c) => c.match(/[\d.]+/g).map(Number);
  const lum = (rgb) => {
    const [r, g, b] = rgb.slice(0, 3).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const fg = parse(cs.color), bgc = parse(bg ?? "rgb(0,0,0)");
  const l1 = lum(fg), l2 = lum(bgc);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return { color: cs.color, background: bg, fontSize: cs.fontSize, fontWeight: cs.fontWeight, ratio: +ratio.toFixed(2), passesAA: ratio >= 4.5, passesAALarge: ratio >= 3 };
});
log("stat-money contrast:", JSON.stringify(contrast));
log("analytics requests seen:", JSON.stringify(analyticsReqs, null, 1));

saveJson("s6-final-checks.json", { when: new Date().toISOString(), url: ORIGIN + "/?src=twa", analyticsReqs, contrast, collectors: summarizeBucket(bucket) });
await ctx.close();
fs.rmSync(profileDir, { recursive: true, force: true });
log("DONE");

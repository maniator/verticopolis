/**
 * Phase 1: exact deployed version, headers, SW registration, caches, GPU,
 * refresh rate. Uses the PERSISTENT profile (first-ever load: SW install).
 */
import { launch, attachCollectors, waitGameReady, saveJson, snap, log, summarizeBucket, ORIGIN } from "./common.mjs";

const { ctx } = await launch({ profile: "persistent" });
const bucket = {};
const page = ctx.pages()[0] ?? (await ctx.newPage());
attachCollectors(page, bucket);

// --- version.json from the browser itself (headers as the client sees them)
const versionInfo = await page.evaluate(async (origin) => {
  const r = await fetch(origin + "/version.json", { cache: "no-store" });
  const headers = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  return { status: r.status, headers, body: await r.json() };
}, ORIGIN);
log("version.json:", JSON.stringify(versionInfo.body));

// --- first load
const t0 = Date.now();
await page.goto(ORIGIN + "/", { waitUntil: "load" });
const loadMs = Date.now() - t0;
await waitGameReady(page);
await snap(page, "s1-first-load-splash");

// --- app-level facts
const appFacts = await page.evaluate(() => {
  const splashVersion = document.querySelector(".splash-version")?.textContent ?? null;
  const jsonLd = Boolean(document.querySelector('script[type="application/ld+json"]'));
  const h1 = document.querySelector("h1")?.textContent ?? null;
  const toastWrap = document.getElementById("toast-wrap");
  return {
    splashVersion,
    jsonLd,
    h1,
    title: document.title,
    toastAriaLive: toastWrap?.getAttribute("aria-live"),
    toastRole: toastWrap?.getAttribute("role"),
    dpr: window.devicePixelRatio,
    ua: navigator.userAgent,
  };
});

// --- service worker registration state (give it time to install on first load)
const sw = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return { supported: false };
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const r = reg ?? (await navigator.serviceWorker.getRegistration());
  if (!r) return { supported: true, registered: false };
  const s = (w) => (w ? { scriptURL: w.scriptURL, state: w.state } : null);
  return {
    supported: true,
    registered: true,
    scope: r.scope,
    active: s(r.active),
    installing: s(r.installing),
    waiting: s(r.waiting),
    controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
    updateViaCache: r.updateViaCache,
  };
});

// --- cache storage contents
const caches_ = await page.evaluate(async () => {
  const names = await caches.keys();
  const out = {};
  for (const n of names) {
    const c = await caches.open(n);
    const keys = await c.keys();
    out[n] = keys.map((k) => k.url);
  }
  return out;
});

// --- GPU: WebGL renderer string from a probe canvas
const gpu = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2") ?? c.getContext("webgl");
  if (!gl) return { webgl: false };
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    webgl: true,
    renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
  };
});

// --- display refresh rate (rAF cadence on the idle splash)
const refresh = await page.evaluate(
  () =>
    new Promise((res) => {
      const deltas = [];
      let last = performance.now();
      const step = (t) => {
        deltas.push(t - last);
        last = t;
        if (deltas.length >= 120) {
          deltas.sort((a, b) => a - b);
          res({ medianFrameMs: deltas[60], impliedHz: Math.round(1000 / deltas[60]) });
        } else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }),
);

// --- key asset response headers via fresh fetches (per vercel.json rules)
const headerChecks = await page.evaluate(async (origin) => {
  const grab = async (path) => {
    const r = await fetch(origin + path, { cache: "no-store" });
    return { path, status: r.status, cacheControl: r.headers.get("cache-control"), swAllowed: r.headers.get("service-worker-allowed"), xVercelCache: r.headers.get("x-vercel-cache") };
  };
  const html = await fetch(origin + "/", { cache: "no-store" });
  const doc = await html.text();
  const asset = doc.match(/\/assets\/[\w.-]+\.js/)?.[0];
  return {
    sw: await grab("/sw.js"),
    manifest: await grab("/manifest.webmanifest"),
    asset: asset ? await grab(asset) : { path: null, note: "no asset match in html" },
    help: await grab("/help"),
    assetlinks: await grab("/.well-known/assetlinks.json"),
    indexCacheControl: html.headers.get("cache-control"),
  };
}, ORIGIN);

const result = {
  when: new Date().toISOString(),
  versionInfo,
  loadMs,
  appFacts,
  sw,
  cacheNames: Object.fromEntries(Object.entries(caches_).map(([k, v]) => [k, v.length])),
  cachesDetail: caches_,
  gpu,
  refresh,
  headerChecks,
  collectors: { summary: summarizeBucket(bucket), detail: bucket },
};
saveJson("s1-baseline.json", result);
log("SUMMARY", JSON.stringify({ version: versionInfo.body, sw: sw.active?.state, controller: !!sw.controller, gpu: gpu.renderer, refresh, load: loadMs + "ms", collectors: summarizeBucket(bucket) }, null, 2));
await ctx.close();

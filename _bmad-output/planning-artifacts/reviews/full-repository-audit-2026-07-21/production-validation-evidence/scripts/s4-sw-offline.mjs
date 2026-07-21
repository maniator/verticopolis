/**
 * Phase 4: service-worker + update-cycle validation on the persistent profile
 * (SW installed during s1). Repeat-load control, SW-served vs network counts,
 * ordinary vs hard reload, cache inventory, offline boot, recovery,
 * version.json cache-bypass proof, and an explicit reg.update() check.
 */
import { launch, attachCollectors, waitGameReady, saveJson, snap, log, summarizeBucket, ORIGIN } from "./common.mjs";

const { ctx } = await launch({ profile: "persistent" });
const bucket = {};
const page = ctx.pages()[0] ?? (await ctx.newPage());
attachCollectors(page, bucket);
const out = { when: new Date().toISOString() };

function trackResponses(p) {
  const seen = [];
  const handler = (r) => seen.push({ url: r.url().replace(ORIGIN, ""), fromSW: r.fromServiceWorker(), status: r.status() });
  p.on("response", handler);
  return { seen, stop: () => p.off("response", handler) };
}

// --- 1. repeat load: SW should control the page and serve assets
{
  const t = trackResponses(page);
  const t0 = Date.now();
  await page.goto(ORIGIN + "/", { waitUntil: "load" });
  await waitGameReady(page);
  out.repeatLoad = {
    ms: Date.now() - t0,
    controller: await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null),
    swState: await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null),
    responses: t.seen,
    swServed: t.seen.filter((r) => r.fromSW).length,
    network: t.seen.filter((r) => !r.fromSW).length,
  };
  t.stop();
  log("repeat load:", out.repeatLoad.ms + "ms", "SW-served:", out.repeatLoad.swServed, "network:", out.repeatLoad.network, "controller:", !!out.repeatLoad.controller);
}

// --- 2. cache inventory (settled)
out.caches = await page.evaluate(async () => {
  const names = await caches.keys();
  const detail = {};
  for (const n of names) {
    const c = await caches.open(n);
    detail[n] = (await c.keys()).map((k) => k.url.replace(location.origin, ""));
  }
  return detail;
});
log("caches:", Object.entries(out.caches).map(([k, v]) => `${k}: ${v.length}`).join("; "));

// --- 3. version.json is NOT in any cache and always hits the network
{
  const inCache = Object.values(out.caches).flat().filter((u) => u.includes("version.json"));
  const t = trackResponses(page);
  const v = await page.evaluate(async () => (await fetch("/version.json")).json());
  await page.waitForTimeout(300);
  const vResp = t.seen.find((r) => r.url.includes("version.json"));
  t.stop();
  out.versionJsonBypass = { inCacheEntries: inCache, body: v, fetch: vResp };
  log("version.json:", JSON.stringify(out.versionJsonBypass));
}

// --- 4. ordinary reload vs hard reload
{
  const t = trackResponses(page);
  await page.reload({ waitUntil: "load" });
  await waitGameReady(page);
  out.ordinaryReload = { swServed: t.seen.filter((r) => r.fromSW).length, network: t.seen.filter((r) => !r.fromSW).length };
  t.stop();
  const cdp = await page.context().newCDPSession(page);
  const t2 = trackResponses(page);
  await cdp.send("Page.reload", { ignoreCache: true });
  await page.waitForLoadState("load");
  await waitGameReady(page);
  out.hardReload = { swServed: t2.seen.filter((r) => r.fromSW).length, network: t2.seen.filter((r) => !r.fromSW).length, controllerAfter: await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null) };
  t2.stop();
  await cdp.detach();
  log("ordinary reload:", JSON.stringify(out.ordinaryReload), "hard reload:", JSON.stringify(out.hardReload));
}

// --- 5. explicit SW update check (same deployment: no waiting worker expected)
out.updateCheck = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  await reg.update();
  await new Promise((r) => setTimeout(r, 3000));
  const s = (w) => (w ? w.state : null);
  return { active: s(reg.active), installing: s(reg.installing), waiting: s(reg.waiting) };
});
log("update check:", JSON.stringify(out.updateCheck));

// --- 6. offline: reload fully offline; app must boot from the SW cache
{
  await ctx.setOffline(true);
  const t = trackResponses(page);
  let offlineBootError = null;
  try {
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await waitGameReady(page, 30000);
  } catch (e) {
    offlineBootError = String(e.message).slice(0, 200);
  }
  const offlineFacts = await page
    .evaluate(() => ({
      splash: Boolean(document.getElementById("splash")),
      gameWired: Boolean(window.game?.sim && window.game?.engine),
      version: document.querySelector(".splash-version")?.textContent ?? null,
    }))
    .catch((e) => ({ evalError: String(e.message).slice(0, 120) }));
  let offlineVersionFetch = null;
  try {
    offlineVersionFetch = await page.evaluate(async () => {
      try {
        const r = await fetch("/version.json");
        return { ok: r.ok, status: r.status, fromWhere: "responded" };
      } catch (e) {
        return { threw: String(e).slice(0, 100) };
      }
    });
  } catch (e) {
    offlineVersionFetch = { evalError: String(e).slice(0, 100) };
  }
  await snap(page, "s4-offline-boot");
  out.offline = { bootError: offlineBootError, facts: offlineFacts, versionFetch: offlineVersionFetch, swServed: t.seen.filter((r) => r.fromSW).length, network: t.seen.filter((r) => !r.fromSW).length };
  t.stop();
  log("offline:", JSON.stringify(out.offline));
}

// --- 7. offline gameplay probe: can we start a new game with no network?
out.offlinePlay = await page
  .evaluate(async () => {
    const btn = document.querySelector('[data-splash="new"]') ?? document.querySelector('[data-splash="continue"]');
    btn?.click();
    await new Promise((r) => setTimeout(r, 500));
    document.querySelector('#modal [data-act="found"]')?.click();
    await new Promise((r) => setTimeout(r, 800));
    return { splashGone: !document.getElementById("splash"), units: window.game?.sim?.tower?.units?.length ?? null, mode: window.game?.sim?.rules?.mode ?? null };
  })
  .catch((e) => ({ error: String(e.message).slice(0, 150) }));
log("offline play:", JSON.stringify(out.offlinePlay));

// --- 8. restore network, verify recovery
{
  await ctx.setOffline(false);
  const t = trackResponses(page);
  await page.reload({ waitUntil: "load" });
  await waitGameReady(page);
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  out.recovery = { versionAfterRestore: v, swServed: t.seen.filter((r) => r.fromSW).length, network: t.seen.filter((r) => !r.fromSW).length };
  t.stop();
  log("recovery:", JSON.stringify(out.recovery));
}

// --- 9. redirect/rewrite checks (server-side routing facts)
out.routing = await page.evaluate(async () => {
  const probe = async (p) => {
    const r = await fetch(p, { redirect: "follow", cache: "no-store" });
    return { path: p, finalUrl: r.url.replace(location.origin, ""), status: r.status, redirected: r.redirected };
  };
  return { helpSlash: await probe("/help/"), gallery: await probe("/gallery"), gallerySlash: await probe("/gallery/") };
});
log("routing:", JSON.stringify(out.routing));

out.collectors = { summary: summarizeBucket(bucket), detail: bucket };
saveJson("s4-sw-offline.json", out);
log("DONE");
await ctx.close();

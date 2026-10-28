import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { Deployment, Deployments } from "./deployments";

/**
 * Steps shared by the specs that run on the two-deployment server (#985):
 * a context that chooses the engine, and a read of what the precache holds
 * for the three engine files, checked against what a build's own sw.js and
 * files describe.
 */

export const short = (id: string): string => id.slice(0, 12);

/** A new context on the deployments' origin that chooses the engine, as the project's own contexts do. */
export const newContext = (browser: Browser, deployments: Deployments): Promise<BrowserContext> =>
  browser.newContext({
    baseURL: deployments.origin,
    storageState: { cookies: [], origins: [{ origin: deployments.origin, localStorage: [{ name: "vc.engine", value: "wasm" }] }] },
  });

/** What the precache holds for the engine files: each key (path and query) with the SHA-256 of its body. */
export async function engineEntries(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const found: Record<string, string> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (!url.pathname.startsWith("/engine/")) continue;
        const digest = await crypto.subtle.digest("SHA-256", await (await cache.match(request))!.arrayBuffer());
        found[`${url.pathname}${url.search}`] = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      }
    }
    return found;
  });
}

/** The engine keys and body digests that `which`'s sw.js and files describe. */
export function engineEntriesOf(deployments: Deployments, which: Deployment): Record<string, string> {
  const r = deployments.revisions[which];
  const d = deployments.digests[which];
  return {
    [`/engine/verticopolis_engine.js?__WB_REVISION__=${r.glue}`]: d.glue,
    [`/engine/verticopolis_engine_bg.wasm?__WB_REVISION__=${r.wasm}`]: d.wasm,
    [`/engine/BUILD.json?__WB_REVISION__=${r.record}`]: d.record,
  };
}

/** The cache holds exactly `which`'s three engine files under its keys, each with its own bytes. */
export async function expectEngineIs(deployments: Deployments, page: Page, which: Deployment): Promise<void> {
  const held = await engineEntries(page);
  const expected = engineEntriesOf(deployments, which);
  for (const [key, digest] of Object.entries(expected)) expect(held[key], `${key} holds ${which}'s bytes`).toBe(digest);
  expect(Object.keys(held).sort(), `no engine key but ${which}'s`).toEqual(Object.keys(expected).sort());
}

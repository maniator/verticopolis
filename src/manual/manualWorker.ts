/**
 * The Player's Manual's service worker (help.verticopolis.com/sw.js, or
 * /help/sw.js on a build that keeps the manual on the game's host). It makes
 * the manual readable offline (owner, 2026-11-20).
 *
 * - **Install** saves every page and the files the pages need to draw and to
 *   search (the build's list, {@link ManualConfig.files}) into one cache named
 *   after the list's version. A file whose revision did not change since the
 *   last saved copy is copied over instead of downloaded again.
 * - **Pages** come from the network first, so a reader online always gets the
 *   live manual, and from the saved copy when the network fails or is slow.
 *   A page missing from the copy gets a short "not saved yet" page.
 * - **Pictures** (the screenshots and sprites) are saved the first time they
 *   are shown, so offline a page shows the pictures already seen and the
 *   captions of the rest.
 * - **Activate** deletes older copies, and the caches a game worker left on
 *   the manual's host when that host still served the game; a page such a
 *   worker answered is reloaded, so it comes back as the manual.
 *
 * The build (scripts/manual-worker.ts) compiles this file on its own, with no
 * imports, so it may only import types.
 *
 * Cost: one cache lookup per manual request; nothing runs between requests.
 */

/** One file the manual saves: its path under the manual's base ("" for the
 *  front page, "rooms/hotels/" for a page, "_astro/page.js") and a digest of
 *  its contents. */
export interface ManualFile {
  readonly url: string;
  readonly revision: string;
}

/** What the build writes into the worker. */
export interface ManualConfig {
  /** A digest of the whole list, which names the saved copy. */
  readonly version: string;
  readonly files: readonly ManualFile[];
}

/** The Cache Storage calls the worker makes, so a test can stand in. */
export interface ManualDeps {
  readonly caches: CacheStorage;
  readonly fetch: (request: Request) => Promise<Response>;
  /** The worker's scope, the manual's base address ending in a slash. */
  readonly scope: string;
  /** Waits `ms` and resolves (setTimeout in the worker). */
  readonly wait: (ms: number) => Promise<void>;
}

/** The prefix of the saved copies, one per version of the file list. */
export const PAGES_CACHE_PREFIX = "vc-manual-pages-";
/** Pictures saved as they are shown, kept across versions. */
export const MEDIA_CACHE = "vc-manual-media";
/** The prefix of the caches the game's Workbox worker makes. */
export const GAME_CACHE_PREFIX = "workbox-";
/** Where a saved copy keeps its own list, under the scope. */
export const MANIFEST_PATH = "__vc-manual-files.json";
/** How long a page waits for the network before a saved copy answers. */
export const NETWORK_WAIT_MS = 4000;
/** How many files the install fetches at once. */
const INSTALL_PARALLEL = 6;

/** Paths under the scope the worker never answers: the analytics relay,
 *  Vercel's own scripts and the worker itself. */
const PASS_THROUGH = /^(?:api\/|_vercel\/|sw\.js$)/;

/** File endings saved as pictures when they are shown. */
const PICTURE = /\.(?:png|webp|jpe?g|gif|svg|avif)$/i;

/** The saved copy's cache name for `version`. */
export function pagesCacheName(version: string): string {
  return PAGES_CACHE_PREFIX + version;
}

/**
 * The key a page is saved under: the address without its query or hash, with
 * a page's folder slash put back ("rooms/hotels" is saved as "rooms/hotels/",
 * the address the build lists). A path whose last part has a dot is a file
 * and keeps its name.
 */
export function savedKey(address: string): string {
  const url = new URL(address);
  let path = url.pathname;
  const last = path.slice(path.lastIndexOf("/") + 1);
  if (last !== "" && !last.includes(".")) path += "/";
  return url.origin + path;
}

/** Run `job` over `items`, at most `limit` at a time; the first failure fails it. */
async function eachLimited<T>(items: readonly T[], limit: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) await job(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** A response a navigation may be answered with. One that followed a redirect
 *  is rebuilt, since some browsers refuse a redirected response for a page. */
function storable(response: Response): Response {
  if (!response.redirected) return response;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** The newest other saved copy that finished its install (it has its list),
 *  and that list, or null when there is none. */
async function previousCopy(
  deps: ManualDeps,
  current: string,
): Promise<{ cache: Cache; revisions: Record<string, string> } | null> {
  const names = (await deps.caches.keys()).filter((n) => n.startsWith(PAGES_CACHE_PREFIX) && n !== current);
  for (const name of names.reverse()) {
    const cache = await deps.caches.open(name);
    const list = await cache.match(new URL(MANIFEST_PATH, deps.scope).href);
    if (!list) continue;
    try {
      return { cache, revisions: (await list.json()) as Record<string, string> };
    } catch {
      // A list that does not read is no copy to reuse.
    }
  }
  return null;
}

/**
 * Save every file of `config` into this version's copy. A file already in the
 * copy (an install that stopped part way and runs again) is kept, a file
 * whose revision matches the previous copy is copied from it, and the rest
 * are fetched. Any file that fails to arrive fails the install, and the
 * browser tries again on a later visit. The list goes in last, so only a
 * finished copy has one.
 */
export async function installManual(config: ManualConfig, deps: ManualDeps): Promise<void> {
  const name = pagesCacheName(config.version);
  const cache = await deps.caches.open(name);
  const previous = await previousCopy(deps, name);
  await eachLimited(config.files, INSTALL_PARALLEL, async (file) => {
    const address = new URL(file.url, deps.scope).href;
    if (await cache.match(address)) return;
    if (previous && previous.revisions[file.url] === file.revision) {
      const kept = await previous.cache.match(address);
      if (kept) {
        await cache.put(address, kept);
        return;
      }
    }
    const response = await deps.fetch(new Request(address, { cache: "no-cache", credentials: "same-origin" }));
    if (!response.ok) throw new Error(`manual: ${file.url} answered ${response.status}`);
    await cache.put(address, storable(response));
  });
  const revisions = Object.fromEntries(config.files.map((f) => [f.url, f.revision]));
  await cache.put(
    new URL(MANIFEST_PATH, deps.scope).href,
    new Response(JSON.stringify(revisions), { headers: { "Content-Type": "application/json" } }),
  );
}

/**
 * Delete every saved copy but this version's, and any cache a game worker
 * left at this same scope (Workbox ends each cache's name with its worker's
 * scope). A game that shares the origin, with the manual under /help/, has
 * its worker at the origin's root, so its caches are never touched. Returns
 * whether a game cache was there, which means pages open now were the
 * game's and should be reloaded.
 */
export async function activateManual(
  config: ManualConfig,
  deps: Pick<ManualDeps, "caches" | "scope">,
): Promise<boolean> {
  const keep = pagesCacheName(config.version);
  let foundGame = false;
  for (const name of await deps.caches.keys()) {
    if (name.startsWith(GAME_CACHE_PREFIX) && name.endsWith(deps.scope)) foundGame = true;
    else if (!name.startsWith(PAGES_CACHE_PREFIX) || name === keep) continue;
    await deps.caches.delete(name).catch(() => false);
  }
  return foundGame;
}

/** The page shown for a manual page that is not saved and cannot load. */
export function notSavedPage(home: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not saved yet - Verticopolis Help</title><style>body{margin:0;background:#008080;font:15px/1.5 system-ui,sans-serif;color:#000}main{max-width:32rem;margin:15vh auto;background:#c0c0c0;border:2px outset #fff;padding:0 0 1rem}h1{margin:0 0 1rem;padding:.25rem .5rem;background:#000080;color:#fff;font-size:1rem}p{margin:.5rem 1rem}a{color:#000080}</style></head><body><main><h1>Verticopolis Help</h1><p>This page of the manual isn't saved on this device yet, and it needs the internet to load.</p><p><a href="${home}">Open the manual's front page</a>, which is saved, or try again when you are back online.</p></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** A page: the network, or the saved copy when the network fails or takes
 *  longer than {@link NETWORK_WAIT_MS} and a copy is saved. */
async function pageResponse(request: Request, config: ManualConfig, deps: ManualDeps): Promise<Response> {
  const network = deps.fetch(request);
  // A copy may answer first; a network failure after that is not an error.
  network.catch(() => undefined);
  const saved = async () => (await deps.caches.open(pagesCacheName(config.version))).match(savedKey(request.url));
  const slow = deps.wait(NETWORK_WAIT_MS).then(async () => (await saved()) ?? network);
  try {
    return await Promise.race([network, slow]);
  } catch {
    return (await saved()) ?? notSavedPage(deps.scope);
  }
}

/** A saved file, or the network when the copy lacks it. */
async function savedFirst(request: Request, config: ManualConfig, deps: ManualDeps): Promise<Response> {
  const cache = await deps.caches.open(pagesCacheName(config.version));
  return (await cache.match(savedKey(request.url))) ?? deps.fetch(request);
}

/** A picture: the one saved when it was last shown, or the network, saving a
 *  good answer for next time. */
async function pictureResponse(request: Request, deps: ManualDeps): Promise<Response> {
  const cache = await deps.caches.open(MEDIA_CACHE);
  const key = savedKey(request.url);
  const kept = await cache.match(key);
  if (kept) return kept;
  const response = await deps.fetch(request);
  if (response.ok && response.type === "basic") await cache.put(key, response.clone()).catch(() => undefined);
  return response;
}

const listedSets = new WeakMap<ManualConfig, ReadonlySet<string>>();

/** The paths `config` saves, as a set made once per config. */
function listedPaths(config: ManualConfig): ReadonlySet<string> {
  let set = listedSets.get(config);
  if (!set) {
    set = new Set(config.files.map((f) => f.url));
    listedSets.set(config, set);
  }
  return set;
}

/**
 * How the worker answers `request`, or null to leave it to the browser: a
 * request that is not a GET, is for another site or sits outside the scope,
 * a pass-through path, or a file the manual neither saves nor shows as a
 * picture.
 */
export function respond(request: Request, config: ManualConfig, deps: ManualDeps): Promise<Response> | null {
  if (request.method !== "GET") return null;
  const scope = new URL(deps.scope);
  const url = new URL(request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  const path = url.pathname.slice(scope.pathname.length);
  if (PASS_THROUGH.test(path)) return null;
  if (request.mode === "navigate") return pageResponse(request, config, deps);
  const listed = new URL(savedKey(request.url)).pathname.slice(scope.pathname.length);
  if (listedPaths(config).has(listed)) return savedFirst(request, config, deps);
  if (PICTURE.test(path)) return pictureResponse(request, deps);
  return null;
}

/** The parts of a service worker's global scope the worker uses. */
export interface ManualWorkerScope {
  readonly caches: CacheStorage;
  readonly registration: { readonly scope: string };
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options: { type: "window" }): Promise<readonly { url: string; navigate(url: string): Promise<unknown> }[]>;
  };
  fetch(request: Request): Promise<Response>;
  skipWaiting(): Promise<void>;
  setTimeout(handler: () => void, ms: number): unknown;
  addEventListener(
    type: "install" | "activate",
    listener: (event: { waitUntil(p: Promise<unknown>): void }) => void,
  ): void;
  addEventListener(
    type: "fetch",
    listener: (event: { request: Request; respondWith(r: Promise<Response>): void }) => void,
  ): void;
}

/** Wire the worker's three events on `self`. */
export function startManualWorker(self: ManualWorkerScope, config: ManualConfig): void {
  const deps: ManualDeps = {
    caches: self.caches,
    fetch: (request) => self.fetch(request),
    scope: self.registration.scope,
    wait: (ms) => new Promise((resolve) => self.setTimeout(resolve, ms)),
  };
  self.addEventListener("install", (event) => {
    void self.skipWaiting();
    event.waitUntil(installManual(config, deps));
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const foundGame = await activateManual(config, deps).catch(() => false);
        await self.clients.claim();
        if (!foundGame) return;
        const windows = await self.clients.matchAll({ type: "window" });
        await Promise.all(windows.map((w) => w.navigate(w.url).catch(() => null)));
      })(),
    );
  });
  self.addEventListener("fetch", (event) => {
    const answer = respond(event.request, config, deps);
    if (answer) event.respondWith(answer);
  });
}

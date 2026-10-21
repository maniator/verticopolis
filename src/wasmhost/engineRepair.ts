import { ENGINE_BUILD_RECORD, ENGINE_DIR, ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames";
import { browserDigest, isControlled, type VerifyOptions } from "./enginePackageCheck";
import { parseEngineRecord, type ExpectedEnginePackage } from "./enginePackageRecord";
import type { EngineBootFailure } from "./engineBoot";

/**
 * Repair engine files (#985, design 5.4 "Corrupted-entry recovery"). A normal
 * Reload does not fix a corrupted entry in Cache Storage: Workbox checks
 * integrity on a network fetch and returns a cache hit as stored. Repair
 * fetches the three engine files from the network (with a parameter the
 * worker's precache route does not match, since a plain fetch of the engine
 * URL would be answered from the damaged entry), checks them against the
 * digests this shell was built with, and only then writes them over the cache
 * keys of the running build: the three engine URLs of this deployment with the
 * Workbox revision the shell was built for. It touches no other key, so a
 * waiting worker's entries (other revisions), the shell and audio entries,
 * IndexedDB, localStorage and saves are left alone, and it never deletes
 * first. All three files are fetched and checked before any is written, so a
 * failed fetch or digest leaves every old entry as it was.
 *
 * Permanent host infrastructure: the wasm-only build relies on it.
 */

/** Workbox names the precache `workbox-precache-v2-` plus the worker's scope. */
const PRECACHE_PREFIX = "workbox-precache-v2-";
/** The URL parameter Workbox adds to a revisioned entry's cache key. */
const REVISION_PARAM = "__WB_REVISION__";
/** A parameter the precache route does not ignore, so the controlling worker
 *  lets the request through to the network instead of answering from the bad
 *  entry. The static host ignores it. */
const NETWORK_PARAM = "vc-repair";
const FILES = [ENGINE_GLUE, ENGINE_WASM, ENGINE_BUILD_RECORD] as const;

export type RepairFailure =
  /** No worker scope, no Cache Storage, or no revisions compiled into the shell. */
  | "unavailable"
  /** A file did not arrive from the network (offline, an HTTP error, a redirect). */
  | "fetch"
  /** A file arrived but is not the one this shell was built for. */
  | "mismatch"
  /** The browser would not store the files. */
  | "cache";

export type RepairResult = { ok: true; written: string[] } | { ok: false; reason: RepairFailure; file?: string };

export interface RepairOptions {
  /** The package the shell was built with (default: the compiled-in one). */
  expected?: ExpectedEnginePackage | null;
  /** The folder URL the engine files are served from (default: beside the glue). */
  engineBase?: string;
  /** The controlling worker's scope; read from the registration when absent. */
  scope?: string;
  // Test seams; the browser supplies each by default.
  fetch?: (url: string, init: { cache: "reload" }) => Promise<Response>;
  digest?: VerifyOptions["digest"];
  caches?: Pick<CacheStorage, "open" | "has">;
  /** Asked for one registration update after a repair. */
  update?: () => Promise<unknown>;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Whether the stop screen offers Repair: a worker controls the page and the
 *  failure is files that did not match or did not arrive. Not for a timeout, an
 *  insecure connection or a package that cannot save towers, which a fresh copy
 *  of the files does not change. */
export function repairOffered(failure: EngineBootFailure, controlled: boolean): boolean {
  if (!controlled || failure.stage !== "load" || failure.cause !== undefined) return false;
  if (failure.package?.kind === "unverifiable" || failure.reason === "unverifiable" || failure.reason === "boot-timeout") return false;
  return failure.reason === "package-mismatch" || failure.reason === "boot-error";
}

/** The page's own check of whether a worker controls it. */
export function pageControlled(): boolean {
  return typeof navigator !== "undefined" && isControlled(navigator);
}

/** The cache key Workbox uses for a revisioned precache entry. */
export function precacheKey(url: string, revision: string): string {
  const key = new URL(url);
  key.searchParams.set(REVISION_PARAM, revision);
  return key.href;
}

async function currentScope(): Promise<string | undefined> {
  try {
    return (await navigator.serviceWorker?.getRegistration())?.scope;
  } catch {
    return undefined;
  }
}

/**
 * Replace the running build's three engine cache entries with fresh, checked
 * bytes. Never throws: every outcome is in the result. Does not reload or
 * activate a worker.
 */
export async function repairEnginePackage(opts: RepairOptions = {}): Promise<RepairResult> {
  const expected = opts.expected === undefined ? __ENGINE_PACKAGE__ : opts.expected;
  const digest = "digest" in opts ? opts.digest : browserDigest();
  const store = opts.caches ?? (typeof caches === "undefined" ? undefined : caches);
  const scope = opts.scope ?? (await currentScope());
  const engineBase = opts.engineBase ?? new URL(`${import.meta.env.BASE_URL}${ENGINE_DIR}`, globalThis.location?.href ?? "http://localhost/").href;
  const revisions = expected?.revisions;
  if (!expected || !revisions || !digest || !store || !scope || FILES.some((f) => !revisions[f])) return { ok: false, reason: "unavailable" };
  const doFetch = opts.fetch ?? ((url, init) => fetch(url, init));

  // Fetch and check all three first; nothing is written until every file is right.
  const fresh: Array<{ name: string; key: string; body: Uint8Array; type: string }> = [];
  for (const name of FILES) {
    const url = new URL(name, engineBase).href;
    const networkUrl = new URL(url);
    networkUrl.searchParams.set(NETWORK_PARAM, String(Date.now()));
    let res: Response;
    let body: Uint8Array;
    try {
      res = await doFetch(networkUrl.href, { cache: "reload" });
      if (res.status !== 200 || res.redirected) return { ok: false, reason: "fetch", file: name };
      body = new Uint8Array(await res.arrayBuffer());
    } catch {
      return { ok: false, reason: "fetch", file: name };
    }
    if (!(await fits(name, body, expected, digest))) return { ok: false, reason: "mismatch", file: name };
    fresh.push({ name, key: precacheKey(url, revisions[name]), body, type: res.headers.get("content-type") ?? "" });
  }

  try {
    const cache = await store.open(`${PRECACHE_PREFIX}${scope}`);
    for (const f of fresh) await cache.put(f.key, new Response(f.body as BufferSource, { status: 200, headers: f.type ? { "content-type": f.type } : {} }));
  } catch {
    return { ok: false, reason: "cache" };
  }
  // One update check, so a newer deployment's worker can install. A failure
  // here does not undo the repair.
  try {
    await opts.update?.();
  } catch {
    /* the repair stands */
  }
  return { ok: true, written: fresh.map((f) => f.name) };
}

/** Whether `body` is the file this shell was built for. */
async function fits(name: string, body: Uint8Array, expected: ExpectedEnginePackage, digest: NonNullable<VerifyOptions["digest"]>): Promise<boolean> {
  try {
    if (name === ENGINE_BUILD_RECORD) {
      const parsed = parseEngineRecord(new TextDecoder().decode(body));
      return parsed.ok && parsed.record.package === expected.package;
    }
    const want = expected.files[name];
    return !!want && body.length === want.bytes && hex(await digest(body)) === want.sha256;
  } catch {
    return false;
  }
}

/** Ask the page's registration for one update check. */
export async function updateRegistration(): Promise<void> {
  await (await navigator.serviceWorker?.getRegistration())?.update();
}

/** What the stop screen says about a finished repair attempt. A failure always
 *  says nothing was changed, and Repair stays available for another try. */
export function repairMessage(result: RepairResult): string {
  if (result.ok) return "Engine files repaired. Press Reload to try again.";
  switch (result.reason) {
    case "fetch":
      return "Could not download the engine files. Nothing was changed. Check your connection and try again.";
    case "mismatch":
      return "The server sent engine files that do not match this version of the game. Nothing was changed.";
    case "cache":
      return "This browser would not store the engine files. Nothing was changed.";
    default:
      return "Repair is not available here. Nothing was changed.";
  }
}

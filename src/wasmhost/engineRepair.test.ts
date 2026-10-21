import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { pageControlled, precacheKey, repairEnginePackage, repairMessage, repairOffered, type RepairOptions } from "./engineRepair";
import { ENGINE_BUILD_RECORD, ENGINE_GLUE, ENGINE_WASM } from "./enginePackageNames";
import { engineBuildRecord, expectedOf } from "./enginePackageRecord";
import { browserDigest } from "./enginePackageCheck";
import type { EngineBootFailure } from "./engineBoot";

const sha = (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex");
const md5 = (d: Uint8Array | string) => createHash("md5").update(d).digest("hex");
const enc = (s: string) => new TextEncoder().encode(s);
const BASE = "https://game.example/engine/";
const glue = enc("export default async function init() {}\n");
const wasm = new Uint8Array(512).map((_, i) => (i * 5) & 255);
const record = engineBuildRecord(glue, wasm, "a".repeat(64), sha);
const recordBytes = enc(JSON.stringify(record));
const bytesOf = { [ENGINE_GLUE]: glue, [ENGINE_WASM]: wasm, [ENGINE_BUILD_RECORD]: recordBytes };
const expected = {
  ...expectedOf(record),
  revisions: { [ENGINE_GLUE]: md5(glue), [ENGINE_WASM]: md5(wasm), [ENGINE_BUILD_RECORD]: md5(recordBytes) },
};
const SCOPE = "https://game.example/";

/** A Cache Storage over a map, recording every write. */
const CACHE = `workbox-precache-v2-${SCOPE}`;
function fakeCaches(failPutAt = 0, seeded = true) {
  const stores = new Map<string, Map<string, Uint8Array>>();
  if (seeded) {
    // The worker's own precache, holding another revision's entry, beside an unrelated cache.
    stores.set(CACHE, new Map([[`${BASE}${ENGINE_WASM}?__WB_REVISION__=other`, enc("waiting build")]]));
    stores.set("workbox-precache-v2-https://other.example/", new Map([["https://other.example/x", enc("x")]]));
  }
  const puts: Array<{ cache: string; key: string; type: string | null }> = [];
  const api = {
    has: async (name: string) => stores.has(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name)!;
      return {
        put: async (req: RequestInfo | URL, res: Response) => {
          if (failPutAt && puts.length + 1 >= failPutAt) throw new DOMException("quota", "QuotaExceededError");
          let key: string;
          if (typeof req === "string") key = req;
          else if (req instanceof URL) key = req.href;
          else key = (req as Request).url;
          puts.push({ cache: name, key, type: res.headers.get("content-type") });
          map.set(key, new Uint8Array(await res.arrayBuffer()));
        },
      } as unknown as Cache;
    },
  };
  return { api: api as unknown as Pick<CacheStorage, "open" | "has">, stores, puts };
}

const served = (over: Partial<Record<string, Uint8Array | number | Error>> = {}) =>
  vi.fn(async (url: string) => {
    const name = url.slice(BASE.length).split("?")[0];
    const v = over[name] ?? bytesOf[name as keyof typeof bytesOf];
    if (v instanceof Error) throw v;
    if (typeof v === "number") return new Response("no", { status: v });
    return new Response(v as BufferSource, { status: 200, headers: { "content-type": name.endsWith(".wasm") ? "application/wasm" : "text/javascript" } });
  });

const run = (extra: Partial<RepairOptions> = {}) => {
  const c = fakeCaches();
  const fetch = served();
  return { c, fetch, result: repairEnginePackage({ expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: c.api, fetch, ...extra }) };
};

describe("repairEnginePackage", () => {
  it("writes the three checked files over the running build's keys, from a fresh network fetch", async () => {
    const { c, fetch, result } = run();
    const r = await result;
    expect(r).toEqual({ ok: true, written: [ENGINE_GLUE, ENGINE_WASM, ENGINE_BUILD_RECORD] });
    expect(fetch.mock.calls.map((x) => (x as unknown[])[0] as string).every((u) => /\?vc-repair=\d+$/.test(u)), "each request carries the parameter the precache route does not match").toBe(true);
    expect(fetch.mock.calls.map((x) => (x as unknown[])[1])).toEqual([{ cache: "reload" }, { cache: "reload" }, { cache: "reload" }]);
    expect(c.puts.map((p) => p.cache)).toEqual(Array(3).fill(`workbox-precache-v2-${SCOPE}`));
    expect(c.puts.map((p) => p.key)).toEqual([
      `${BASE}${ENGINE_GLUE}?__WB_REVISION__=${md5(glue)}`,
      `${BASE}${ENGINE_WASM}?__WB_REVISION__=${md5(wasm)}`,
      `${BASE}${ENGINE_BUILD_RECORD}?__WB_REVISION__=${md5(recordBytes)}`,
    ]);
    expect(c.puts[1].type).toBe("application/wasm");
    expect(c.stores.get(CACHE)!.get(`${BASE}${ENGINE_WASM}?__WB_REVISION__=${md5(wasm)}`)).toEqual(wasm);
    // A waiting build's entry under another revision, and other caches, are as they were.
    expect(c.stores.get(CACHE)!.get(`${BASE}${ENGINE_WASM}?__WB_REVISION__=other`)).toEqual(enc("waiting build"));
    expect(c.stores.get("workbox-precache-v2-https://other.example/")!.size).toBe(1);
    expect([...c.stores.keys()].sort()).toEqual([CACHE, "workbox-precache-v2-https://other.example/"]);
  });

  it("writes nothing when a file does not match the digest, whichever file it is", async () => {
    for (const [name, bad] of [[ENGINE_GLUE, enc("export default 1;\n")], [ENGINE_WASM, new Uint8Array(wasm.length)], [ENGINE_BUILD_RECORD, enc(JSON.stringify({ ...record, package: "b".repeat(64) }))]] as const) {
      const c = fakeCaches();
      const r = await repairEnginePackage({ expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: c.api, fetch: served({ [name]: bad }) });
      expect(r, name).toEqual({ ok: false, reason: "mismatch", file: name });
      expect(c.puts, `${name} left the old entries as they were`).toEqual([]);
    }
  });

  it("stops at the first fetch that fails and writes nothing", async () => {
    for (const bad of [404, 503, new TypeError("offline")]) {
      const c = fakeCaches();
      const fetch = served({ [ENGINE_WASM]: bad });
      const r = await repairEnginePackage({ expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: c.api, fetch });
      expect(r).toEqual({ ok: false, reason: "fetch", file: ENGINE_WASM });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(c.puts).toEqual([]);
    }
  });

  it("refuses a redirected response", async () => {
    const redirected = vi.fn(async () => Object.defineProperty(new Response(glue, { status: 200 }), "redirected", { value: true }));
    const r = await repairEnginePackage({ expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: fakeCaches().api, fetch: redirected });
    expect(r).toEqual({ ok: false, reason: "fetch", file: ENGINE_GLUE });
  });

  it("reports a browser that will not store the files", async () => {
    const c = fakeCaches(1);
    const r = await repairEnginePackage({ expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: c.api, fetch: served() });
    expect(r).toEqual({ ok: false, reason: "cache" });
  });

  it("is unavailable without a worker scope, Cache Storage, a digest or the compiled-in revisions", async () => {
    const base = { expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: fakeCaches().api, fetch: served() };
    for (const missing of [{ scope: "" }, { caches: undefined }, { digest: undefined }, { expected: null }, { expected: { ...expected, revisions: undefined } }, { expected: { ...expected, revisions: { [ENGINE_GLUE]: "x" } } }]) {
      const fetch = served();
      expect(await repairEnginePackage({ ...base, fetch, ...missing }), JSON.stringify(Object.keys(missing))).toEqual({ ok: false, reason: "unavailable" });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("does not create the worker's precache when it is absent", async () => {
    const c = fakeCaches(0, false);
    expect(await repairEnginePackage({ expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: c.api, fetch: served() })).toEqual({ ok: false, reason: "unavailable" });
    expect(c.stores.size).toBe(0);
    expect(c.puts).toEqual([]);
  });

  it("reports a write that fails partway as a cache failure, with the earlier entries replaced", async () => {
    const c = fakeCaches(2);
    expect(await repairEnginePackage({ expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: c.api, fetch: served() })).toEqual({ ok: false, reason: "cache" });
    expect(c.puts.map((p) => p.key)).toEqual([`${BASE}${ENGINE_GLUE}?__WB_REVISION__=${md5(glue)}`]);
    expect(repairMessage({ ok: false, reason: "cache" })).not.toMatch(/Nothing was changed/);
  });

  it("refuses a record with the right package id and damaged entries", async () => {
    const damaged = { ...record, files: { ...record.files, [ENGINE_WASM]: { ...record.files[ENGINE_WASM], sha256: "c".repeat(64) } } };
    const c = fakeCaches();
    const r = await repairEnginePackage({ expected, engineBase: BASE, scope: SCOPE, digest: browserDigest(webcrypto as unknown as Crypto), caches: c.api, fetch: served({ [ENGINE_BUILD_RECORD]: enc(JSON.stringify(damaged)) }) });
    expect(r).toEqual({ ok: false, reason: "mismatch", file: ENGINE_BUILD_RECORD });
    expect(c.puts).toEqual([]);
  });

  it("asks for one registration update after a repair, and a failing update does not undo it", async () => {
    const update = vi.fn(async () => {
      throw new Error("offline");
    });
    const { result } = run({ update });
    expect(await result).toMatchObject({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
    const fail = run({ update, fetch: served({ [ENGINE_GLUE]: 500 }) });
    expect(await fail.result).toMatchObject({ ok: false });
    expect(update, "no update check when nothing arrived").toHaveBeenCalledTimes(1);
    // Files from the server that are not this shell's may mean a newer game: look for it.
    const stale = run({ update, fetch: served({ [ENGINE_GLUE]: enc("export default 1;\n") }) });
    expect(await stale.result).toMatchObject({ ok: false, reason: "mismatch" });
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe("precacheKey", () => {
  it("adds the revision the way Workbox names a revisioned entry", () => {
    expect(precacheKey("https://game.example/engine/x.wasm", "abc")).toBe("https://game.example/engine/x.wasm?__WB_REVISION__=abc");
  });
});

describe("repairOffered", () => {
  const detail = { kind: "mismatch" as const, file: "wasm" as const, expected: null, found: null, expectedPackage: "111111111111", servedPackage: "222222222222", controlled: true };
  const f = (over: Partial<EngineBootFailure>): EngineBootFailure => ({ stage: "load", reason: "package-mismatch", message: "m", ...over });
  it("offers Repair for files that did not match or did not arrive, only under a controlling worker", () => {
    expect(repairOffered(f({}), true)).toBe(true);
    expect(repairOffered(f({ reason: "boot-error", package: { ...detail, kind: "load-failed" } }), true)).toBe(true);
    expect(repairOffered(f({ package: { ...detail, kind: "mismatch" } }), true)).toBe(true);
    expect(repairOffered(f({}), false)).toBe(false);
  });
  it("does not offer it when the files were right or the build has no package to repair from", () => {
    expect(repairOffered(f({ reason: "boot-error" }), true), "a compile error or out-of-memory with correct files").toBe(false);
    expect(repairOffered(f({ reason: "boot-error", package: { ...detail, kind: "load-failed", expectedPackage: null } }), true)).toBe(false);
  });
  it("does not offer it for a timeout, an unverifiable connection, a missing save writer or a later stage", () => {
    expect(repairOffered(f({ reason: "boot-timeout" }), true)).toBe(false);
    expect(repairOffered(f({ reason: "unverifiable" }), true)).toBe(false);
    expect(repairOffered(f({ reason: "boot-error", package: { kind: "unverifiable", file: null, expected: null, found: null, expectedPackage: null, servedPackage: null, controlled: true } }), true)).toBe(false);
    expect(repairOffered(f({ cause: "no-save-writer" }), true)).toBe(false);
    expect(repairOffered(f({ stage: "start" }), true)).toBe(false);
    expect(repairOffered(f({ stage: "host", reason: "attach-refused" }), true)).toBe(false);
  });
});

describe("repairMessage and pageControlled", () => {
  it("says what happened, and that a failure changed nothing", () => {
    expect(repairMessage({ ok: true, written: [] })).toMatch(/repaired.*Reload/);
    for (const reason of ["fetch", "mismatch", "unavailable"] as const) expect(repairMessage({ ok: false, reason })).toMatch(/Nothing was changed/);
    for (const m of [repairMessage({ ok: true, written: [] }), repairMessage({ ok: false, reason: "fetch" })]) expect(m).not.toMatch(/\u2014/);
  });
  it("reads whether a worker controls the page without throwing", () => {
    expect(typeof pageControlled()).toBe("boolean");
  });
});

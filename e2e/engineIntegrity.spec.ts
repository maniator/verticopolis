/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { WASM_ONLY_PROJECT, onWasm } from "./helpers";
import { expectControlledWithEngine, hostedGame, installWorker } from "./offlineHelpers";

/**
 * The engine package is checked byte for byte before it runs (#985, criterion
 * 5, design section 6.2 specs 1, 2, 3 and 6). The shell carries the id and the
 * digests of the package it was built with; the loader fetches `BUILD.json`,
 * the glue and the binary, hashes what arrived, and refuses unless it is that
 * package. Here the cache or the network is made to serve something else, and
 * the page must refuse it with a reason, instantiate nothing, and add no
 * reload of its own.
 *
 * It runs on `chromium-wasm`, where a refusal leaves the game on the
 * TypeScript engine, and on `chromium-wasm-only`, where it stops behind the
 * engine failure message. Instrumentation, installed before the page's own
 * scripts: counters on `WebAssembly.instantiate` and friends and on Blob URLs
 * for scripts. A refused package must leave both at zero; a good boot must
 * move them (so a broken spy cannot pass the refusals).
 */
test.beforeEach(({}, info) => test.skip(!onWasm(info.project.name), "the engine check runs on the chromium-wasm and chromium-wasm-only projects"));
test.setTimeout(90_000);

const dist = new URL("../dist/engine/BUILD.json", import.meta.url);
type BuildRecord = { package: string; files: Record<string, { sha256: string; bytes: number }> };
// Read on first use, so a project that skips the file never needs dist/engine.
let record: BuildRecord | undefined;
const built = new Proxy({} as BuildRecord, { get: (_, key: keyof BuildRecord) => (record ??= JSON.parse(readFileSync(dist, "utf8")) as BuildRecord)[key] });
const short = (id: string) => id.slice(0, 12);

/** A valid WebAssembly custom section: the binary still validates, so only
 *  the byte check can stop it. */
const SALT_SECTION = [0x00, 0x03, 0x01, 0x42, 0x00];

interface Boot {
  build: string;
  engine: string;
  failure: { stage: string; reason: string; message: string; package?: { kind: string; file: string | null; expected: string | null; found: string | null; expectedPackage: string | null; servedPackage: string | null; controlled: boolean } } | null;
}

const bootState = (page: Page) => page.evaluate(() => (window as any).__vcEngineBoot as Boot);

/** Count what a refused package must never reach, from before any page script. */
async function spy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { instantiate: 0, scriptBlobs: 0 };
    (window as any).__engineSpy = seen;
    for (const name of ["instantiate", "instantiateStreaming", "compile", "compileStreaming"] as const) {
      const real = WebAssembly[name] as (...a: unknown[]) => unknown;
      (WebAssembly as any)[name] = function (...args: unknown[]) {
        seen.instantiate++;
        return real.apply(this, args);
      };
    }
    // The glue's synchronous path (`initSync`) builds a Module and an Instance directly.
    for (const name of ["Module", "Instance"] as const) {
      (WebAssembly as any)[name] = new Proxy(WebAssembly[name], {
        construct(target, args, newTarget) {
          seen.instantiate++;
          return Reflect.construct(target, args, newTarget);
        },
      });
    }
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      if (obj instanceof Blob && obj.type === "text/javascript") seen.scriptBlobs++;
      return create(obj);
    };
  });
}

const spied = (page: Page) => page.evaluate(() => ({ ...(window as any).__engineSpy }) as { instantiate: number; scriptBlobs: number });

/** Install the worker, then reload so the page is controlled and boots from the precache. */
async function installed(page: Page): Promise<void> {
  await installWorker(page);
  await page.reload();
  await expectControlledWithEngine(page);
}

type Which = "glue" | "wasm" | "record";
const ENGINE_PATH: Record<Which, string> = { glue: "engine/verticopolis_engine.js", wasm: "engine/verticopolis_engine_bg.wasm", record: "engine/BUILD.json" };

/** Replace one cached engine response under its own key. `how` is a source:
 *  `salt` appends (a valid module, or a trailing comment), `flip` changes the
 *  last byte (the size stays), `record` names another package. */
async function tamperCache(page: Page, which: Which, how: "salt" | "flip" | "record"): Promise<void> {
  const done = await page.evaluate(
    async ([path, kind, how, salt]) => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (new URL(request.url).pathname !== `/${path}`) continue;
          const old = await cache.match(request);
          let bytes = new Uint8Array(await old!.arrayBuffer());
          if (how === "salt") bytes = kind === "wasm" ? new Uint8Array([...bytes, ...salt]) : new Uint8Array([...bytes, ...new TextEncoder().encode("\n// salt\n")]);
          else if (how === "flip") bytes = bytes.map((b, i) => (i === bytes.length - 1 ? (b === 0x20 ? 0x0a : 0x20) : b));
          else bytes = new TextEncoder().encode(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(bytes)), package: "e".repeat(64) }));
          // A body of another length must not keep the old Content-Length, or
          // the entry would read as a cut-off download rather than a mismatch.
          const headers = new Headers(old!.headers);
          headers.delete("content-length");
          await cache.put(request, new Response(bytes, { headers }));
          return true;
        }
      }
      return false;
    },
    [ENGINE_PATH[which], which, how, SALT_SECTION] as const,
  );
  expect(done, `${ENGINE_PATH[which]} is in the precache`).toBe(true);
}

/** The page refused the engine: the boot state says why, nothing was
 *  instantiated, and what the player sees matches the build. */
async function expectRefused(page: Page, file: "glue" | "wasm" | "build-record"): Promise<NonNullable<Boot["failure"]>> {
  const wasmOnly = test.info().project.name === WASM_ONLY_PROJECT;
  await page.waitForFunction(() => (window as any).__vcEngineBoot?.failure != null, undefined, { timeout: 30_000 });
  const state = await bootState(page);
  expect(state.failure, "the boot state names the refusal").toMatchObject({ stage: "load", reason: "package-mismatch", package: { kind: "mismatch", file, expectedPackage: short(built.package) } });
  expect(state.engine).toBe(wasmOnly ? "none" : "ts");
  expect(await spied(page), "nothing was compiled or imported from the refused bytes").toEqual({ instantiate: 0, scriptBlobs: 0 });
  expect(await page.evaluate(() => !!(window as any).__vcEngine?.status?.hosted)).toBe(false);
  if (wasmOnly) {
    const failure = page.locator("#engine-failure");
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute("role", "alert");
    await expect(page.locator("#boot-fallback button")).toBeFocused();
    expect(await page.evaluate(() => !!(window as any).game)).toBe(false);
  } else {
    // The default build keeps the game on the TypeScript engine.
    await page.waitForFunction(() => !!(window as any).game, undefined, { timeout: 30_000 });
  }
  return state.failure!;
}

/** Page loads from now on. The `load` event fires for a reload or a
 *  navigation, not for a same-document change such as `history.replaceState`. */
function navigations(page: Page): { count: number } {
  const seen = { count: 0 };
  page.on("load", () => void seen.count++);
  return seen;
}

test("the precache holds exactly the package the shell was built with, and the page checks it", async ({ page }) => {
  await spy(page);
  const record = page.waitForResponse((r) => new URL(r.url()).pathname === "/engine/BUILD.json" && r.fromServiceWorker(), { timeout: 30_000 });
  await installed(page);
  await hostedGame(page);
  expect((await record).ok(), "the page read BUILD.json through the worker's precache").toBe(true);
  const cached = await page.evaluate(async (paths) => {
    const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
    const out: Record<string, { sha256: string; bytes: number }> = {};
    for (const path of paths) {
      const response = await caches.match(new URL(path, document.baseURI).href, { ignoreSearch: true });
      const body = await response!.arrayBuffer();
      out[path] = { sha256: hex(await crypto.subtle.digest("SHA-256", body)), bytes: body.byteLength };
    }
    return out;
  }, [ENGINE_PATH.glue, ENGINE_PATH.wasm, ENGINE_PATH.record]);
  const onDisk = readFileSync(dist);
  expect(cached[ENGINE_PATH.record], "the cached record is the one dist/ was built with").toEqual({ sha256: createHash("sha256").update(onDisk).digest("hex"), bytes: onDisk.byteLength });
  expect(cached["engine/verticopolis_engine.js"]).toEqual(built.files["verticopolis_engine.js"]);
  expect(cached["engine/verticopolis_engine_bg.wasm"]).toEqual(built.files["verticopolis_engine_bg.wasm"]);
  // A good boot moves the spies, so the refusals below are not passing on a dead spy.
  const moved = await spied(page);
  expect(moved.instantiate).toBeGreaterThan(0);
  expect(moved.scriptBlobs).toBeGreaterThan(0);
  expect(await bootState(page)).toMatchObject({ engine: "wasm", failure: null });
});

test.describe("a tampered precache is refused", () => {
  test("a binary with another build's bytes", async ({ page }) => {
    await spy(page);
    await installed(page);
    await tamperCache(page, "wasm", "salt");
    await page.reload();
    const failure = await expectRefused(page, "wasm");
    // The size differs, so the check refuses before hashing.
    expect(failure.package?.found).toBeNull();
    expect(failure.package?.servedPackage, "the record that came with it names the shell's own package").toBe(short(built.package));
    expect(failure.package?.expected).toBe(short(built.files["verticopolis_engine_bg.wasm"].sha256));
    expect(failure.package?.controlled).toBe(true);
  });

  test("a glue of the same size with another digest", async ({ page }) => {
    await spy(page);
    await installed(page);
    await tamperCache(page, "glue", "flip");
    await page.reload();
    const failure = await expectRefused(page, "glue");
    expect(failure.package?.expected).toBe(short(built.files["verticopolis_engine.js"].sha256));
    expect(failure.package?.found, "the digest that arrived is reported").toMatch(/^[0-9a-f]{12}$/);
    expect(failure.package?.found).not.toBe(failure.package?.expected);
    expect(failure.package?.servedPackage).toBe(short(built.package));
  });

  test("a record that names another package", async ({ page }) => {
    await spy(page);
    await installed(page);
    await tamperCache(page, "record", "record");
    await page.reload();
    const failure = await expectRefused(page, "build-record");
    expect(failure.package?.servedPackage).toBe("e".repeat(12));
  });

  test("a persisting mismatch causes no reload of the page's own", async ({ page }) => {
    await spy(page);
    await installed(page);
    await tamperCache(page, "wasm", "salt");
    const seen = navigations(page);
    await page.reload();
    await expectRefused(page, "wasm");
    // Long enough for a reload loop to show, and past the browser's own
    // worker update check (about two seconds after a load).
    await page.waitForTimeout(5_000);
    expect(seen.count, "only the player's own reload; the page adds none").toBe(1);
  });
});

test.describe("an uncontrolled page", () => {
  test.use({ serviceWorkers: "block" });

  test("refuses a binary from another build served over the network", async ({ page }) => {
    await spy(page);
    await page.route("**/engine/verticopolis_engine_bg.wasm", async (route) => {
      const response = await route.fetch();
      const body = Buffer.concat([await response.body(), Buffer.from(SALT_SECTION)]);
      // The new length goes in the header, so the refusal is the digest's, not a cut body's.
      await route.fulfill({ response, body, headers: { ...response.headers(), "content-length": String(body.length) } });
    });
    await page.goto("/");
    const failure = await expectRefused(page, "wasm");
    expect(failure.package?.controlled, "no worker controlled this page").toBe(false);
  });

  test("refuses a glue from another build served over the network", async ({ page }) => {
    await spy(page);
    await page.route("**/engine/verticopolis_engine.js", async (route) => {
      const response = await route.fetch();
      const body = Buffer.from(`${await response.text()}\n// another build\n`);
      await route.fulfill({ response, body, headers: { ...response.headers(), "content-length": String(body.length) } });
    });
    await page.goto("/");
    const failure = await expectRefused(page, "glue");
    expect(failure.package?.controlled).toBe(false);
  });
});

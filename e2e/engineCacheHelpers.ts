import { expect, type Page } from "@playwright/test";
import { expectControlledWithEngine, installWorker } from "./offlineHelpers";

/** A valid WebAssembly custom section: the binary still validates, so only
 *  the byte check can stop it. */
export const SALT_SECTION = [0x00, 0x03, 0x01, 0x42, 0x00];

/** Install the worker, then reload so the page is controlled and boots from the precache. */
export async function installed(page: Page): Promise<void> {
  await installWorker(page);
  await page.reload();
  await expectControlledWithEngine(page);
}

export type Which = "glue" | "wasm" | "record";
export const ENGINE_PATH: Record<Which, string> = { glue: "engine/verticopolis_engine.js", wasm: "engine/verticopolis_engine_bg.wasm", record: "engine/BUILD.json" };

/** Replace one cached engine response under its own key. `how` is a source:
 *  `salt` appends (a valid module, or a trailing comment), `flip` changes the
 *  last byte (the size stays), `record` names another package. */
export async function tamperCache(page: Page, which: Which, how: "salt" | "flip" | "record"): Promise<void> {
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


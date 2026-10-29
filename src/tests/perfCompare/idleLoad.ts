import type { BrowserContext, Page } from "playwright";
import { wasmIdleBuffered, wasmIdleStreamed } from "./page";
import type { PerfServer } from "./server";
import type { IdleLoad } from "./types";

/** The package's download and compile in a blank same-origin page (#1005),
 *  each way in a context of its own: V8 keeps a compiled module by its bytes,
 *  so a second compile in one process would answer from the first, and a
 *  fresh context also starts with an empty HTTP cache. The blank page is a
 *  route the harness answers itself, so no app runs in it. `newContext` makes
 *  the runner's own context (so the context-loss recorder is on it) and
 *  `within` is its bounded wait. Auxiliary: a way that fails leaves its
 *  record null with the reason and fails nothing. */
export async function idleLoad(
  server: PerfServer,
  newContext: () => Promise<BrowserContext>,
  within: <T>(what: string, p: Promise<T>) => Promise<T>,
): Promise<IdleLoad> {
  const out: IdleLoad = { buffered: null, streamed: null, error: null };
  const wasmUrl = `${server.url}/engine/verticopolis_engine_bg.wasm`;
  const blank = `${server.url}/__idle`;
  const way = async <R>(measure: (page: Page) => Promise<R>): Promise<R> => {
    const ctx = await newContext();
    try {
      const page = await ctx.newPage();
      await page.route(blank, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>idle</title>" }));
      await page.goto(blank, { waitUntil: "load" });
      return await measure(page);
    } finally {
      await ctx.close().catch(() => {});
    }
  };
  const failures: string[] = [];
  try {
    out.buffered = await way((page) => within("idle buffered load", page.evaluate(wasmIdleBuffered, { wasmUrl })));
  } catch (e) {
    failures.push(`buffered: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    out.streamed = await way((page) => within("idle streamed load", page.evaluate(wasmIdleStreamed, { wasmUrl })));
  } catch (e) {
    failures.push(`streamed: ${e instanceof Error ? e.message : String(e)}`);
  }
  out.error = failures.length ? failures.join("; ") : null;
  return out;
}

import { ENGINE_BUILD_RECORD, ENGINE_DIR, ENGINE_GLUE, ENGINE_WASM } from "../wasmhost/enginePackageNames.ts";

/**
 * The game page asks the browser for the engine package's three files as soon
 * as it reads the page's head, so they download beside the main bundle
 * instead of after it (#1254; the `engine-preload` plugin in vite.config.ts
 * adds the links). The loader's `fetch` calls claim those responses, which
 * only works when each link is a cors fetch preload of exactly the URL the
 * loader asks for. Keep this file ERASABLE (type-only TypeScript syntax):
 * scripts/verify-precache.ts imports it under plain `node`.
 */

/** The attributes of the link tag for one engine file. A browser reuses a
 *  preloaded response only for a request with the same URL, mode and
 *  credentials mode. The loader calls `fetch(url, { signal })`, which is a
 *  cors request with the default credentials mode, and `as="fetch"` with
 *  `crossorigin="anonymous"` is the preload that matches it. If the loader's
 *  fetch options change, change these attributes with them: a mismatch is not
 *  reused and the file downloads twice (the built page's check cannot see the
 *  loader, so only a browser run shows it; the server's request count per file
 *  is the tell). */
export function enginePreloadAttrs(file: string): { rel: string; as: string; href: string; crossorigin: string } {
  return { rel: "preload", as: "fetch", href: `./${ENGINE_DIR}${file}`, crossorigin: "anonymous" };
}

/** The three files the page preloads: the loader fetches each of them. */
export const ENGINE_PRELOAD_FILES: readonly string[] = [ENGINE_BUILD_RECORD, ENGINE_GLUE, ENGINE_WASM];

/** The attributes of one tag, name to value, for double-quoted values (the form the build writes). */
function attributesOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:][-\w:.]*)\s*=\s*"([^"]*)"/g)) out[m[1].toLowerCase()] = m[2];
  return out;
}

/** What is wrong with the preload links in the built game page (empty when it is right).
 *  A link counts as a fetch preload when its own `rel` and `as` attributes say so (not
 *  a lookalike such as `data-rel`). The three engine files must each be preloaded once,
 *  with the cors attribute; any other fetch preload under the engine folder is refused
 *  too, since it would download a file the loader never claims. Fetch preloads of
 *  anything else are not this check's business. */
export function enginePreloadProblems(html: string): string[] {
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => attributesOf(m[0])).filter((a) => a.rel === "preload" && a.as === "fetch");
  const problems: string[] = [];
  for (const file of ENGINE_PRELOAD_FILES) {
    const want = enginePreloadAttrs(file);
    const found = links.filter((a) => a.href === want.href);
    if (found.length === 0) problems.push(`the page does not preload ${want.href}`);
    else if (found.length > 1) problems.push(`the page preloads ${want.href} ${found.length} times`);
    else if (found[0].crossorigin !== want.crossorigin) problems.push(`the preload of ${want.href} is not a cors request with same-origin credentials, so the loader's fetch cannot claim it`);
  }
  const wanted = new Set(ENGINE_PRELOAD_FILES.map((f) => enginePreloadAttrs(f).href));
  for (const a of links) {
    if (a.href?.startsWith(`./${ENGINE_DIR}`) && !wanted.has(a.href)) problems.push(`the page preloads ${a.href}, which the loader never fetches`);
  }
  return problems;
}

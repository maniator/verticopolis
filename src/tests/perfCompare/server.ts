import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/**
 * The static server the comparison loads the build from (issue #972). It
 * stands in for the deployment so transfer sizes and cache behavior are
 * measured, not guessed:
 * - Cache-Control follows vercel.json (hashed `/assets/` immutable for a
 *   year, `version.json` no-store, everything else revalidated with an ETag,
 *   which is the host's default for static files).
 * - Text types and the `.wasm` are served Brotli (quality 11) or gzip
 *   (level 9) when the browser accepts them, the way a CDN's static
 *   compression would. The real CDN's levels may differ; the report says so.
 * - Every response carries COOP/COEP/CORP, making the page cross-origin
 *   isolated so `performance.now()` resolves to 5 microseconds instead of
 *   100. The build loads nothing cross-origin, so isolation changes no
 *   behavior; the report records it as a measurement condition.
 * - Each response's body bytes are tallied, so "transferred" is what the
 *   server actually sent.
 */

export interface ServedRequest {
  path: string;
  status: number;
  /** Body bytes written (after compression). */
  bytes: number;
  encoding: "br" | "gzip" | "identity";
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/** Whether a file of this extension is served compressed. */
export function compressible(ext: string): boolean {
  return [".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".wasm", ".svg", ".txt", ".map", ".ico"].includes(ext);
}

/** The Cache-Control a path gets, per vercel.json. */
export function cacheControlFor(path: string): string {
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (path === "/version.json") return "no-store";
  return "public, max-age=0, must-revalidate";
}

/** Which encoding to answer an Accept-Encoding header with. */
export function pickEncoding(accept: string | undefined, ext: string): ServedRequest["encoding"] {
  if (!compressible(ext) || !accept) return "identity";
  const offered = accept.split(",").map((s) => s.trim().split(";")[0]);
  if (offered.includes("br")) return "br";
  if (offered.includes("gzip")) return "gzip";
  return "identity";
}

interface Entry {
  raw: Buffer;
  br?: Buffer;
  gzip?: Buffer;
  etag: string;
}

export interface PerfServer {
  url: string;
  /** Requests served since the last call, then cleared. */
  take(): ServedRequest[];
  close(): Promise<void>;
}

export async function startServer(root: string, port = 0): Promise<PerfServer> {
  if (!existsSync(join(root, "index.html"))) throw new Error(`no build at ${root} (index.html missing)`);
  const cache = new Map<string, Entry>();
  const log: ServedRequest[] = [];
  const entry = (file: string): Entry => {
    let e = cache.get(file);
    if (!e) {
      const raw = readFileSync(file);
      e = { raw, etag: `"${createHash("sha1").update(raw).digest("hex")}"` };
      if (compressible(extname(file))) {
        e.br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
        e.gzip = gzipSync(raw, { level: 9 });
      }
      cache.set(file, e);
    }
    return e;
  };
  // Compress every file up front: compressing on first request would charge
  // Brotli's cost to whichever process happened to ask first.
  const warm = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) warm(p);
      else entry(p);
    }
  };
  warm(root);
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    const isolation = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin" };
    if (!file.startsWith(normalize(root) + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain", ...isolation });
      res.end("not found");
      log.push({ path, status: 404, bytes: 9, encoding: "identity" });
      return;
    }
    const ext = extname(file);
    const e = entry(file);
    const headers: Record<string, string> = {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": cacheControlFor(path),
      ETag: e.etag,
      Vary: "Accept-Encoding",
      ...isolation,
    };
    if (path === "/sw.js") headers["Service-Worker-Allowed"] = "/";
    if (req.headers["if-none-match"] === e.etag) {
      res.writeHead(304, headers);
      res.end();
      log.push({ path, status: 304, bytes: 0, encoding: "identity" });
      return;
    }
    const encoding = pickEncoding(req.headers["accept-encoding"], ext);
    const bodies = { br: e.br, gzip: e.gzip, identity: e.raw };
    const body = bodies[encoding] ?? e.raw;
    if (encoding !== "identity") headers["Content-Encoding"] = encoding;
    headers["Content-Length"] = String(body.length);
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
    log.push({ path, status: 200, bytes: req.method === "HEAD" ? 0 : body.length, encoding });
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => ok());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("the server has no port");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    take: () => log.splice(0, log.length),
    close: () =>
      new Promise<void>((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      }),
  };
}

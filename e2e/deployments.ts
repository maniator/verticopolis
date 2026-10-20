import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { engineBuildRecord } from "../src/wasmhost/enginePackageRecord";
import { ENGINE_GLUE, ENGINE_WASM } from "../src/wasmhost/enginePackageNames";

/**
 * Two deployments of the game behind one origin (#985). The first is the
 * production build in `dist/` (the one `npm run e2e` serves). The second is a
 * copy of it with a different engine glue file and binary and every identity the service
 * worker and the page read kept consistent: the glue's precache revision and
 * integrity, `engine/BUILD.json` and its precache entry, and `version.json`.
 * The server answers from whichever one `serve()` last picked, so a test can
 * install the first, "deploy" the second, and watch the update flow move
 * between them.
 *
 * Playwright's `page.route` does not see a service worker's own requests, so
 * the switch lives in a real HTTP server the browser and the worker both reach.
 * Cache-Control follows vercel.json: `sw.js` and everything outside `/assets/`
 * is revalidated, `version.json` is never stored, hashed assets are immutable.
 * It is a static server only: no ETag or 304, no Range, and none of
 * vercel.json's rewrites (`/help`, `/gallery`), none of which the flow needs.
 *
 * The second deployment's page bundle is the first's, so the package id
 * compiled into the shell (`__ENGINE_PACKAGE__`) is still the first's. Nothing
 * reads it at run time yet. When the loader checks the engine against it
 * (#985 slice 2), rewriting that value in the copied chunk will not do: the
 * chunk keeps its hashed name, is served immutable, and so the second install
 * would keep the first's cached copy. That slice needs a real second
 * `vite build` with a different engine package (design section 6.2).
 */

export type Deployment = "A" | "B";

export interface Deployments {
  /** The origin both deployments answer on. */
  readonly origin: string;
  /** Pick the deployment later requests are answered from. */
  serve(which: Deployment): void;
  /** Make `version.json` answer 404, as it does when the host or the network drops it. */
  failVersionJson(failing: boolean): void;
  /** Every path requested so far, in order, with the deployment that answered. */
  readonly requests: { path: string; from: Deployment }[];
  /** The engine package id each deployment's `BUILD.json` records. */
  readonly packageId: Record<Deployment, string>;
  /** The precache revision each deployment's `sw.js` records for each engine entry. */
  readonly revisions: Record<Deployment, { glue: string; wasm: string; record: string }>;
  /** How many entries each deployment's `sw.js` precaches. */
  readonly manifestEntries: Record<Deployment, number>;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".mjs": "text/javascript; charset=utf-8",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".xml": "application/xml",
  ".woff": "font/woff",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const md5 = (data: Uint8Array | string): string => createHash("md5").update(data).digest("hex");
const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");
const sha256Integrity = (data: Uint8Array | string): string => `sha256-${createHash("sha256").update(data).digest("base64")}`;

/** Point the precache entry for `url` at new bytes: its revision and integrity. */
function repointEntry(sw: string, url: string, bytes: Uint8Array | string): string {
  const entry = new RegExp(`(\\{url:"${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",revision:")[a-f0-9]+(",integrity:)"[^"]+"`);
  if (!entry.test(sw)) throw new Error(`sw.js has no precache entry with an integrity for ${url}; did the manifest shape change?`);
  return sw.replace(entry, `$1${md5(bytes)}$2"${sha256Integrity(bytes)}"`);
}

/** A WebAssembly custom section named "B" with a one-byte payload: the binary
 *  stays valid and loads, and its bytes (and so its hash) differ. */
const SALT_SECTION = Buffer.from([0x00, 0x03, 0x01, 0x42, 0x00]);

/** The revision `sw.js` records for a precached `url`, and how many entries it lists. */
function manifestOf(sw: string): { revisionOf(url: string): string; entries: number } {
  const entries = sw.match(/\{url:"/g)?.length ?? 0;
  return {
    entries,
    revisionOf: (url) => {
      const found = new RegExp(`\\{url:"${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",revision:"([a-f0-9]+)"`).exec(sw);
      if (!found) throw new Error(`sw.js has no revisioned precache entry for ${url}`);
      return found[1];
    },
  };
}

/** Build the second deployment from the first, in a new folder under `into`. */
function makeSecond(dist: string, into: string): { dir: string; packageId: string } {
  const dir = join(into, "B");
  cpSync(dist, dir, { recursive: true });
  const glue = join(dir, "engine", ENGINE_GLUE);
  const wasmPath = join(dir, "engine", ENGINE_WASM);
  const wasm = Buffer.concat([readFileSync(wasmPath), SALT_SECTION]);
  writeFileSync(wasmPath, wasm);
  const changed = Buffer.concat([readFileSync(glue), Buffer.from("\n// deployment B\n")]);
  writeFileSync(glue, changed);

  const first = JSON.parse(readFileSync(join(dist, "engine", "BUILD.json"), "utf8")) as { sources: string };
  const record = engineBuildRecord(changed, wasm, first.sources, sha256Hex);
  const recordText = `${JSON.stringify(record, null, 2)}\n`;
  writeFileSync(join(dir, "engine", "BUILD.json"), recordText);

  const swPath = join(dir, "sw.js");
  const swFirst = readFileSync(swPath, "utf8");
  let sw = swFirst;
  sw = repointEntry(sw, `engine/${ENGINE_GLUE}`, changed);
  sw = repointEntry(sw, `engine/${ENGINE_WASM}`, wasm);
  sw = repointEntry(sw, "engine/BUILD.json", recordText);
  // The browser updates only when sw.js differs byte for byte; fail here, with
  // the reason, rather than at a test timeout.
  if (sw === swFirst) throw new Error("the second deployment's sw.js is identical to the first's, so no update would be found");
  writeFileSync(swPath, sw);

  const versionPath = join(dir, "version.json");
  const version = JSON.parse(readFileSync(versionPath, "utf8")) as Record<string, unknown>;
  writeFileSync(versionPath, JSON.stringify({ ...version, version: "999.0.0", sha: "bbbbbbb", notes: [] }));
  return { dir, packageId: record.package };
}

function cacheControl(path: string): string {
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (path === "/version.json") return "no-store";
  return "public, max-age=0, must-revalidate";
}

/** Start the two-deployment server on a free loopback port. */
export async function startDeployments(distDir = fileURLToPath(new URL("../dist", import.meta.url))): Promise<Deployments> {
  const dist = resolve(distDir);
  if (!existsSync(join(dist, "sw.js"))) throw new Error("dist/ has no sw.js; run a production build first (npm run build)");
  const scratch = mkdtempSync(join(tmpdir(), "vc-deployments-"));
  let second: ReturnType<typeof makeSecond>;
  try {
    second = makeSecond(dist, scratch);
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
  const roots: Record<Deployment, string> = { A: dist, B: second.dir };
  const firstRecord = JSON.parse(readFileSync(join(dist, "engine", "BUILD.json"), "utf8")) as { package: string };
  // What each deployment's own sw.js says it precaches. The test compares the
  // cache with these values and computes none of its own.
  const manifests = {
    A: manifestOf(readFileSync(join(roots.A, "sw.js"), "utf8")),
    B: manifestOf(readFileSync(join(roots.B, "sw.js"), "utf8")),
  };
  const revisionsOf = (m: ReturnType<typeof manifestOf>) => ({
    glue: m.revisionOf(`engine/${ENGINE_GLUE}`),
    wasm: m.revisionOf(`engine/${ENGINE_WASM}`),
    record: m.revisionOf("engine/BUILD.json"),
  });
  let current: Deployment = "A";
  let versionJsonFails = false;
  const requests: Deployments["requests"] = [];

  const server: Server = createServer((req, res) => {
    // Each response keeps the root it started with, so a switch mid-stream
    // cannot change what a response already begun carries.
    const root = roots[current];
    const from = current;
    const target = req.url ?? "/";
    // Origin-form only, one leading slash, nothing that names a drive or stream.
    const path = /^\/(?!\/)/.test(target) ? new URL(target, "http://localhost").pathname : "/\0";
    requests.push({ path, from });
    if (versionJsonFails && path === "/version.json") {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      decoded = "/\0";
    }
    const file = normalize(join(root, decoded === "/" ? "index.html" : decoded));
    if (decoded.includes("\0") || decoded.includes(":") || !file.startsWith(root + sep) || !existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "content-length": body.length,
        "cache-control": cacheControl(path),
      });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    serve: (which) => {
      current = which;
    },
    failVersionJson: (failing) => {
      versionJsonFails = failing;
    },
    requests,
    packageId: { A: firstRecord.package, B: second.packageId },
    revisions: { A: revisionsOf(manifests.A), B: revisionsOf(manifests.B) },
    manifestEntries: { A: manifests.A.entries, B: manifests.B.entries },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}

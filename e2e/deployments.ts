import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { shellProblems } from "../src/build/enginePackageBuild";
import { engineBuildRecord } from "../src/wasmhost/enginePackageRecord";
import { ENGINE_GLUE, ENGINE_WASM } from "../src/wasmhost/enginePackageNames";

/**
 * Two deployments of the game behind one origin (#985). The first is the
 * production build in `dist/` (the one `npm run e2e` serves). The second is a
 * real second `vite build` of the same source over a public folder whose
 * engine glue and binary differ (a trailing comment, and a valid WebAssembly
 * custom section) and whose `BUILD.json` describes them. Its shell therefore
 * carries the second package's id (`__ENGINE_PACKAGE__`), and its `sw.js`,
 * precache revisions and integrity all come from the build, not from edits
 * here; only `version.json` is rewritten, so the update prompt names a build.
 * The server answers from whichever one `serve()` last picked, so a test can
 * install the first, "deploy" the second, and watch the update flow move
 * between them. A rewrite of the first build's files could not stand in: the
 * shell chunk keeps its hashed name and is served immutable, so the second
 * install would keep the first's cached copy and its id (design section 6.2).
 *
 * Playwright's `page.route` does not see a service worker's own requests, so
 * the switch lives in a real HTTP server the browser and the worker both reach.
 * Cache-Control follows vercel.json: `sw.js` and everything outside `/assets/`
 * is revalidated, `version.json` is never stored, hashed assets are immutable.
 * It is a static server only: no ETag or 304, no Range, and none of
 * vercel.json's rewrites (`/help`, `/gallery`), none of which the flow needs.
 */

export type Deployment = "A" | "B";

export interface Deployments {
  /** The origin both deployments answer on. */
  readonly origin: string;
  /** Pick the deployment later requests are answered from. */
  serve(which: Deployment): void;
  /** Answer `sw.js` of the first deployment with one extra comment line, so the browser finds a new worker whose precache manifest is identical (the same engine bytes under the same keys). */
  reissueWorker(on: boolean): void;
  /** Answer every `/engine/` request from `which` whatever `serve()` picked, as a deploy that lands between the worker script and the engine files does; `null` ends it. */
  engineFrom(which: Deployment | null): void;
  /** Make `version.json` answer 404, as it does when the host or the network drops it. */
  failVersionJson(failing: boolean): void;
  /** Every path requested so far, in order, with the deployment that answered. */
  readonly requests: { path: string; from: Deployment }[];
  /** The SHA-256 (hex) of each deployment's engine glue, binary and record as served. */
  readonly digests: Record<Deployment, { glue: string; wasm: string; record: string }>;
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

const sha256Hex = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

/** A WebAssembly custom section named "B" with a one-byte payload: the binary
 *  stays valid and loads, and its bytes (and so its hash) differ. */
const SALT_SECTION = Buffer.from([0x00, 0x03, 0x01, 0x42, 0x00]);

/** The revision `sw.js` records for a precached `url`, and how many entries it lists. */
function manifestOf(sw: string): { revisionOf(url: string): string; entries: number } {
  const entries = sw.match(/\{url:"/g)?.length ?? 0;
  return {
    entries,
    revisionOf: (url) => {
      const found = new RegExp(`\\{url:"${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",revision:"([a-f0-9]{32}(?:-i\\d+)?)"`).exec(sw);
      if (!found) throw new Error(`sw.js has no revisioned precache entry for ${url}`);
      return found[1];
    },
  };
}

const REPO = fileURLToPath(new URL("..", import.meta.url));

/** `VC_ENGINE` for a build that has the first build's engine mode. Spelled out
 *  both ways, so a changed default cannot give the second deployment another
 *  shell; a `version.json` that names neither is an error. */
function engineModeOf(engineBuild: string | undefined): "wasm" | "switchable" {
  if (engineBuild === "wasm-only") return "wasm";
  if (engineBuild === "switchable") return "switchable";
  throw new Error(`version.json names no engine build (found ${JSON.stringify(engineBuild)}), so the second deployment cannot match the first`);
}

/** Build the second deployment in a new folder under `into`: a copy of the
 *  public folder with the first build's engine package salted and recorded,
 *  built into `B/` by the same `vite build` as the first, in the same modes. */
function makeSecond(dist: string, into: string): { dir: string; packageId: string } {
  const publicDir = join(into, "public-B");
  cpSync(join(REPO, "src", "public"), publicDir, { recursive: true });
  cpSync(join(dist, "engine"), join(publicDir, "engine"), { recursive: true });
  const glue = join(publicDir, "engine", ENGINE_GLUE);
  const wasmPath = join(publicDir, "engine", ENGINE_WASM);
  const wasm = Buffer.concat([readFileSync(wasmPath), SALT_SECTION]);
  writeFileSync(wasmPath, wasm);
  const changed = Buffer.concat([readFileSync(glue), Buffer.from("\n// deployment B\n")]);
  writeFileSync(glue, changed);
  const first = JSON.parse(readFileSync(join(dist, "engine", "BUILD.json"), "utf8")) as { sources: string };
  const record = engineBuildRecord(changed, wasm, first.sources, sha256Hex);
  writeFileSync(join(publicDir, "engine", "BUILD.json"), `${JSON.stringify(record, null, 2)}\n`);

  const firstVersion = JSON.parse(readFileSync(join(dist, "version.json"), "utf8")) as { engineBuild?: string };
  const dir = join(into, "B");
  const built = spawnSync(process.execPath, [join(REPO, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", dir, "--emptyOutDir"], {
    cwd: REPO,
    encoding: "utf8",
    timeout: 200_000,
    env: {
      ...process.env,
      // The e2e builds A with the tooling handle too (specs drive `window.game`).
      VC_TOOLING: "1",
      VC_PUBLIC_DIR: publicDir,
      // The same engine mode as the first build, or the wrong shell is served.
      VC_ENGINE: engineModeOf(firstVersion.engineBuild),
    },
  });
  if (built.error) throw built.error;
  if (built.status !== 0) throw new Error(`the second deployment's vite build failed (${built.status ?? built.signal}):\n${(built.stderr || built.stdout || "").split("\n").slice(-30).join("\n")}`);
  // The second shell must check the second package, or the update would
  // prove nothing about the loader.
  const unsound = shellProblems(dir, true);
  if (unsound.length > 0) throw new Error(`the second deployment's shell does not match its engine package: ${unsound.join("; ")}`);
  // The browser updates only when sw.js differs byte for byte; fail here, with
  // the reason, rather than at a test timeout.
  if (readFileSync(join(dist, "sw.js"), "utf8") === readFileSync(join(dir, "sw.js"), "utf8")) {
    throw new Error("the second deployment's sw.js is identical to the first's, so no update would be found");
  }

  const versionPath = join(dir, "version.json");
  const version = JSON.parse(readFileSync(versionPath, "utf8")) as Record<string, unknown>;
  writeFileSync(versionPath, JSON.stringify({ ...version, version: "999.0.0", sha: "bbbbbbb", notes: [] }));
  return { dir, packageId: record.package };
}

function digestsOf(root: string): { glue: string; wasm: string; record: string } {
  const read = (name: string) => sha256Hex(readFileSync(join(root, "engine", name)));
  return { glue: read(ENGINE_GLUE), wasm: read(ENGINE_WASM), record: read("BUILD.json") };
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
  let workerReissued = false;
  let engineOverride: Deployment | null = null;
  const requests: Deployments["requests"] = [];

  const server: Server = createServer((req, res) => {
    // Each response keeps the root it started with, so a switch mid-stream
    // cannot change what a response already begun carries.
    const target = req.url ?? "/";
    // Origin-form only, one leading slash, nothing that names a drive or stream.
    const path = /^\/(?!\/)/.test(target) ? new URL(target, "http://localhost").pathname : "/\0";
    const from = engineOverride && path.startsWith("/engine/") ? engineOverride : current;
    const root = roots[from];
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
      let body = readFileSync(file);
      if (workerReissued && from === "A" && path === "/sw.js") body = Buffer.concat([body, Buffer.from("\n// reissued\n")]);
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
    reissueWorker: (on) => {
      workerReissued = on;
    },
    engineFrom: (which) => {
      engineOverride = which;
    },
    failVersionJson: (failing) => {
      versionJsonFails = failing;
    },
    requests,
    digests: { A: digestsOf(roots.A), B: digestsOf(roots.B) },
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

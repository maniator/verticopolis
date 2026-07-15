/**
 * Screenshot determinism guard, as a standalone script a person or an agent can
 * run, not logic buried in a workflow YAML. It renders a shard's scenes TWICE
 * from two INDEPENDENT builds and byte-compares the two renders: a difference is
 * nondeterminism (a wall-clock or RNG read leaking into a build or a capture),
 * always a bug. The reusable capture workflow (screenshot-capture.yml) calls this
 * once per shard; you can run the exact same check locally.
 *
 * Run:
 *   node scripts/screenshot-determinism-check.ts <shard>     one shard (e.g. misc)
 *   node scripts/screenshot-determinism-check.ts --all       every shard in turn
 *   node scripts/screenshot-determinism-check.ts --only first-run,crowd
 * Exit code is 0 when every checked shard is deterministic, 1 otherwise.
 *
 * Why two INDEPENDENT builds, not one build rendered twice: a value baked into
 * the bundle at build time (a timestamp, an RNG seed) would show identically in
 * two renders of one shared build, pass, then churn on the next regen. Each leg
 * therefore gets its OWN `vite build` (a separate process, so separate module
 * state), its OWN preview server on its OWN port, and its OWN output root. The
 * two legs run CONCURRENTLY, so wall-clock is about one leg's build+render rather
 * than two, without weakening the guard: the builds are still independent, they
 * only overlap in time.
 *
 * Process handling: each leg spawns `vite` DIRECTLY (via its bin under Node), not
 * through `npm`/`npx`. That means the preview server is a single process this
 * script OWNS, so tearing it down is `child.kill()` on the held handle, with no
 * reliance on matching a command line with `pkill`. The handles are tracked and
 * killed on exit or Ctrl-C too, so a run never orphans a preview server.
 *
 * Browser: honors PW_CHROME (the CI container exports the pinned Chromium path);
 * with it unset the generator falls back to a local Chromium, which is fine for a
 * local determinism check. The CANONICAL committed pixels still come only from CI
 * inside the pinned image, exactly as before.
 *
 * Keep this file ERASABLE (type annotations / interfaces / `as` only; no enums,
 * namespaces, or parameter properties) so `node scripts/...ts` runs it directly
 * via native type-stripping, and import siblings with an explicit `.ts` extension.
 */
import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_BIN = resolve(ROOT, "node_modules/vite/bin/vite.js");
const SHARDS = resolve(ROOT, "scripts/screenshot-shards.ts");
const GENERATOR = resolve(ROOT, "scripts/screenshots.ts");

// Per-leg isolation, under the OS temp dir so this works off Linux too; override
// the base with SCREENSHOT_TMP. The workflow's upload step stages run-a from the
// SAME base (it computes os.tmpdir() the same way), so the two stay aligned on any
// platform. Ports differ so a lingering server from one leg can never be mistaken
// for the other's.
const TMP = process.env.SCREENSHOT_TMP || tmpdir();
const LEGS = [
  { tag: "a", dest: join(TMP, "run-a"), outDir: join(TMP, "dist-a"), port: 4173 },
  { tag: "b", dest: join(TMP, "run-b"), outDir: join(TMP, "dist-b"), port: 4174 },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Preview servers this run owns, so a fatal error or Ctrl-C never orphans one.
const liveServers = new Set<ChildProcess>();

/** Print a readable stream line by line, each line prefixed with the leg tag, as
 *  the lines arrive. (Upstream tools still block-buffer their own stdout when it
 *  is a pipe, so bursts are possible, but nothing is lost or reordered.) */
function pipeTagged(tag: string, stream: NodeJS.ReadableStream | null): void {
  if (!stream) return;
  let buf = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      process.stdout.write(`[${tag}] ${buf.slice(0, nl)}\n`);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buf.length) process.stdout.write(`[${tag}] ${buf}\n`);
    buf = "";
  });
}

/** Spawn a child to completion, tagging its output, and resolve its exit code
 *  (a signal-kill or spawn error resolves non-zero, never rejects). */
function runTagged(tag: string, cmd: string, args: string[], opts: SpawnOptions): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const settle = (code: number): void => {
      if (!settled) {
        settled = true;
        resolvePromise(code);
      }
    };
    pipeTagged(tag, child.stdout);
    pipeTagged(tag, child.stderr);
    child.on("error", (err) => {
      process.stdout.write(`[${tag}] failed to spawn ${cmd}: ${err.message}\n`);
      settle(1);
    });
    child.on("close", (code, signal) => settle(code == null ? (signal ? 1 : 0) : code));
  });
}

/** Terminate an owned preview server and wait for it to actually exit, with a
 *  SIGKILL backstop. No `pkill`, no command-line matching: we hold the handle. */
function stopServer(server: ChildProcess): Promise<void> {
  return new Promise((resolvePromise) => {
    if (server.exitCode != null || server.signalCode != null) {
      liveServers.delete(server);
      return resolvePromise();
    }
    let done = false;
    let backstop: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      if (done) return;
      done = true;
      // Cancel the SIGKILL backstop the moment the server exits, so it can't fire
      // later against a since-reused PID.
      if (backstop) clearTimeout(backstop);
      liveServers.delete(server);
      resolvePromise();
    };
    server.once("close", finish);
    server.kill("SIGTERM");
    backstop = setTimeout(() => {
      try {
        server.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish();
    }, 5_000);
    if (typeof backstop.unref === "function") backstop.unref();
  });
}

/** Poll the preview server until it answers 200, or give up. */
async function waitForServer(port: number): Promise<boolean> {
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  return false;
}

/** One leg: clean build into its own outDir, start its own preview server, render
 *  the scenes into its own fresh output root, then tear the server down. Returns
 *  0 on success. */
async function runLeg(
  leg: { tag: string; dest: string; outDir: string; port: number },
  only: string,
): Promise<number> {
  const { tag, dest, outDir, port } = leg;
  rmSync(dest, { recursive: true, force: true });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  const buildRc = await runTagged(tag, process.execPath, [VITE_BIN, "build", "--outDir", outDir], {
    cwd: ROOT,
    env: process.env,
  });
  if (buildRc !== 0) {
    process.stdout.write(`[${tag}] build failed (exit ${buildRc})\n`);
    return buildRc || 1;
  }

  const server = spawn(
    process.execPath,
    [VITE_BIN, "preview", "--outDir", outDir, "--port", String(port), "--strictPort"],
    { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  liveServers.add(server);
  // A spawn-level error (EMFILE, exec failure) on a ChildProcess with no "error"
  // listener is re-thrown as an uncaughtException; log it and let the readiness
  // poll below fail the leg cleanly instead.
  server.on("error", (err) => process.stdout.write(`[${tag}] preview server error: ${err.message}\n`));
  pipeTagged(tag, server.stdout);
  pipeTagged(tag, server.stderr);

  try {
    if (!(await waitForServer(port))) {
      process.stdout.write(`[${tag}] preview server did not come up on :${port}\n`);
      return 1;
    }
    // If our OWN server process already exited, the port was answered by a stale
    // server from an earlier hard-killed run (--strictPort makes our vite exit
    // rather than bind a busy port). Rendering against a stale build would be
    // wrong, so fail loudly rather than trust the foreign 200.
    if (server.exitCode !== null || server.signalCode !== null) {
      process.stdout.write(`[${tag}] port :${port} is held by another (stale) preview server; refusing to render against it. Kill it and retry.\n`);
      return 1;
    }
    // Never let the generator spawn its OWN preview: this leg already owns one at
    // BASE_URL. Drop RUN_SERVER/PORT (which `npm run screenshots` sets) from the
    // inherited environment so a local run cannot collide on this leg's port.
    const childEnv = { ...process.env };
    delete childEnv.RUN_SERVER;
    delete childEnv.PORT;
    childEnv.SHOTS_DIR = join(dest, "docs/screenshots");
    childEnv.BASE_URL = `http://localhost:${port}`;
    childEnv.ONLY = only;
    return await runTagged(tag, process.execPath, [GENERATOR], { cwd: ROOT, env: childEnv });
  } finally {
    await stopServer(server);
  }
}

/** Every file under a root, relative and sorted, so two roots compare order-free. */
function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(relative(root, p));
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

/** Byte-compare two output roots. Returns a human reason on a difference, or null
 *  when the two are identical (the deterministic case). */
function diffRoots(a: string, b: string): string | null {
  const la = listFiles(a);
  const lb = listFiles(b);
  const sb = new Set(lb);
  const sa = new Set(la);
  const onlyA = la.filter((f) => !sb.has(f));
  const onlyB = lb.filter((f) => !sa.has(f));
  if (onlyA.length || onlyB.length) {
    return `the two renders produced different file sets (only in a: ${onlyA.join(", ") || "none"}; only in b: ${onlyB.join(", ") || "none"})`;
  }
  for (const f of la) {
    if (!readFileSync(join(a, f)).equals(readFileSync(join(b, f)))) {
      return `pixel bytes differ for ${f}`;
    }
  }
  return null;
}

function countPngs(root: string): number {
  return listFiles(root).filter((f) => f.endsWith(".png")).length;
}

/** The scene ids a shard renders, from the single source of truth. */
function scenesForShard(shard: string): string {
  return execFileSync(process.execPath, [SHARDS, "print", shard], { cwd: ROOT, encoding: "utf8" }).trim();
}

function allShards(): string[] {
  return JSON.parse(execFileSync(process.execPath, [SHARDS, "matrix"], { cwd: ROOT, encoding: "utf8" }).trim());
}

/** Check one shard's scene set: render twice in parallel, diff. True if deterministic. */
async function checkOnly(label: string, only: string): Promise<boolean> {
  if (!only) {
    process.stdout.write(`::error::no scenes to render for '${label}'; refusing to run (an empty ONLY renders every scene)\n`);
    return false;
  }
  process.stdout.write(`\nchecking '${label}': ${only}\n`);
  const [rcA, rcB] = await Promise.all(LEGS.map((leg) => runLeg(leg, only)));
  if (rcA !== 0 || rcB !== 0) {
    process.stdout.write(`::error::screenshot check '${label}' failed to render (leg a exit=${rcA}, leg b exit=${rcB}); see the [a]/[b] output above.\n`);
    return false;
  }
  const reason = diffRoots(LEGS[0].dest, LEGS[1].dest);
  if (reason) {
    process.stdout.write(`::error::screenshot check '${label}' is nondeterministic: ${reason}. A wall-clock/RNG read leaked into the build or a capture (likely a new time-driven decoration in the engine render path, or a build-time timestamp); fix it before screenshots can update.\n`);
    return false;
  }
  // Two identical EMPTY roots also byte-match, so a run that rendered nothing (a
  // mistyped scene id, a scene set that matched no real scene) would otherwise
  // read as "deterministic". Nothing was actually compared, so treat it as a
  // failure rather than a green pass.
  const shots = countPngs(LEGS[0].dest);
  if (shots === 0) {
    process.stdout.write(`::error::screenshot check '${label}' rendered 0 files, so nothing was compared; check the shard or scene ids.\n`);
    return false;
  }
  process.stdout.write(`'${label}' is deterministic (${shots} shot(s)).\n`);
  return true;
}

function usage(): never {
  process.stdout.write(
    "usage: node scripts/screenshot-determinism-check.ts <shard> | --all | --only <scene-ids>\n",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  // Never leave a preview server behind, whatever ends the run.
  const cleanup = (): void => {
    for (const server of liveServers) {
      try {
        server.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  const argv = process.argv.slice(2);
  let ok = true;
  if (argv[0] === "--all") {
    for (const shard of allShards()) {
      if (!(await checkOnly(shard, scenesForShard(shard)))) ok = false;
    }
  } else if (argv[0] === "--only") {
    const only = (argv[1] || "").trim();
    if (!only) usage();
    ok = await checkOnly("--only", only);
  } else if (argv[0] && !argv[0].startsWith("--")) {
    ok = await checkOnly(argv[0], scenesForShard(argv[0]));
  } else {
    usage();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

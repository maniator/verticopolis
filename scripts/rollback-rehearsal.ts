/**
 * The #1221 rollback rehearsal for the Rust-only deploy (the Rollback row of
 * #945): redeploy the previous build and show it loads the saves the newer
 * build wrote, with no unexpected data loss. Procedure and the live steps:
 * `_bmad-output/planning-artifacts/release-3.0-rollback-rehearsal.md`.
 *
 *   node scripts/rollback-rehearsal.ts prepare   --ref <git ref> --dir <folder>
 *   node scripts/rollback-rehearsal.ts preflight --previous <checkout> [--candidate .]
 *   node scripts/rollback-rehearsal.ts engine    --previous <checkout> [--candidate .]
 *                                                [--hours 24] [--only A.TDT,b.vctower] [--out <folder>]
 *   node scripts/rollback-rehearsal.ts seed      --origin <url> --profile <folder> --saves <folder> [--app-version x.y.z] [--headed]
 *   node scripts/rollback-rehearsal.ts verify    --origin <url> --profile <folder> --saves <folder> [--play-seconds 65]
 *                                                --expect-sha <sha7> [--out <folder>] [--headed]
 *
 * `engine` needs the Node engine package built in both checkouts
 * (`npm run wasm:build`). `prepare` makes the previous checkout. Nothing here
 * deploys, rolls back or changes any hosting setting; `seed` and `verify` only
 * open the origin they are given in a throwaway browser profile.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFactsOf, candidateSaves, loadEnginePackage, nodePackageProblem } from "../src/build/rollbackRehearsalNode.ts";
import { buildReport, parseAllowedLosses, preflight, rehearseCase, renderReport } from "../src/build/rollbackRehearsal.ts";
import { seedProfile, verifyProfile, AUTOSAVE_WAIT_SECONDS } from "./rollback-rehearsal-browser.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ALLOWED = join(root, "scripts", "rollback-allowed-losses.json");
const DEFAULT_HOURS = 24;
const FIXTURE_DIRS = ["conformance/fixtures", "conformance/fixtures/tdt-reddit"];

const fail = (message: string): never => {
  console.error(`rollback-rehearsal: ${message}`);
  process.exit(1);
};

/** Flags that take no value: their presence is the setting. */
const SWITCHES = new Set(["headed"]);
const VALUE_FLAGS = new Set(["ref", "dir", "previous", "candidate", "hours", "only", "out", "allowed", "origin", "profile", "saves", "app-version", "play-seconds", "expect-sha"]);

/** `--name value` pairs after the subcommand, plus the value-less switches above. */
function flags(args: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < args.length; ) {
    const name = args[i];
    if (!name?.startsWith("--")) fail(`expected --name value pairs, got ${args.slice(i).join(" ")}`);
    const key = name!.slice(2);
    if (SWITCHES.has(key)) {
      out.set(key, "true");
      i += 1;
      continue;
    }
    if (!VALUE_FLAGS.has(key)) fail(`unknown flag --${key}`);
    const value = args[i + 1];
    if (value === undefined || value === "" || value.startsWith("--")) fail(`--${key} needs a value`);
    out.set(key, value!);
    i += 2;
  }
  return out;
}

const need = (f: Map<string, string>, name: string): string => f.get(name) ?? fail(`--${name} is required`);

const run = (cmd: string, args: string[], cwd: string): void => {
  const program = process.platform === "win32" && cmd === "npm" ? "npm.cmd" : cmd;
  const r = spawnSync(program, args, { cwd, stdio: "inherit", shell: false });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed in ${cwd}`);
};

const capture = (cmd: string, args: string[], cwd: string): string => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: false });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed in ${cwd}`);
  return r.stdout.trim();
};

function allowedLosses(f: Map<string, string>) {
  return parseAllowedLosses(JSON.parse(readFileSync(f.get("allowed") ?? DEFAULT_ALLOWED, "utf8")));
}

function printFindings(findings: ReturnType<typeof preflight>): boolean {
  for (const x of findings) console.log(`${x.level === "fail" ? "FAIL" : "note"}: ${x.message}`);
  return findings.every((x) => x.level !== "fail");
}

const [command, ...rest] = process.argv.slice(2);
const f = flags(rest);

if (command === "prepare") {
  const ref = need(f, "ref");
  const dir = resolve(need(f, "dir"));
  run("git", ["fetch", "origin", ref], root);
  if (!existsSync(dir)) run("git", ["worktree", "add", "--detach", dir, "FETCH_HEAD"], root);
  // A folder that is already there must be exactly the requested commit, or the rehearsal would run against a stale build.
  else if (capture("git", ["rev-parse", "HEAD"], dir) !== capture("git", ["rev-parse", "FETCH_HEAD^{commit}"], root)) fail(`${dir} exists but is not at ${ref}; remove it or choose another --dir`);
  run("npm", ["ci"], dir);
  // The script installs the pinned toolchain (Linux x64 only); elsewhere the toolchain is the owner's, as in the benchmark protocol.
  if (process.platform === "linux" && process.arch === "x64") run("bash", ["scripts/build-engine-wasm.sh"], dir);
  else run("npm", ["run", "wasm:build"], dir);
  console.log(`prepared ${dir}; use it as --previous`);
} else if (command === "preflight") {
  if (resolve(need(f, "previous")) === resolve(f.get("candidate") ?? root)) fail("--previous and --candidate are the same folder; the rehearsal needs two different builds");
  const previous = buildFactsOf(need(f, "previous"), "previous");
  const candidate = buildFactsOf(f.get("candidate") ?? root, "candidate");
  process.exit(printFindings(preflight(previous, candidate)) ? 0 : 1);
} else if (command === "engine") {
  const previousTree = need(f, "previous");
  const candidateTree = f.get("candidate") ?? root;
  const hours = Number(f.get("hours") ?? DEFAULT_HOURS);
  if (!Number.isFinite(hours) || hours < 0) fail("--hours must be a number of game hours, zero or more");
  const only = f.get("only")?.split(",").map((n) => n.trim()).filter((n) => n !== "");
  const out = resolve(f.get("out") ?? join(root, ".rollback-rehearsal"));
  if (resolve(previousTree) === resolve(candidateTree)) fail("--previous and --candidate are the same folder; the rehearsal needs two different builds");
  for (const [label, tree] of [["previous", previousTree], ["candidate", candidateTree]] as const) {
    const problem = nodePackageProblem(tree);
    if (problem) fail(`${label}: ${problem}`);
  }
  const allowed = allowedLosses(f);
  const previousFacts = buildFactsOf(previousTree, "previous");
  const candidateFacts = buildFactsOf(candidateTree, "candidate");
  const previous = loadEnginePackage(previousTree, "previous");
  const candidate = loadEnginePackage(candidateTree, "candidate");
  const saves = candidateSaves(candidate, FIXTURE_DIRS.map((d) => join(resolve(candidateTree), d)), hours, only);
  if (saves.length === 0) fail("no fixture saves were found to rehearse");
  const cases = saves.map((s) => rehearseCase(s.name, s.text, previous, candidate, { hours, allowed }));
  const report = buildReport(previousFacts, candidateFacts, hours, cases, allowed);
  mkdirSync(join(out, "saves"), { recursive: true });
  // Leftovers from an earlier run (or an earlier --only) must never be seeded as this run's saves.
  for (const old of readdirSync(join(out, "saves"))) if (old.endsWith(".json")) rmSync(join(out, "saves", old));
  for (const s of saves) writeFileSync(join(out, "saves", `${s.name}.json`), s.text);
  writeFileSync(join(out, "engine-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, "engine-report.md"), renderReport(report));
  console.log(renderReport(report));
  console.log(`written to ${out}`);
  process.exit(report.ok ? 0 : 1);
} else if (command === "seed") {
  const appVersion = f.get("app-version") ?? buildFactsOf(root, "candidate").appVersion;
  const report = await seedProfile({ origin: need(f, "origin"), profile: resolve(need(f, "profile")), savesDir: resolve(need(f, "saves")), appVersion, headed: f.has("headed") });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.engine === "wasm" && !report.failure ? 0 : 1);
} else if (command === "verify") {
  const playSeconds = Number(f.get("play-seconds") ?? 0);
  if (!Number.isFinite(playSeconds) || playSeconds < 0) fail("--play-seconds must be zero or more");
  if (playSeconds > 0 && playSeconds < AUTOSAVE_WAIT_SECONDS) fail(`--play-seconds must be at least ${AUTOSAVE_WAIT_SECONDS} so the autosave timer can fire twice, or 0 to only read`);
  const expectSha = need(f, "expect-sha");
  if (!/^[0-9a-f]{7,40}$/i.test(expectSha)) fail("--expect-sha must be 7 to 40 hex characters: the commit of the build that is supposed to be running");
  const report = await verifyProfile({ origin: need(f, "origin"), profile: resolve(need(f, "profile")), savesDir: resolve(need(f, "saves")), playSeconds, allowed: allowedLosses(f), expectSha, headed: f.has("headed") });
  const out = f.get("out");
  if (out) {
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(join(resolve(out), `browser-verify-${Date.now()}.json`), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  const toReview = report.toReview.reduce((n, r) => n + r.entries.length, 0);
  console.log(report.ok ? (playSeconds > 0 ? `PASS${toReview > 0 ? ` (${toReview} nested paths under toReview to read before you rely on it)` : ""}` : "PASS (read only: the data-loss check needs --play-seconds)") : `FAIL\n${report.problems.map((p) => `- ${p}`).join("\n")}`);
  process.exit(report.ok ? 0 : 1);
} else {
  fail(`unknown command ${String(command)}; expected prepare, preflight, engine, seed or verify (see the header of this file)`);
}

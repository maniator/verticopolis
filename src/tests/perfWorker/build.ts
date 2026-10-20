import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** Resolve npm's JS entry so Windows never needs to execute a .cmd shim.
 * npm's own run command still provides the prebuild and postbuild lifecycle. */
export function npmEntry(env: NodeJS.ProcessEnv = process.env, node = process.execPath): string {
  const candidates = [
    env.npm_execpath,
    join(dirname(node), "node_modules/npm/bin/npm-cli.js"),
    resolve(dirname(node), "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const entry = candidates.find((p) => p && isAbsolute(p) && /(?:^|[/\\])npm-cli\.js$/.test(p) && existsSync(p));
  if (!entry) {
    throw new Error(
      "Cannot locate npm-cli.js. Start the harness through npm (npm run perf:worker or npm run perf:compare), which tells it where npm is, " +
        "or build first and pass --skip-build. Looked at: " +
        candidates.filter(Boolean).join(", "),
    );
  }
  return entry;
}

/** Execute a JS CLI with literal arguments, including paths containing shell
 * metacharacters. No outer shell may rewrite the argument vector. */
export function runNodeCli(entry: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  execFileSync(process.execPath, [entry, ...args], { cwd, stdio: "inherit", env });
}

export function buildProduction(repo: string, env: NodeJS.ProcessEnv = process.env): void {
  // A VC_TOOLING left in the shell would turn this into a tooling build.
  const clean = { ...env };
  delete clean.VC_TOOLING;
  runNodeCli(npmEntry(env), ["run", "build"], repo, clean);
}

export function buildTooling(repo: string, outDir: string, env: NodeJS.ProcessEnv = process.env): void {
  const require = createRequire(join(repo, "package.json"));
  let vite: string;
  try {
    vite = join(dirname(require.resolve("vite/package.json")), "bin/vite.js");
  } catch {
    throw new Error(`Cannot find vite from ${repo}; run npm ci first.`);
  }
  runNodeCli(vite, ["build", "--outDir", outDir, "--emptyOutDir"], repo, { ...env, VC_TOOLING: "1" });
}

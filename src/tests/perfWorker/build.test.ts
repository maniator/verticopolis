import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildProduction, buildTooling, npmEntry, runNodeCli } from "./build";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "vc worker & %VC_TEST_EXPAND% ^ (build)-"));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("shell-free worker comparison builds", () => {
  it("passes spaces, quotes and shell syntax unchanged to a JS CLI", () => {
    const root = fixture();
    const entry = join(root, "capture & arguments.cjs");
    writeFileSync(entry, 'require("node:fs").writeFileSync("args.json", JSON.stringify({args: process.argv.slice(2), token: process.env.VC_TEST_EXPAND}));');
    const args = ["build", "--outDir", join(root, "output & %VC_TEST_EXPAND% ^ (dir)"), 'quotes"and|redirect>input<', "--emptyOutDir"];
    runNodeCli(entry, args, root, { ...process.env, VC_TEST_EXPAND: "must stay literal" });
    expect(JSON.parse(readFileSync(join(root, "args.json"), "utf8"))).toEqual({ args, token: "must stay literal" });
  });

  it("runs npm prebuild, build and postbuild with the inherited environment", () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { prebuild: "node record.cjs", build: "node record.cjs", postbuild: "node record.cjs" } }));
    writeFileSync(join(root, "record.cjs"), 'require("node:fs").appendFileSync("lifecycle.txt", process.env.npm_lifecycle_event + ":" + process.env.VC_TEST_EXPAND + "\\n");');
    buildProduction(root, { ...process.env, VC_TEST_EXPAND: "literal & value" });
    expect(readFileSync(join(root, "lifecycle.txt"), "utf8").split("\n")).toEqual(["prebuild:literal & value", "build:literal & value", "postbuild:literal & value", ""]);
  });

  it("resolves the checkout's Vite entry and preserves its build arguments", () => {
    const root = fixture();
    const vite = join(root, "node_modules", "vite");
    mkdirSync(join(vite, "bin"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(vite, "package.json"), JSON.stringify({ name: "vite", version: "0.0.0" }));
    writeFileSync(join(vite, "bin", "vite.js"), 'require("node:fs").writeFileSync("vite.json", JSON.stringify({args: process.argv.slice(2), tooling: process.env.VC_TOOLING, token: process.env.VC_TEST_EXPAND}));');
    const output = join(root, "dist & %VC_TEST_EXPAND% ^ (tooling)");
    buildTooling(root, output, { ...process.env, VC_TOOLING: "0", VC_TEST_EXPAND: "literal" });
    expect(JSON.parse(readFileSync(join(root, "vite.json"), "utf8"))).toEqual({ args: ["build", "--outDir", output, "--emptyOutDir"], tooling: "1", token: "literal" });
  });

  it("rejects npm lookup failure with an actionable message", () => {
    const node = join(fixture(), "bin", "node.exe");
    expect(() => npmEntry({ npm_execpath: "relative/npm-cli.js" }, node)).toThrow(/npm run perf:compare/);
  });

  it("takes an absolute npm-cli.js from npm_execpath and finds npm beside node", () => {
    const root = fixture();
    const cli = join(root, "elsewhere", "npm-cli.js");
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    writeFileSync(cli, "");
    expect(npmEntry({ npm_execpath: cli }, join(root, "bin", "node.exe"))).toBe(cli);
    const beside = join(root, "bin", "node_modules", "npm", "bin", "npm-cli.js");
    mkdirSync(dirname(beside), { recursive: true });
    writeFileSync(beside, "");
    expect(npmEntry({ npm_execpath: join(root, "yarn.js") }, join(root, "bin", "node.exe"))).toBe(beside);
  });

  it("keeps a stale VC_TOOLING out of the production build", () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { build: "node record.cjs" } }));
    writeFileSync(join(root, "record.cjs"), 'require("node:fs").writeFileSync("tooling.txt", String(process.env.VC_TOOLING));');
    buildProduction(root, { ...process.env, VC_TOOLING: "1" });
    expect(readFileSync(join(root, "tooling.txt"), "utf8")).toBe("undefined");
  });

  it("names npm ci when vite is missing", () => {
    const root = fixture();
    writeFileSync(join(root, "package.json"), "{}");
    expect(() => buildTooling(root, join(root, "out"))).toThrow(/npm ci/);
  });

  it("keeps both harnesses off child_process, so the build helper stays the only way in", () => {
    for (const rel of ["perfWorker/main.ts", "perfCompare/main.ts"]) {
      expect(readFileSync(join(__dirname, "..", rel), "utf8")).not.toMatch(/node:child_process/);
    }
  });
});

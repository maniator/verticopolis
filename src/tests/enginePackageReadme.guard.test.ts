import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The engine's npm package (`@verticopolis/engine` on npm) ships its own short
 * README, `packages/verticopolis-engine/README.md`, which
 * `scripts/engine-package-files.sh` copies into the package with the browser
 * build's declarations for each release (`release-tag.yml` packs it and
 * `engine-publish.yml` publishes it). Without it the package page shows the
 * repository's README. The full guide is the docs site's JavaScript page,
 * `docs/engine-site/guides/javascript.md`. This guard keeps the copy in the
 * script and the release workflow on the script, and keeps every binding call the
 * README and the guide name a real export of the declared binding
 * (`src/dualrun/engine.d.ts`), so a rename or a removal fails here until the
 * docs follow.
 */
const root = resolve(__dirname, "..", "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const readme = read("packages/verticopolis-engine/README.md");
const guide = read("docs/engine-site/guides/javascript.md");
// Read so a missing file fails here, not in the release run that copies it.
const webDeclarations = read("packages/verticopolis-engine/web.d.ts");
const packScript = read("scripts/engine-package-files.sh");
const releaseWorkflow = ".github/workflows/release-tag.yml";
const declared = read("src/dualrun/engine.d.ts");

const exportsDeclared = new Set([
  ...[...declared.matchAll(/^ {4}(?:static )?(\w+)\(/gm)].map((m) => m[1]!),
  ...[...declared.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]!),
]);

/** Calls the README names: `name(` in an inline code span, `Engine.name(`,
 *  and `engine.name(` in the examples. */
function namedCalls(text: string): string[] {
  const names = new Set<string>();
  for (const span of text.matchAll(/`([^`\n]+)`/g)) {
    for (const call of span[1]!.matchAll(/(?:^|[\s,.])(\w+)\(/g)) names.add(call[1]!);
  }
  for (const call of text.matchAll(/\b(?:engine|Engine)\.(\w+)\(/g)) names.add(call[1]!);
  return [...names].sort();
}

// Names the README writes as calls that are not binding exports.
const notBinding = new Set(["init", "initSync", "require", "stringify", "URL"]);

describe("engine package README", () => {
  it("is packed into the published package with the browser declarations", () => {
    expect(webDeclarations).toContain('export * from "../node/verticopolis_engine";');
    expect(packScript).toContain('cp packages/verticopolis-engine/README.md "$dir/README.md"');
    expect(packScript).toContain('cp packages/verticopolis-engine/web.d.ts "$dir/web/verticopolis_engine.d.ts"');
    expect(read(releaseWorkflow), "release-tag.yml packs through the shared script").toContain("sh scripts/engine-package-files.sh npm ");
  });

  it("packs inside the crate release's own pack step, leaving the app release alone", () => {
    const release = read(".github/workflows/release-tag.yml");
    const step = (name: string) => {
      const start = release.indexOf(`- name: ${name}`);
      expect(start, `release-tag.yml keeps its "${name}" step`).toBeGreaterThan(-1);
      const next = release.indexOf("\n      - name:", start + 1);
      return release.slice(start, next === -1 ? undefined : next);
    };
    const pack = step("Pack the engine");
    expect(pack).toContain("id: pack");
    expect(pack).toContain("sh scripts/engine-package-files.sh npm ");
    expect(step("Tag the app version and publish its release")).toContain("gh workflow run github-release.yml");
    expect(step("Engine WASM package")).toContain("uses: ./.github/actions/engine-wasm");
  });

  // The script is sh, run on Linux in CI; on Windows `sh` may be missing.
  it.skipIf(process.platform === "win32")("writes a package.json that publishes @verticopolis/engine to npm, in public", () => {
    const dir = mkdtempSync(join(tmpdir(), "vc-npm-"));
    try {
      mkdirSync(join(dir, "node"));
      mkdirSync(join(dir, "web"));
      const name = execFileSync("sh", ["scripts/engine-package-files.sh", dir, "1.2.3", "maniator/verticopolis"], { cwd: root, encoding: "utf8" });
      expect(name.trim()).toBe("@verticopolis/engine");
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
      expect(pkg.name).toBe("@verticopolis/engine");
      expect(pkg.version).toBe("1.2.3");
      expect(pkg.publishConfig).toEqual({ registry: "https://registry.npmjs.org/", access: "public", provenance: true });
      expect(pkg.homepage).toBe("https://docs.verticopolis.com/javascript/");
      expect(readFileSync(join(dir, "README.md"), "utf8")).toBe(readme);
      // A version that is not a plain x.y.z never becomes a package.
      expect(() => execFileSync("sh", ["scripts/engine-package-files.sh", dir, "1.2", "maniator/verticopolis"], { cwd: root, stdio: "pipe" })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names only calls the binding exports", () => {
    const calls = namedCalls(guide).filter((name) => !notBinding.has(name));
    expect(calls.length).toBeGreaterThan(30);
    expect(calls.filter((name) => !exportsDeclared.has(name))).toEqual([]);
    const readmeCalls = namedCalls(readme).filter((name) => !notBinding.has(name));
    expect(readmeCalls.length).toBeGreaterThan(0);
    expect(readmeCalls.filter((name) => !exportsDeclared.has(name))).toEqual([]);
  });
});

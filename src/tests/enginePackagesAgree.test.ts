import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The game installs the engine and the components as two packages. The
// components no longer copy the engine's gameplay events (their events
// subpath re-exports the engine's), so what is left to check is that the two
// installed versions are ones that work together.
const require = createRequire(import.meta.url);
const root = (pkg: string) => dirname(require.resolve(`${pkg}/package.json`));
const engine = root("@verticopolis/engine");
const components = root("@verticopolis/components");
const tooling = resolve(engine, "tooling");
const json = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("the installed engine and components packages", () => {
  it("satisfy the components' engine peer range", () => {
    const peer = JSON.parse(readFileSync(resolve(components, "package.json"), "utf8")).peerDependencies[
      "@verticopolis/engine"
    ] as string;
    const version = JSON.parse(readFileSync(resolve(engine, "package.json"), "utf8")).version as string;
    const [major, minor, patch] = version.split(".").map(Number);
    const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(peer);
    expect(m, `peer range ${peer}`).not.toBeNull();
    const [, pM, pm, pp] = m!.map(Number);
    expect(major).toBe(pM);
    expect(minor * 1e6 + patch).toBeGreaterThanOrEqual(pm * 1e6 + pp);
  });

  it("build the tooling engine from the player engine's sources", () => {
    const sources = (dir: string) => json(resolve(dir, "web/BUILD.json")).sources;
    expect(sources(engine)).toMatch(/^[0-9a-f]{64}$/);
    expect(sources(tooling)).toBe(sources(engine));
  });
});

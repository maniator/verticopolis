import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The game ships the player engine and drives the tooling engine in its
// Node suites. The components no longer depend on the engine at all, so
// what is left to check is that the two engine builds share one source.
const require = createRequire(import.meta.url);
const engine = dirname(require.resolve("@verticopolis/engine/package.json"));
const tooling = resolve(engine, "tooling");
const json = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("the installed engine package", () => {
  it("build the tooling engine from the player engine's sources", () => {
    const sources = (dir: string) => json(resolve(dir, "web/BUILD.json")).sources;
    expect(sources(engine)).toMatch(/^[0-9a-f]{64}$/);
    expect(sources(tooling)).toBe(sources(engine));
  });
});

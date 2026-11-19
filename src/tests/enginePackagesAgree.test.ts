import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The game installs the engine and the components as two packages. The
// components keep a copy of the engine's generated gameplay event types and
// the bridge's rules; a game that pairs the two packages must get the same
// types and rules from each, or the events it reads would not be the events
// the engine drains.
const require = createRequire(import.meta.url);
const root = (pkg: string) => dirname(require.resolve(`${pkg}/package.json`));
const engine = root("@verticopolis/engine");
const components = root("@verticopolis/components");
const tooling = root("@verticopolis/engine-tooling");
const conformance = root("@verticopolis/engine-conformance");
const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("the installed engine and components packages", () => {
  it("carry the same gameplay event types", () => {
    const fromEngine = readFileSync(resolve(engine, "events/gameplayEvents.d.ts"), "utf8");
    const fromComponents = readFileSync(resolve(components, "lib/events/gameplayEvents.d.ts"), "utf8");
    expect(fromComponents).toBe(fromEngine);
  });

  it("carry the same gameplay event rules", () => {
    // The engine ships the rules as TypeScript source and the components as
    // the compiled module, so the object literal each assigns is compared.
    const rules = (file: string): unknown => {
      const literal = /GAMEPLAY_EVENT_RULES(?::\s*\w+)?\s*=\s*(\{[\s\S]*?\n\});/.exec(readFileSync(file, "utf8"))?.[1];
      expect(literal, file).toBeDefined();
      return new Function(`return (${literal});`)();
    };
    const fromEngine = rules(resolve(engine, "events/gameplayEventRules.ts"));
    expect(fromEngine).toMatchObject({ enums: { mode: ["classic", "modern"] } });
    expect(rules(resolve(components, "lib/events/gameplayEventRules.js"))).toEqual(fromEngine);
  });

  it("satisfy the components' engine peer range", () => {
    const peer = JSON.parse(readFileSync(resolve(components, "package.json"), "utf8")).peerDependencies["@verticopolis/engine"] as string;
    const version = JSON.parse(readFileSync(resolve(engine, "package.json"), "utf8")).version as string;
    const [major, minor, patch] = version.split(".").map(Number);
    const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(peer);
    expect(m, `peer range ${peer}`).not.toBeNull();
    const [, pM, pm, pp] = m!.map(Number);
    expect(major).toBe(pM);
    expect(minor * 1e6 + patch).toBeGreaterThanOrEqual(pm * 1e6 + pp);
  });

  // The e2e, screenshot and integration tiers run the tooling build and the
  // conformance lock; players run the engine package. All three must be the
  // same engine release, so a pin raise that misses one fails here.
  it("pin the tooling and conformance packages to the engine's own release", () => {
    const version = json(resolve(engine, "package.json")).version;
    expect(json(resolve(tooling, "package.json")).version).toBe(version);
    expect(json(resolve(conformance, "package.json")).version).toBe(version);
  });

  it("build the tooling engine from the player engine's sources", () => {
    const sources = (dir: string) => json(resolve(dir, "web/BUILD.json")).sources;
    expect(sources(engine)).toMatch(/^[0-9a-f]{64}$/);
    expect(sources(tooling)).toBe(sources(engine));
  });
});

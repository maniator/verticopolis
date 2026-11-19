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
const tooling = resolve(engine, "tooling");
const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("the installed engine and components packages", () => {
  it("carry the same gameplay event types", () => {
    // The first line names the script that generated each copy, which differs
    // between the two repositories, so only the declarations are compared.
    const declarations = (file: string): string => readFileSync(file, "utf8").replace(/^\/\/ Generated from .*\n/, "");
    const fromEngine = declarations(resolve(engine, "events/gameplayEvents.d.ts"));
    const fromComponents = declarations(resolve(components, "lib/events/gameplayEvents.d.ts"));
    expect(fromEngine).toContain("export");
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

  it("build the tooling engine from the player engine's sources", () => {
    const sources = (dir: string) => json(resolve(dir, "web/BUILD.json")).sources;
    expect(sources(engine)).toMatch(/^[0-9a-f]{64}$/);
    expect(sources(tooling)).toBe(sources(engine));
  });
});

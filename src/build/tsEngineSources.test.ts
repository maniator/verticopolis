import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tsEngineSourceHash } from "./tsEngineSources";

/** A `src` folder holding `files`; returns its `engine` folder. */
function engineDir(files: Record<string, string>): string {
  const src = mkdtempSync(join(tmpdir(), "ts-engine-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(src, name, ".."), { recursive: true });
    writeFileSync(join(src, name), text);
  }
  return join(src, "engine");
}

const base = { "engine/Tower.ts": 'import { a } from "../storage/codec";', "engine/crowd/walk.ts": "b", "engine/layout.json": "{}", "storage/codec.ts": 'export * from "./bytes.ts";', "storage/bytes.ts": "c" };

describe("the TypeScript engine's source hash", () => {
  it("changes with the engine's code, its data, and the modules it imports from outside the folder", () => {
    const h = tsEngineSourceHash(engineDir(base));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(tsEngineSourceHash(engineDir({ ...base, "engine/crowd/walk.ts": "x" }))).not.toBe(h);
    expect(tsEngineSourceHash(engineDir({ ...base, "engine/layout.json": "[]" }))).not.toBe(h);
    expect(tsEngineSourceHash(engineDir({ ...base, "storage/bytes.ts": "x" }))).not.toBe(h);
  });

  it("ignores tests, other files and modules the engine does not import", () => {
    const h = tsEngineSourceHash(engineDir(base));
    expect(tsEngineSourceHash(engineDir({ ...base, "engine/Tower.test.ts": "t", "engine/notes.md": "n", "ui/panel.ts": "p" }))).toBe(h);
  });

  it("fails on an import it cannot follow, rather than leave the module out", () => {
    expect(() => tsEngineSourceHash(engineDir({ "engine/Tower.ts": 'import { a } from "./missing";' }))).toThrow(/cannot find/);
  });

  it("hashes the real engine folder", () => {
    expect(tsEngineSourceHash(join(__dirname, "..", "engine"))).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tsEngineSourceHash } from "./tsEngineSources";

function engineDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ts-engine-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe("the TypeScript engine's source hash", () => {
  it("changes with the engine's code and ignores its tests and other files", () => {
    const base = tsEngineSourceHash(
      engineDir({ "Tower.ts": "a", "crowd/walk.ts": "b" }),
    );
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(
      tsEngineSourceHash(
        engineDir({
          "Tower.ts": "a",
          "crowd/walk.ts": "b",
          "Tower.test.ts": "t",
          "notes.md": "n",
        }),
      ),
    ).toBe(base);
    expect(
      tsEngineSourceHash(engineDir({ "Tower.ts": "a", "crowd/walk.ts": "c" })),
    ).not.toBe(base);
    // A moved file is a different engine, even with the same bytes.
    expect(
      tsEngineSourceHash(engineDir({ "Tower.ts": "a", "walk.ts": "b" })),
    ).not.toBe(base);
  });

  it("hashes the real engine folder", () => {
    expect(tsEngineSourceHash(join(__dirname, "..", "engine"))).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

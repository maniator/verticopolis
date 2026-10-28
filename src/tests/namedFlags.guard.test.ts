import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { repoRel, sourceFiles } from "./guardFiles";

/**
 * A set of named on/off facts crosses the engine boundary as one number with a
 * NAMED constant per flag (`ONBOARDING_FLAG.lobby`, `wasm_port::ONBOARDING_LOBBY`),
 * never as `1 << i` or `2 ** i` over an index. A reader of `bits & (1 << 3)` has
 * to look up what bit 3 is; a reader of `ONBOARDING_FLAG.connect` does not
 * (CLAUDE.md, "Named flags, not bit math").
 *
 * This guard fails any production source that shifts a literal one or raises two
 * to a variable power. The files below are the sites that are not a named flag
 * set: a bitset keyed by an index (a kind code, a stop, a floor), or a byte or
 * varint codec. Add a file here only with that reason; a new flag set names its
 * flags instead.
 */

const ALLOWED: Readonly<Record<string, string>> = {
  "src/engine/port/viewEncode.ts": "the unlocked-kinds mask, bit k = kind code k (the whole catalog, past 32 bits)",
  "engine-rs/src/view/reader.rs": "the unlocked-kinds mask, bit k = kind code k",
  "src/simport/viewReader.ts": "reads the unlocked-kinds mask, bit k = kind code k (the whole catalog, past 32 bits)",
  "engine-rs/src/dispatch.rs": "the car's cab-floor bitset, indexed by stop",
  "engine-rs/src/crowd/spawn_floors.rs": "a per-floor bitset, indexed by floor",
  "engine-rs/src/fflate.rs": "the deflate port: shift widths and masks of the compression format",
  "engine-rs/src/canonical.rs": "the sort key that places non-index keys after every array index",
  "src/wasmhost/buildSection.ts": "the wasm LEB128 varint decoder",
  "src/build/sourcemapBytes.ts": "the source-map base64 VLQ decoder",
};

const SHIFT_OR_POW = /\b1u?(?:8|16|32|64|size)?\s*<<|\b2\s*\*\*\s*[A-Za-z_]/;
const TEST_FILE = /(^|\/)(tests?|tests_[a-z_]+|[a-z_]+_tests)\.rs$|\.(test|spec|fixture)\.ts$|(^|\/)tests\//;

function hits(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const abs of sourceFiles(dir, exts)) {
    const rel = repoRel(abs);
    if (TEST_FILE.test(rel) || rel in ALLOWED) continue;
    readFileSync(abs, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (SHIFT_OR_POW.test(line)) out.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  return out;
}

describe("named flags guard", () => {
  it("every allowed file still exists and still has a shift site", () => {
    for (const rel of Object.keys(ALLOWED)) {
      const abs = sourceFiles(rel.split("/").slice(0, -1).join("/"), [rel.split("/").pop()!]).find((f) => repoRel(f) === rel);
      expect(abs, `${rel} is listed in ALLOWED but not found; drop it`).toBeDefined();
      const text = readFileSync(abs!, "utf8");
      expect(text.split("\n").some((l) => SHIFT_OR_POW.test(l)), `${rel} no longer shifts; drop it from ALLOWED`).toBe(true);
    }
  });

  it("no production source packs flags with shifts or powers of two", () => {
    const found = [...hits("src", [".ts"]), ...hits("engine-rs/src", [".rs"]), ...hits("scripts", [".ts", ".mjs"])];
    expect(found, `Give each flag a named constant instead of 1 << i / 2 ** i:\n${found.join("\n")}`).toEqual([]);
  });
});

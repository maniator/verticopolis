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

/** A file that is not a named flag set, how many shift sites it has, and why. The count
 *  is exact: a new `1 << i` in an allowed file fails until the count here moves with a
 *  reason, so an allowed file cannot quietly grow a flag set of its own. */
interface Allowed {
  sites: number;
  reason: string;
}

const ALLOWED: Readonly<Record<string, Allowed>> = {
  "engine-rs/src/view/reader.rs": { sites: 1, reason: "the unlocked-kinds mask, bit k = kind code k" },
  "src/simport/viewReader.ts": { sites: 1, reason: "reads the unlocked-kinds mask, bit k = kind code k (the whole catalog, past 32 bits)" },
  "engine-rs/src/dispatch_demand.rs": { sites: 2, reason: "the car's cab-floor bitset, indexed by stop" },
  "engine-rs/src/crowd/spawn_floors.rs": { sites: 1, reason: "a per-floor bitset, indexed by floor" },
  "engine-rs/src/fflate.rs": { sites: 2, reason: "the deflate port: shift widths and masks of the compression format" },
  "engine-rs/src/canonical.rs": { sites: 1, reason: "the sort key that places non-index keys after every array index" },
  "src/wasmhost/buildSection.ts": { sites: 1, reason: "the wasm LEB128 varint decoder" },
  "src/build/sourcemapBytes.ts": { sites: 1, reason: "the source-map base64 VLQ decoder" },
};

/** A literal one shifted left (`1 <<`, `1u32 <<`, `1_u8 <<`, `1i64 <<`, `1n <<`, `(1 as u64) <<`)
 *  or two raised to a variable power. */
const RUST_INT = "[ui](?:8|16|32|64|128|size)";
const SHIFT_OR_POW = new RegExp(
  String.raw`\b1(?:_?${RUST_INT}|n)?\s*<<|\(\s*1\s+as\s+${RUST_INT}\s*\)\s*<<|\b2\s*\*\*\s*[A-Za-z_]`,
);

const TEST_FILE = /(^|\/)(tests?|tests_[a-z_]+|[a-z_]+_tests)\.rs$|\.(test|spec|fixture)\.ts$|(^|\/)tests\//;

function siteLines(text: string): string[] {
  return text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line) && SHIFT_OR_POW.test(line));
}

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
  it("every allowed file still exists and has exactly its listed shift sites", () => {
    for (const [rel, { sites }] of Object.entries(ALLOWED)) {
      const abs = sourceFiles(rel.split("/").slice(0, -1).join("/"), [rel.split("/").pop()!]).find((f) => repoRel(f) === rel);
      expect(abs, `${rel} is listed in ALLOWED but not found; drop it`).toBeDefined();
      const found = siteLines(readFileSync(abs!, "utf8"));
      expect(found.length, `${rel} has ${found.length} shift site(s), the list says ${sites}. A new site needs its reason written down; a removed one lowers the count:\n${found.join("\n")}`).toBe(sites);
    }
  });

  it("catches every spelling of a literal one shifted or two raised to an index", () => {
    for (const code of ["1 << i", "1u32 << i", "1u8<<i", "1i32 << i", "1i64 << n", "1_u8 << k", "1_u64 << k", "1usize << k", "(1 as u64) << k", "( 1 as i128 ) << k", "1n << BigInt(k)", "2 ** i"]) {
      expect(SHIFT_OR_POW.test(code), code).toBe(true);
    }
    for (const code of ["value << 3", "x << 1", "11 << 2", "0x1 << 2", "12u32 << 2", "(2 as u64) << k", "2 ** 8", "a < b << c"]) {
      expect(SHIFT_OR_POW.test(code), code).toBe(false);
    }
  });

  it("no production source packs flags with shifts or powers of two", () => {
    const found = [...hits("src", [".ts"]), ...hits("engine-rs/src", [".rs"]), ...hits("scripts", [".ts", ".mjs"])];
    expect(found, `Give each flag a named constant instead of 1 << i / 2 ** i:\n${found.join("\n")}`).toEqual([]);
  });
});

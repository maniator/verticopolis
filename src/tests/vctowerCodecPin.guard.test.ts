import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Rust codec pin (#1522 item 1, #1498, #1301). `.vctower` and `.TDT`
 * import and export run through the Rust engine, and no TypeScript parser or
 * writer runs outside tests. The TypeScript copies stay as test referees until
 * they are deleted (#1336), so this guard fails when production code calls one.
 *
 * Production code is every `src/` file that is not a test, a fixture or under
 * `src/tests/`. Each rule names the calls that are banned there and the few
 * files that may keep one, with the reason.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

function production(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (path === resolve(root, "src/tests")) continue;
      files.push(...production(path));
    } else if (/\.ts$/.test(entry.name) && !/\.(test|fixture|d)\.ts$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const FILES = production(resolve(root, "src")).map((path) => ({ rel: relative(root, path).replace(/\\/g, "/"), text: readFileSync(path, "utf8") }));

/** The code of a file without its comments, so a rule reads calls, not prose. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

interface Rule {
  name: string;
  banned: RegExp;
  /** Files that may use it, each with its reason. */
  allowed: Record<string, string>;
}

const RULES: Rule[] = [
  {
    name: "the TypeScript .vctower reader runs only in tests",
    banned: /\b(?:SaveGame\.import(?:Text)?|importObjection|looksLikeTowerSave|readVctower|decodeVctower)\s*\(/,
    allowed: {
      "src/storage/SaveGame.ts": "defines the test referee (`import`, `importText`) and its checks",
      "src/storage/saveTextRead.ts": "defines `importObjection` and `looksLikeTowerSave` for that referee",
      "src/storage/vctowerContainer.ts": "defines `decodeVctower`, the referee the conformance suites read files with",
      "src/engine/port/files.ts": "the TypeScript engine's file reader, a test referee until #1336 deletes it",
      "src/engine/port/tsEngine.ts": "the TypeScript engine's `loadVctower`, the same referee",
    },
  },
  {
    name: "the TypeScript .vctower writer is not the player's export",
    banned: /\b(?:SaveGame\.export|writeVctower)\s*\(/,
    allowed: {
      "src/engine/port/files.ts": "the TypeScript engine's file writer, a test referee until #1336 deletes it",
      "src/engine/port/tsEngine.ts": "the TypeScript engine's `exportVctower`, the same referee",
      "src/game/crashReport.ts": "the crash report packs the last good save text without the engine, which may be the thing that failed",
    },
  },
];

describe("the Rust codec pin (#1522 item 1)", () => {
  for (const rule of RULES) {
    it(rule.name, () => {
      const offenders = FILES.filter((f) => rule.banned.test(code(f.text)) && !(f.rel in rule.allowed)).map((f) => f.rel);
      expect(offenders, "production code calls a TypeScript parser or writer; route it through the engine port").toEqual([]);
    });
    it(`${rule.name}: every allowance still names a file that uses it`, () => {
      const stale = Object.keys(rule.allowed).filter((rel) => !FILES.some((f) => f.rel === rel && rule.banned.test(code(f.text))));
      expect(stale, "an allowance that no longer applies hides a future call; remove it").toEqual([]);
    });
  }

  it("the player's import and export reach the engine's four codec members", () => {
    const saveLoad = code(FILES.find((f) => f.rel === "src/game/saveLoad.ts")!.text);
    for (const call of ["port.loadVctower(", "exportFileText(port", "port.loadTdt(", "port.tdtExport("]) {
      expect(saveLoad, call).toContain(call);
    }
    const lifecycle = code(FILES.find((f) => f.rel === "src/game/portLifecycle.ts")!.text);
    expect(lifecycle).toContain("port.exportVctower(");
  });

  it("the .TDT codec the TypeScript engine borrows is the Rust one, and nothing in src/storage parses or writes a 1994 file", () => {
    const codec = code(FILES.find((f) => f.rel === "src/engine/port/tdtCodec.ts")!.text);
    for (const call of ["engine.loadTdt(", "engine.tdtExport("]) expect(codec, call).toContain(call);
    // `src/storage/tdt*.ts` holds the report wording only; a parser or writer there would be a second codec.
    const codecs = FILES.filter((f) => /^src\/storage\/tdt/.test(f.rel) && /\b(?:DataView|readUint\w*|getUint\w*|setUint\w*)\b/.test(code(f.text))).map((f) => f.rel);
    expect(codecs).toEqual([]);
  });
});

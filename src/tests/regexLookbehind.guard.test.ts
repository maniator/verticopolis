import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { repoRel, sourceFiles } from "./guardFiles";
import { isTestFile } from "./importScan";

/**
 * No lookbehind in shipped code. A regex lookbehind (`(?<=` or `(?<!`) is a
 * parse-time SyntaxError on Safari below 16.4, and the build targets `esnext`
 * with no downleveling, so one such literal stops the whole chunk from
 * loading, and with it the game. Node and the test browsers accept it, so no
 * other gate notices. `towerFileCodec.ts`, `engine/wellFormed.ts` and
 * `simport/request.ts` each say the same thing without it.
 *
 * The guard reads every non-test source file under `src/` (the test tree,
 * which never ships, aside) as text, so a comment that writes the syntax out
 * counts too; describe it in words instead.
 */
const LOOKBEHIND = /\(\?<[=!]/;

describe("shipped code has no regex lookbehind", () => {
  it("no non-test file under src/ writes (?<= or (?<!", () => {
    const offenders = sourceFiles("src", [".ts", ".tsx"])
      .filter((abs) => {
        const rel = repoRel(abs);
        return !rel.startsWith("src/tests/") && !isTestFile(rel);
      })
      .filter((abs) => LOOKBEHIND.test(readFileSync(abs, "utf8")))
      .map(repoRel);
    expect(offenders, "rewrite without lookbehind, as towerFileCodec.ts hasLoneSurrogate does").toEqual([]);
  });
});

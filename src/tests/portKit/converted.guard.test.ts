import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoRel, repoRoot, sourceFiles } from "../guardFiles";
import { convertedSuites } from "./convertedList";

/**
 * `converted.txt` names the suites that run on the engine port. A suite that
 * uses the kit has to be listed, because the WASM parity projects would
 * otherwise host its `Simulation`s a second time, and `test:port` would not
 * require its Rust leg. A listed suite has to exist and use the kit, so the
 * list cannot drift into names that run nothing.
 */
describe("the engine port suites list", () => {
  const listed = convertedSuites();
  const users = sourceFiles("src", [".test.ts"])
    .filter((abs) => !abs.endsWith("converted.guard.test.ts"))
    .filter((abs) => /from "(\.\.\/)+portKit\/portSim"|from "\.\/portSim"/.test(readFileSync(abs, "utf8")))
    .map(repoRel);

  it("lists each suite once", () => {
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("lists every suite that uses the kit", () => {
    expect(users.filter((rel) => !listed.includes(rel))).toEqual([]);
  });

  it("lists only suites that exist and use the kit", () => {
    for (const rel of listed) {
      expect(existsSync(`${repoRoot}/${rel}`), `${rel} does not exist`).toBe(true);
      expect(users, `${rel} does not use the kit`).toContain(rel);
    }
  });
});

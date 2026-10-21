import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { CORPUS_NAME, corpusFiles } from "./fuzzCorpus";
import { loadScenario, runScenario } from "./scenario";

describe("the fuzz corpus", () => {
  const files = corpusFiles();

  it("is not empty, so the pull-request job always replays something", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files.map((f) => [basename(f), f]))("%s is a well-formed entry the TypeScript engine runs", (name, file) => {
    const stem = name.replace(/\.json$/, "");
    expect(stem).toMatch(CORPUS_NAME);
    const scenario = loadScenario(file);
    // The Rust replay writes its records by file name, so the id must match.
    expect(scenario.id).toBe(stem);
    expect(scenario.description.length).toBeGreaterThan(40);
    expect(scenario.description).not.toMatch(/—/);
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
    expect(runScenario(scenario).length).toBeGreaterThan(1);
  });
});

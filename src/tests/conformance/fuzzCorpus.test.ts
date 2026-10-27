import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { rustMessage } from "./fuzzBinary";
import { CORPUS_NAME, corpusExit, corpusFiles, lateFailure, rustVerdict } from "./fuzzCorpus";
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
    expect(scenario.description).not.toMatch(/\u2014/);
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
    expect(runScenario(scenario).length).toBeGreaterThan(1);
  });
});

describe("the corpus job's decisions", () => {
  it("does not read the records the Rust replay writes as entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "vc-corpus-files-"));
    try {
      for (const f of ["a-entry.json", "a-entry.rs.json", "a-entry.rs.detail.json", "b-entry.json", "notes.txt"]) writeFileSync(join(dir, f), "{}");
      expect(corpusFiles(dir).map((f) => basename(f))).toEqual(["a-entry.json", "b-entry.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts only lowercase dashed names, the shrinker's guard against writing outside the corpus", () => {
    for (const ok of ["a", "star-five-reload", "seed-9315", "a1-b2"]) expect(CORPUS_NAME.test(ok), ok).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "A", "a_b", "a.b", "../x", "a/b", "a\\b", "a b", "a\n"]) expect(CORPUS_NAME.test(bad), JSON.stringify(bad)).toBe(false);
  });

  it("reads each Rust exit code the way the job reports it", () => {
    expect(rustVerdict(0)).toBe("ok");
    expect(rustVerdict(1)).toBe("failed");
    expect(rustVerdict(101)).toBe("failed");
    for (const code of [2, 3, 7, 137]) expect(rustVerdict(code), String(code)).toBe("harness");
  });

  it("exits 0 when all agree, 1 on a failure and 3 only on a harness failure alone", () => {
    expect(corpusExit([], false)).toBe(0);
    expect(corpusExit(["x"], false)).toBe(1);
    expect(corpusExit([], true)).toBe(3);
    expect(corpusExit(["x"], true)).toBe(1);
  });

  it("fails a run that finishes past its budget unless an entry is already reported over budget", () => {
    expect(lateFailure(10, 240, [])).toEqual([]);
    expect(lateFailure(240, 240, [])).toEqual([]);
    expect(lateFailure(241, 240, [])).toHaveLength(1);
    expect(lateFailure(241, 240, ["a (over budget)"])).toEqual([]);
    expect(corpusExit(lateFailure(241, 240, []), false)).toBe(1);
  });
});

describe("the Rust failure line", () => {
  it("shows the panic message, not the backtrace hint", () => {
    const stderr = "thread 'main' panicked at src/bin/fuzz.rs:12:5:\nno space left\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\n";
    expect(rustMessage(stderr)).toBe("thread 'main' panicked at src/bin/fuzz.rs:12:5: no space left");
    expect(rustMessage("fuzz: the scenario is refused: cap\n")).toBe("fuzz: the scenario is refused: cap");
    expect(rustMessage("")).toBe("no output");
    expect(rustMessage("note: only a hint\n")).toBe("no output");
  });
});

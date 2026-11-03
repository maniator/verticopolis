import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { corpusDir, corpusFiles } from "./fuzzCorpus";
import { CONFORMANCE_DIR, loadScenario, type Scenario } from "./scenario";

/**
 * What the fuzz corpus entries must look like. The corpus job replays them on
 * both engines, so an entry that quietly starts from a save outside
 * `conformance/fixtures/` would pass there and fail for anyone else, and an
 * entry meant to hit a pool cap that stops hitting it would keep passing.
 */

// corpusFiles skips the `<id>.rs.json` records a local `fuzz --replay` leaves beside an entry.
const entries = corpusFiles().map((f) => basename(f));
const load = (file: string): Scenario => loadScenario(join(corpusDir(), file));

describe("the fuzz corpus entries", () => {
  it("has entries to check", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("%s starts from a new game or a fixture under conformance/fixtures/", (file) => {
    const { start } = load(file);
    if ("newGame" in start) return;
    expect(start.fixture.startsWith("conformance/fixtures/")).toBe(true);
    expect(existsSync(join(CONFORMANCE_DIR, "..", start.fixture))).toBe(true);
  });

  it.each(entries)("%s is named after its file", (file) => {
    expect(load(file).id).toBe(file.replace(/\.json$/, ""));
  });
});

describe("pool-caps-tall.json", () => {
  const { commands } = load("pool-caps-tall.json");
  const transports = commands.filter((c) => c.op === "buildTransport");
  const accepted = (kind: string) => transports.filter((c) => c.kind === kind && !c.expectFail).length;
  const refusals = (kind: string) => transports.filter((c) => c.kind === kind && c.expectFail);

  it("fills the 24-shaft elevator pool, then has every further shaft refused for the cap", () => {
    expect(accepted("elevatorStandard")).toBe(24);
    expect(refusals("elevatorStandard").length).toBeGreaterThan(0);
    for (const c of refusals("elevatorStandard")) expect(c.reason).toBe("Only 24 elevator shafts allowed per tower.");
  });

  it("fills the 64-link stairs pool, then has every further flight refused for the cap", () => {
    expect(accepted("stairs")).toBe(64);
    expect(refusals("stairs").length).toBeGreaterThan(0);
    for (const c of refusals("stairs")) expect(c.reason).toBe("Only 64 stairs/escalators allowed per tower.");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eachScenarioFresh } from "./scenarioPages";

const scenarios = [{ name: "medium" }, { name: "large" }];

describe("eachScenarioFresh", () => {
  it("opens a fresh page before each scenario's body, once per scenario, in order", async () => {
    const log: string[] = [];
    await eachScenarioFresh(scenarios, async (sc) => void log.push(`fresh ${sc.name}`), async (sc) => void log.push(`run ${sc.name}`));
    expect(log).toEqual(["fresh medium", "run medium", "fresh large", "run large"]);
  });

  it("stops after a body that returns false, without a fresh page for the rest", async () => {
    const log: string[] = [];
    await eachScenarioFresh(scenarios, async (sc) => void log.push(`fresh ${sc.name}`), async (sc) => {
      log.push(`run ${sc.name}`);
      return false;
    });
    expect(log).toEqual(["fresh medium", "run medium"]);
  });

  it("passes a failure from the fresh page or the body to the caller", async () => {
    await expect(eachScenarioFresh(scenarios, async () => Promise.reject(new Error("no page")), async () => undefined)).rejects.toThrow("no page");
    await expect(eachScenarioFresh(scenarios, async () => undefined, async () => Promise.reject(new Error("body"))) ).rejects.toThrow("body");
  });
});

describe("the perf:compare runner", () => {
  const source = readFileSync(join(__dirname, "runner.ts"), "utf8");

  it("measures each scenario through eachScenarioFresh, in the timed passes and in each frames block", () => {
    expect(source.match(/await eachScenarioFresh\(/g)).toHaveLength(2);
    // The timed and frames loops are the helper's, so no bare loop over the scenarios is left (the memory pass loops over opts.scenarios, each in its own fresh page).
    expect(source).not.toMatch(/for \(const sc of scenarios\)/);
    // Each use opens a fresh page for the scenario.
    expect(source).toMatch(/eachScenarioFresh\(scenarios, \(sc\) => freshPage\(page, engine, `\$\{sc\.name\} timed passes boot`\)/);
    expect(source).toMatch(/eachScenarioFresh\(scenarios, \(sc\) => freshPage\(page, engine, `\$\{sc\.name\} frames \(audio \$\{block\}\) boot`\)/);
    // One page boot for all scenarios is the pattern that biased the second tower.
    expect(source).not.toMatch(/"timed passes boot"/);
  });
});

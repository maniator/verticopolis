import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A source-text guard on how both runners wire WebGL context-loss detection
 * (#1136). `contextLossFinding` is an error in every mode, so a refactor of
 * `newContext` that drops the init script, the binding or the run's record
 * would turn the check off with every other test still green. The runners
 * need a browser, so the guard reads their source.
 */
const here = dirname(fileURLToPath(import.meta.url));
const RUNNERS = [
  { name: "perfCompare", path: join(here, "runner.ts"), record: /const noteLoss = \(line: string\): void => \{\s*run\.contextLost\?\.push\(line\);\s*\};/ },
  { name: "perfWorker", path: join(here, "..", "perfWorker", "runner.ts"), record: /const noteLoss = \(line: string\): void => \{\s*run\.contextLost\?\.push\(line\);\s*\};/ },
];

describe.each(RUNNERS)("$name runner context-loss wiring", ({ path, record }) => {
  const source = readFileSync(path, "utf8");

  it("builds every context with the init script and the binding", () => {
    const body = /async function newContext\([^)]*\)[^{]*\{([\s\S]*?)\n\}\n/.exec(source)?.[1] ?? "";
    expect(body).toContain("await ctx.addInitScript(watchContextLoss);");
    expect(body).toContain("await trackContextLoss(ctx, onLoss);");
    // The only other context creation in the file would bypass the wiring.
    expect(source.match(/\.newContext\(/g)).toHaveLength(1);
  });

  it("records a loss on the run", () => {
    expect(source).toMatch(record);
    expect(source).toMatch(/contextLost: \[\]/);
  });

  it("gives every timed context the recorder and only the service-worker context a no-op", () => {
    const calls = [...source.matchAll(/await newContext\(browser, config, "(allow|block)", (.*)\);$/gm)].map((m) => [m[1], m[2]]);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const [mode, handler] of calls) expect(handler, `serviceWorkers ${mode}`).toBe(mode === "allow" ? "() => {}" : "noteLoss");
    expect(calls.filter(([mode]) => mode === "allow")).toHaveLength(1);
  });
});

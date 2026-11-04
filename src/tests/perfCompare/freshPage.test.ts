import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import { expectEngine, freshPage } from "./freshPage";
import { pageInfo, prepareLiveApp } from "./page";
import { eachScenarioFresh } from "./scenarioPages";

/** A page whose reload throws away the window state, as a real one does: what a scenario leaves in the page is gone only if the runner reloaded. */
function fakePage(engineActive: string) {
  const log: string[] = [];
  const state = { left: [] as string[] };
  const page = {
    reload: async () => {
      log.push("reload");
      state.left = [];
    },
    waitForFunction: async () => void log.push("game"),
    waitForLoadState: async () => void log.push("idle"),
    evaluate: async (fn: unknown) => {
      if (fn === pageInfo) {
        log.push("info");
        return { engineActive, host: { kind: "fake" } };
      }
      if (fn === prepareLiveApp) {
        log.push("prepare");
        return undefined;
      }
      throw new Error("unexpected evaluate");
    },
  };
  return { page: page as unknown as Page, log, state };
}

describe("freshPage", () => {
  it("reloads, waits for the app, checks the engine, then prepares the app, in that order", async () => {
    const f = fakePage("wasm");
    await freshPage(f.page, "wasm", "large timed passes boot");
    expect(f.log).toEqual(["reload", "game", "idle", "info", "prepare"]);
  });

  it("reloads on every call, so a later scenario never starts in the earlier one's page", async () => {
    const f = fakePage("wasm");
    const seen: string[][] = [];
    await eachScenarioFresh([{ name: "medium" }, { name: "large" }], (sc) => freshPage(f.page, "wasm", `${sc.name} boot`), async (sc) => {
      seen.push([...f.state.left]);
      f.state.left.push(sc.name);
    });
    expect(f.log.filter((l) => l === "reload")).toHaveLength(2);
    expect(seen).toEqual([[], []]);
  });

  it("refuses a page that runs another engine, before it prepares the app", async () => {
    const f = fakePage("ts");
    await expect(freshPage(f.page, "wasm", "large boot")).rejects.toThrow("large boot: requested the wasm engine but ts is active");
    expect(f.log).not.toContain("prepare");
  });

  it("expectEngine names the host in the refusal", async () => {
    await expect(expectEngine(fakePage("none").page, "ts", "x")).rejects.toThrow('(host: {"kind":"fake"})');
  });
});

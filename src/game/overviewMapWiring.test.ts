import { afterEach, describe, it, expect, vi } from "vitest";
import { MAP_PREVIEW_FLAG, mapPreviewOn } from "./overviewMapWiring";

afterEach(() => vi.unstubAllEnvs());

describe("overview map preview gate", () => {
  it("shows the window only when the address carries the preview flag, with any value", () => {
    // Vitest runs as a dev build, the same as a dev serve.
    expect(MAP_PREVIEW_FLAG).toBe("map");
    expect(mapPreviewOn("?map")).toBe(true);
    expect(mapPreviewOn("?seed=3&map=1")).toBe(true);
    // The flag's presence is the switch: a value never turns it off.
    expect(mapPreviewOn("?map=0")).toBe(true);
    expect(mapPreviewOn("")).toBe(false);
    expect(mapPreviewOn("?maps")).toBe(false);
  });

  // `runIf`, as in bootstrap.test.ts: a shell with VC_TOOLING=1 exported
  // inlines a true `__TOOLING_BUILD__`, and one with VERCEL=1 and VERCEL_ENV=preview a true
  // `__PREVIEW_DEPLOY__` (both show the preview), so the assertion runs only
  // where it means a player session.
  it.runIf(!__TOOLING_BUILD__ && !__PREVIEW_DEPLOY__)("never shows the window in a player build, flag or not", () => {
    vi.stubEnv("DEV", false);
    expect(mapPreviewOn("?map")).toBe(false);
  });
});

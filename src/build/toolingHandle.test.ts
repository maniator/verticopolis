import { describe, expect, it, vi } from "vitest";
import { bundlePaths, distPublishesHandle, missingHandleMessage, publishesHandle } from "./toolingHandle";

const INDEX = `<script type="module" src="/assets/main-abc.js"></script><link rel="modulepreload" href="/assets/vendor-1.js"><script src="/assets/main-abc.js"></script>`;

describe("the tooling handle check", () => {
  it("lists each bundle the page loads once", () => {
    expect(bundlePaths(INDEX)).toEqual(["assets/main-abc.js", "assets/vendor-1.js"]);
  });

  it("recognizes the handle's publish and nothing else", () => {
    expect(publishesHandle("x.game=y")).toBe(true);
    expect(publishesHandle("window.game")).toBe(true);
    expect(publishesHandle("a.game==b")).toBe(false);
    expect(publishesHandle("const games = 1")).toBe(false);
  });

  it("answers true when a bundle publishes the handle, reading only up to it", async () => {
    const bodies: Record<string, string> = {
      "http://host:1/": INDEX,
      "http://host:1/assets/main-abc.js": "w.game=app",
    };
    const fetchText = vi.fn(async (url: string) => bodies[url] ?? "never read");
    expect(await distPublishesHandle("http://host:1/", fetchText)).toBe(true);
    expect(fetchText.mock.calls.map(([u]) => u)).toEqual(["http://host:1/", "http://host:1/assets/main-abc.js"]);
  });

  it("answers false when every bundle lacks the handle", async () => {
    const fetchText = vi.fn(async (url: string) => (url.endsWith("/") ? INDEX : "plain()"));
    expect(await distPublishesHandle("http://host:1", fetchText)).toBe(false);
    expect(fetchText).toHaveBeenCalledTimes(3);
  });

  it("answers true without proof: no bundles, or a failed fetch", async () => {
    expect(await distPublishesHandle("http://host:1", async () => "<html></html>")).toBe(true);
    expect(await distPublishesHandle("http://host:1", async () => Promise.reject(new Error("down")))).toBe(true);
  });

  it("names the flag in its message", () => {
    expect(missingHandleMessage("http://host:1")).toContain("VC_TOOLING=1");
  });
});

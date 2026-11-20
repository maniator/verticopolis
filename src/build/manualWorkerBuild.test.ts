import { describe, expect, it } from "vitest";
import {
  MANUAL_WORKER_MARKER,
  manualConfig,
  manualWorkerProblem,
  manualWorkerSource,
  savedPath,
  type BuiltFile,
} from "./manualWorkerBuild";

const file = (path: string, text = path): BuiltFile => ({ path, bytes: new TextEncoder().encode(text) });

const BUILT = [
  file("index.html"),
  file("rooms/hotels/index.html"),
  file("_astro/page.abc.js"),
  file("_astro/print.css"),
  file("_astro/logo.png"),
  file("_astro/desk-windows.webp"),
  file("_astro/page.abc.js.map"),
  file("pagefind/pagefind.js"),
  file("pagefind/fragment/en_1.pf_fragment"),
  file("catalog.json"),
  file("favicon.png"),
  file("cards/index.png"),
  file("sitemap-0.xml"),
  file("robots.txt"),
];

describe("savedPath", () => {
  it("saves a page under its folder and the front page as the base", () => {
    expect(savedPath("index.html")).toBe("");
    expect(savedPath("rooms/hotels/index.html")).toBe("rooms/hotels/");
    expect(savedPath("_astro/page.js")).toBe("_astro/page.js");
  });
});

describe("manualConfig", () => {
  it("saves pages, styles, scripts, small frame pictures, the catalog and search; leaves screenshots, maps, cards and sitemaps", () => {
    expect(manualConfig(BUILT).files.map((f) => f.url)).toEqual([
      "",
      "_astro/logo.png",
      "_astro/page.abc.js",
      "_astro/print.css",
      "catalog.json",
      "favicon.png",
      "pagefind/fragment/en_1.pf_fragment",
      "pagefind/pagefind.js",
      "rooms/hotels/",
    ]);
  });

  it("changes a file's revision and the version only when its contents change", () => {
    const before = manualConfig(BUILT);
    expect(manualConfig([...BUILT].reverse())).toEqual(before);
    const after = manualConfig(BUILT.map((f) => (f.path === "index.html" ? file(f.path, "new front page") : f)));
    expect(after.version).not.toBe(before.version);
    const rev = (c: typeof before, url: string) => c.files.find((f) => f.url === url)!.revision;
    expect(rev(after, "")).not.toBe(rev(before, ""));
    expect(rev(after, "rooms/hotels/")).toBe(rev(before, "rooms/hotels/"));
  });
});

describe("manualWorkerSource", () => {
  it("starts with the marker, sets the config, and starts the compiled worker with it", () => {
    const config = manualConfig(BUILT);
    const source = manualWorkerSource(config, "exports.startManualWorker = (self, c) => { self.started = c; };");
    expect(source.startsWith(`// ${MANUAL_WORKER_MARKER}`)).toBe(true);
    const self: Record<string, unknown> = {};
    new Function("self", source)(self);
    expect(self.started).toEqual(config);
    expect(manualWorkerProblem(source)).toBeNull();
  });

  it("escapes < in file names so the config cannot close anything", () => {
    const source = manualWorkerSource({ version: "v", files: [{ url: "</script>", revision: "r" }] }, "");
    expect(source).not.toContain("</script>");
  });
});

describe("manualWorkerProblem", () => {
  it("fails a missing file, another worker, or a worker that does not save the front page", () => {
    expect(manualWorkerProblem(null)).toMatch(/missing/);
    expect(manualWorkerProblem("// Verticopolis manual host: no service worker")).toMatch(
      /not the manual's offline worker/,
    );
    expect(manualWorkerProblem(manualWorkerSource({ version: "v", files: [] }, ""))).toMatch(/front page/);
    expect(manualWorkerProblem(`// ${MANUAL_WORKER_MARKER}\nself.__VC_MANUAL__ = {;\n`)).toMatch(/does not read/);
  });
});

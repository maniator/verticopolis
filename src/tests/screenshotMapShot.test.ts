import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { mapForShot, restoreMapAfterShot } from "./screenshotMapShot.ts";

/**
 * The gallery runner's Map check (#343): before each capture, `mapForShot`
 * fails an open Map that has not drawn its tower, and takes the Map off the
 * page for a shot cropped to something else; `restoreMapAfterShot` puts it
 * back as the scene had it. The page is this test's own document.
 */
const page = { evaluate: async <A, R>(fn: (arg: A) => R, arg: A) => fn(arg) } as unknown as Page;

let open = true;
/** Every `remember` the runner passed: a gallery run never stores a choice. */
const remembered: boolean[] = [];
const win = {
  isOpen: () => open,
  setOpen(next: boolean, remember: boolean) {
    remembered.push(remember);
    open = next;
    map().hidden = !next;
  },
};
const map = () => document.getElementById("overview-map")!;
const pill = () => document.getElementById("btn-map")!;

beforeEach(() => {
  document.body.innerHTML = '<div id="overview-map"></div><button id="btn-map" hidden></button>';
  open = true;
  remembered.length = 0;
  (window as unknown as { overviewMap?: typeof win }).overviewMap = win;
});

afterEach(() => {
  delete (window as unknown as { overviewMap?: typeof win }).overviewMap;
  document.body.innerHTML = "";
});

describe("mapForShot", () => {
  it("fails a shot of an open Map that has not drawn its tower, cropped or not", async () => {
    await expect(mapForShot(page, "scene/full", undefined)).rejects.toThrow("scene/full: the Map is open but has not drawn the tower yet");
    await expect(mapForShot(page, "scene/map", "#overview-map")).rejects.toThrow("has not drawn");
  });

  it("passes an open Map once it is marked drawn, and a closed one", async () => {
    map().dataset.mapDrawn = "true";
    await expect(mapForShot(page, "scene/full", undefined)).resolves.toBeUndefined();
    delete map().dataset.mapDrawn;
    win.setOpen(false, false);
    await expect(mapForShot(page, "scene/full", undefined)).resolves.toBeUndefined();
  });

  it("takes the Map and its pill off the page for a shot cropped to another element, then puts them back", async () => {
    await mapForShot(page, "scene/card", "#inspector");
    expect(open).toBe(false);
    expect(pill().hidden).toBe(true);
    expect(map().dataset.shotReopen).toBe("true");
    await restoreMapAfterShot(page);
    expect(open).toBe(true);
    expect(pill().hidden).toBe(true);
    expect(map().dataset.shotReopen).toBeUndefined();
    expect(remembered).toEqual([false, false]);
  });

  it("keeps the scene's own state over two cropped shots in a row, and leaves a crop of the Map or its pill alone", async () => {
    await mapForShot(page, "scene/card", "#inspector");
    await mapForShot(page, "scene/dialog", "#dialog");
    await restoreMapAfterShot(page);
    expect(open).toBe(true);
    map().dataset.mapDrawn = "true";
    pill().hidden = false;
    await mapForShot(page, "scene/pill", "#btn-map");
    await mapForShot(page, "scene/map", "#overview-map");
    expect(open).toBe(true);
    expect(pill().hidden).toBe(false);
  });

  it("shows the pill again after a cropped shot of a scene whose Map was closed", async () => {
    win.setOpen(false, false);
    pill().hidden = false;
    await mapForShot(page, "scene/card", "#inspector");
    expect(pill().hidden).toBe(true);
    await restoreMapAfterShot(page);
    expect(open).toBe(false);
    expect(pill().hidden).toBe(false);
  });

  it("counts a crop inside the Map as the Map's, and fails a Map crop that is hidden", async () => {
    map().dataset.mapDrawn = "true";
    map().innerHTML = '<canvas class="overview-map-view"></canvas>';
    await mapForShot(page, "scene/canvas", "#overview-map .overview-map-view");
    expect(open).toBe(true);
    // An id that only starts with the Map's is another element.
    document.body.insertAdjacentHTML("beforeend", '<div id="overview-map-help"></div>');
    await mapForShot(page, "scene/help", "#overview-map-help");
    expect(open).toBe(false);
    await restoreMapAfterShot(page);
    win.setOpen(false, false);
    await expect(mapForShot(page, "scene/map", "#overview-map")).rejects.toThrow("scene/map: the Map crop is hidden");
    await expect(mapForShot(page, "scene/pill", "#btn-map")).rejects.toThrow("scene/pill: the Map crop is hidden");
  });

  it("reads an empty crop as a full-page shot, and names a crop that is no CSS selector", async () => {
    map().dataset.mapDrawn = "true";
    await mapForShot(page, "scene/full", "");
    expect(open).toBe(true);
    await expect(mapForShot(page, "scene/pw", "#topbar >> nth=0")).rejects.toThrow(
      "scene/pw: the crop is not a CSS selector",
    );
    expect(open).toBe(true);
  });

  it("puts back the pill the scene had, even where the Map's own state would say otherwise", async () => {
    // A scene that hid both (a modal flow, say) gets both back as they were.
    win.setOpen(false, false);
    pill().hidden = true;
    await mapForShot(page, "scene/card", "#inspector");
    await restoreMapAfterShot(page);
    expect(open).toBe(false);
    expect(pill().hidden).toBe(true);
    expect(map().dataset.shotPill).toBeUndefined();
  });
});

/**
 * Gallery scenes for the overview Map window (#343), written into
 * docs/screenshots/features/. Part of the SCENES manifest
 * (screenshot-scenes.ts). Like every scene, they show the Map as a player
 * first meets it: open at the desktop stage's bottom-right, and on a phone
 * closed behind the pill until a tap.
 */
import { type Scene, PHONE } from "../screenshot-env.ts";
import { buildOverlayTower, buildSplitGapTowers } from "../screenshot-builders.ts";

export const OVERVIEW_MAP_SCENES: Scene[] = [
  // Open air of 2, 3 and 7 tiles between four towers: each gap shows on the
  // Map, at least 4 CSS pixels wide, on a computer and on a phone.
  {
    id: "overview-map-gaps",
    outDir: "features",
    build: buildSplitGapTowers,
    shots: [{ name: "map-window-gaps", crop: "#overview-map", frame: { floor: 8, zoom: 0.6 } }],
  },
  {
    id: "overview-map-gaps-phone",
    outDir: "features",
    viewport: PHONE,
    build: buildSplitGapTowers,
    shots: [
      {
        name: "map-phone-gaps",
        crop: "#overview-map",
        frame: { floor: 8, zoom: 0.5 },
        setup: async (page) => {
          await page.click("#btn-map");
          await page.waitForSelector("#overview-map:not([hidden])");
        },
      },
    ],
  },
  {
    id: "overview-map",
    outDir: "features",
    build: buildOverlayTower,
    assertUnits: 200,
    shots: [
      { name: "map-desktop", frame: { floor: 15, zoom: 0.6 } },
      { name: "map-window", crop: "#overview-map", frame: { floor: 15, zoom: 0.6 } },
    ],
  },
  {
    id: "overview-map-phone",
    outDir: "features",
    viewport: PHONE,
    build: buildOverlayTower,
    assertUnits: 200,
    shots: [
      { name: "map-phone-pill", frame: { floor: 10, zoom: 0.5 } },
      {
        name: "map-phone-open",
        frame: { floor: 10, zoom: 0.5 },
        setup: async (page) => {
          await page.click("#btn-map");
          await page.waitForSelector("#overview-map:not([hidden])");
        },
      },
      // The open card on its Traffic view, with the view's legend.
      {
        name: "map-phone-traffic",
        mapView: "traffic",
        frame: { floor: 10, zoom: 0.5 },
        setup: async (page) => {
          if (await page.locator("#overview-map").isHidden()) await page.click("#btn-map");
          await page.waitForSelector("#overview-map:not([hidden])");
        },
      },
    ],
  },
];

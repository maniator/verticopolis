import { test, expect } from "@playwright/test";
import { bundleBake } from "../scripts/atlas-bundle.ts";

/**
 * The sprite atlas (issue #909, `scripts/export-atlas.ts`) must reproduce the
 * web game's own bake. For a sample of live room signatures this composes the
 * atlas frame plus its runtime layers the way a frontend reads the manifest
 * (`src/render/atlas/lookup.ts`), paints the same room the way the region
 * compositor does, and requires the two to match pixel for pixel
 * (`src/render/atlas/verify.ts`). It runs in the same pinned Chromium the
 * export uses, so a drift between the atlas and the game fails here first.
 */

type Unit = { kind: string; state: string; subtype?: string; occupants: number; outForMeal?: number; id: number };
type Scene = { hour: number; lit: boolean; parkingUse: number; recycleFill: number; dead: boolean };
type Sample = { label: string; unit: Unit; scene: Scene; variant: number; frame?: number };

const DAY: Scene = { hour: 12, lit: false, parkingUse: 0, recycleFill: 0, dead: false };
const NIGHT: Scene = { ...DAY, hour: 20, lit: true };
const LATE: Scene = { ...DAY, hour: 2, lit: true };

function s(label: string, unit: Partial<Unit> & { kind: string }, scene: Scene, variant = 0, frame?: number): Sample {
  return { label, unit: { state: "occupied", occupants: 0, id: 1, ...unit }, scene, variant, frame };
}

const SAMPLES: Sample[] = [
  s("office full, noon", { kind: "office", occupants: 6 }, DAY),
  s("office at lunch (3 of 6 out)", { kind: "office", occupants: 6, outForMeal: 3 }, DAY, 1),
  s("office all out to lunch", { kind: "office", occupants: 4, outForMeal: 4 }, DAY, 2),
  s("office empty at night", { kind: "office", occupants: 0 }, NIGHT, 3),
  s("office on notice", { kind: "office", state: "vacating", occupants: 2 }, NIGHT),
  s("office for lease", { kind: "office", state: "empty" }, DAY, 1),
  s("condo home in the evening", { kind: "condo", occupants: 3 }, NIGHT),
  s("condo asleep late", { kind: "condo", occupants: 3 }, LATE, 2),
  s("condo out for dinner", { kind: "condo", occupants: 3, outForMeal: 2 }, NIGHT, 1),
  s("studio", { kind: "rentalStudio", occupants: 1 }, DAY, 3),
  s("apartment household", { kind: "rentalApartment", occupants: 5 }, NIGHT, 2),
  s("single asleep", { kind: "hotelSingle", state: "asleep", occupants: 1 }, LATE),
  s("double dirty", { kind: "hotelDouble", state: "dirty" }, DAY, 1),
  s("suite infested", { kind: "hotelSuite", state: "infested" }, DAY, 2),
  s("suite guests in", { kind: "hotelSuite", occupants: 2 }, NIGHT, 3),
  s("fast food open, busy", { kind: "fastFood", subtype: "Ice Cream", occupants: 14 }, DAY),
  s("fast food closed", { kind: "fastFood", subtype: "Coffee Shop", occupants: 2 }, LATE, 1),
  s("restaurant dinner", { kind: "restaurant", subtype: "Sushi Bar", occupants: 20 }, { ...NIGHT, hour: 19 }, 2),
  s("restaurant legacy no subtype", { kind: "restaurant", occupants: 3 }, { ...DAY, hour: 12 }, 3),
  s("shop one customer", { kind: "shop", subtype: "Book Store", occupants: 1 }, DAY),
  s("shop busy", { kind: "shop", subtype: "Bank", occupants: 7 }, DAY, 1),
  s("shop closed at night", { kind: "shop", subtype: "Pet Store", occupants: 1 }, NIGHT, 2),
  s("food hall", { kind: "foodHall", subtype: "Ramen Bar", occupants: 9 }, DAY, 3),
  s("cinema matinee", { kind: "cinema", occupants: 12 }, { ...DAY, hour: 14 }),
  s("party hall", { kind: "partyHall", occupants: 18 }, NIGHT, 1),
  s("wedding hall", { kind: "weddingHall", occupants: 10 }, DAY, 2),
  s("aquatic center", { kind: "aquaticCenter", occupants: 6 }, DAY, 3),
  s("amusements", { kind: "amusements", subtype: "VR Lounge", occupants: 5 }, NIGHT),
  s("boutique bay", { kind: "boutiqueBay", subtype: "Tattoo", occupants: 2 }, DAY, 1),
  s("fitness club", { kind: "fitnessClub", subtype: "Climbing Wall", occupants: 4 }, DAY, 2),
  s("clinic", { kind: "clinic", subtype: "Dental", occupants: 3 }, DAY, 3),
  s("nightclub", { kind: "nightclub", occupants: 15 }, { ...LATE, hour: 22 }),
  s("spa", { kind: "spa", occupants: 4 }, DAY, 1),
  s("sky bar", { kind: "skyBar", occupants: 6 }, { ...NIGHT, hour: 18 }, 2),
  s("daycare", { kind: "daycare", occupants: 7 }, DAY, 3),
  s("security", { kind: "security" }, NIGHT),
  s("medical", { kind: "medical" }, DAY, 1),
  s("housekeeping", { kind: "housekeeping" }, DAY, 2),
  s("parking ramp", { kind: "parkingRamp" }, DAY, 3),
  s("parking empty", { kind: "parking", id: 9 }, DAY),
  s("parking with a car", { kind: "parking", id: 12 }, { ...DAY, parkingUse: 1 }, 1),
  s("parking dead", { kind: "parking", id: 12 }, { ...DAY, parkingUse: 1, dead: true }, 2),
  s("recycling half full", { kind: "recycling" }, { ...DAY, recycleFill: 4 / 8 }),
  s("recycling full", { kind: "recycling" }, { ...DAY, recycleFill: 1 }, 2),
  s("metro", { kind: "metro" }, DAY),
  s("office gutted", { kind: "office", state: "gutted" }, DAY),
  s("office on fire", { kind: "office", state: "fire" }, DAY, 0, 5),
  s("cinema under construction", { kind: "cinema", state: "construction" }, DAY, 0, 17),
];

test.describe("sprite atlas matches the web bake", () => {
  test("composed frames equal the region compositor's paint", async ({ page }, info) => {
    test.skip(info.project.name !== "chromium", "the comparison is engine-independent, so it runs on one project");
    test.setTimeout(180_000);
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: await bundleBake() });
    const results = await page.evaluate((samples) => (globalThis as any).__vcAtlas.verify(samples), SAMPLES);
    const bad = results.filter((r: { mismatches: number }) => r.mismatches > 0);
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
    expect(results).toHaveLength(SAMPLES.length);
  });
});

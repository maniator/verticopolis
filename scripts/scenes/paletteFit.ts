/**
 * Gallery scenes for the desktop Tools window's fit (src/ui/paletteFit.ts),
 * written into docs/screenshots/features/. Part of the SCENES manifest
 * (screenshot-scenes.ts). A Modern tower at five stars lists every tool, the
 * longest list there is: on a 1280x800 window it takes two columns of compact
 * rows, and on a taller window compact rows alone, so no tool needs a scroll.
 * Then three categories fold from their headers, and the window drops back to
 * one normal column; the last shot folds the whole window into its strip.
 */
import { type Scene } from "../screenshot-env.ts";

/** A small Modern tower at five stars, so the palette lists every tool. Runs
 *  in the page, so it names nothing from outside. */
function buildFullModernPalette(): void {
  const g = (window as unknown as { game: any }).game;
  g.sim = g.sim.constructor.newGame(4400, "modern");
  const s = g.sim;
  s.money = 500_000_000;
  s.star = 5;
  const cx = Math.floor(g.grid.width / 2);
  // A tile the tower already has (the seeded lobby strip) refuses harmlessly,
  // so the check is on the result: the lobby and floors span the lot's middle.
  for (let x = cx; x <= cx + 20; x++) s.tower.place("lobby", 1, x);
  for (let x = cx - 1; x >= cx - 20; x--) s.tower.place("lobby", 1, x);
  for (let f = 2; f <= 4; f++) for (let x = cx - 20; x <= cx + 20; x++) s.tower.place("floor", f, x);
  const lift = s.tower.placeTransport("elevatorStandard", cx - 16, 1, 4);
  if (!lift.ok) throw new Error("palette-fit: the elevator did not place");
  const floors = (s.tower.units as { kind: string; floor: number }[]).filter((u) => u.kind === "floor" && u.floor === 4);
  if (floors.length === 0) throw new Error("palette-fit: floor 4 did not place");
  if (s.star !== 5) throw new Error("palette-fit: the tower is not at five stars");
}

export const PALETTE_FIT_SCENES: Scene[] = [
  {
    id: "palette-fit",
    outDir: "features",
    build: buildFullModernPalette,
    shots: [
      // 1280x800: two columns of compact rows.
      { name: "palette-fit-columns", frame: { floor: 3, zoom: 1.0 } },
      // A taller window: compact rows in one column, the window's usual width.
      // The crop holds only the Tools window (DOM), so the canvas the viewport
      // change resizes is outside it and the settle need not draw every frame.
      {
        name: "palette-fit-compact",
        viewport: { width: 1600, height: 1150 },
        crop: "#palette",
        frame: { floor: 3, zoom: 1.0 },
      },
      // Living, Leisure and Services folded from their headers: one column again.
      {
        name: "palette-sections-folded",
        crop: "#palette",
        frame: { floor: 3, zoom: 1.0 },
        setup: async (page) => {
          for (const group of ["Living", "Leisure", "Services"]) await page.click(`.pal-group[data-group="${group}"] > .pal-group-title[role="button"]`);
          await page.waitForSelector('#palette:not(.pal-fit-columns) .pal-group.pal-folded[data-group="Services"]');
          // The list moved up under the pointer: park it on the top bar so no
          // row shows its hover.
          await page.mouse.move(640, 10);
        },
      },
      // Folded into a strip by its title bar's button, at 1280x800. The fold
      // widens the stage, so the canvas resizes: like the tablet's viewport
      // shots, its settle draws every frame (drawSettle) to stay byte-stable.
      {
        name: "palette-folded",
        drawSettle: true,
        frame: { floor: 3, zoom: 1.0 },
        setup: async (page) => {
          await page.click("#btn-palette-collapse");
          await page.waitForSelector("#palette.pal-collapsed");
          // Park the pointer on the top bar, off the strip and the tower, and
          // let the canvas take its new size before the settle.
          await page.mouse.move(640, 10);
          await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
        },
      },
    ],
  },
];

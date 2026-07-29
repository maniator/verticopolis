/**
 * The 2.0 "Ground floor" badge (feature shot). A returning player whose tower
 * predates 2.0 sees a small gold badge on the title screen next to the version.
 * The badge is only wired to show when the loaded tower is a Founder
 * (`app.sim.founder`), so this scene re-mounts the splash directly with the
 * founder opt on to capture that returning-player view. Part of the SCENES
 * manifest; concatenated by screenshot-scenes.ts. Keep ERASABLE.
 */
import { PHONE, type Scene } from "../screenshot-env.ts";

export const FOUNDER_SCENES: Scene[] = [
  {
    id: "founder-badge",
    outDir: "features",
    keepSplash: true, // this scene captures a splash state, so don't dismiss it
    shots: [
      {
        name: "founder-badge",
        wait: 400,
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as unknown as { game: any }).game;
            // A fresh boot mounts the splash with founder=false; drop it and
            // re-mount the returning-Founder view (hasSave + the badge on).
            document.getElementById("splash")?.remove();
            g.onboarding.showSplash({
              hasSave: true,
              onContinue: () => {},
              onNewTower: () => {},
              installOffered: () => false,
              founder: () => true,
            });
          });
          // Fail the shot (keep the committed image) if the badge never mounts.
          await page.waitForSelector(".splash-founder", { timeout: 4000 });
        },
      },
    ],
  },
  {
    // The phone companion Epic 8 asks for. The badge is pinned bottom-left while
    // the attribution paragraph is centered above the bottom edge, so a narrow
    // viewport is exactly where the two could collide; capturing it makes any
    // future overlap a visible drift rather than a report from a real phone.
    id: "founder-badge-mobile",
    outDir: "features",
    viewport: PHONE,
    keepSplash: true,
    shots: [
      {
        name: "founder-badge-mobile",
        wait: 400,
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as unknown as { game: any }).game;
            document.getElementById("splash")?.remove();
            g.onboarding.showSplash({
              hasSave: true,
              onContinue: () => {},
              onNewTower: () => {},
              installOffered: () => false,
              founder: () => true,
            });
          });
          await page.waitForSelector(".splash-founder", { timeout: 4000 });
        },
      },
    ],
  },
];

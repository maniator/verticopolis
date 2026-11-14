/**
 * The rain shot (#638), kept apart so the feature scenes stay under the file
 * ceiling. It is the last shot of the `lobby-awnings` scene in `features.ts`.
 * Keep ERASABLE.
 */
import type { Shot } from "../screenshot-env.ts";

export const RAIN_SHELTERED_SHOT: Shot = {
  // Rain falls on the open sky and the street, never on the rooms or
  // the basements (#638). The weather is a presentation input on the
  // read model with no command to set it, so the shot pins it on the
  // render sim it draws from. Last in the scene, since nothing unpins it.
  name: "rain-sheltered",
  clock: 12,
  wait: 500,
  setup: async (page) => {
    await page.evaluate(() => {
      const g = (window as any).game;
      Object.defineProperty(g.engine.sim, "weather", { get: () => "rain", configurable: true });
      if (g.engine.sim.weather !== "rain") throw new Error("the rain-sheltered shot could not pin the weather to rain");
      let min = Infinity;
      for (const u of g.sim.tower.units) {
        if (u.kind === "lobby" && u.floor === 1) min = Math.min(min, u.x);
      }
      g.engine.setCamera(min, 3, 2);
    });
  },
};

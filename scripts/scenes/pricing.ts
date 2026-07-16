/**
 * Mode-fork scenes: the Modern pricing surfaces (issue #443). Part of the
 * SCENES manifest; concatenated in order by `screenshot-scenes.ts`. Each
 * `build`/`setup` that runs in the page references an injected builder by
 * identity. Keep ERASABLE.
 *
 * The pricing split (PR #440) is the first change where Classic and Modern
 * diverge on player-visible SURFACES rather than just numbers: the editor
 * card's price control (1994 rung picker vs free steppers), the batch dialog
 * body (rung variant vs number band), and the stats Tenancy block (Classic
 * shows the off-market Vacancies split; Modern, which never holds the No-Rate
 * state, shows plain vacancies plus its Households readout). The Classic
 * halves of those shot pairs render off the existing classic towers (the
 * showcase and stats scenes); these TWO compact scenes share one modern-rules
 * tower builder and carry all three Modern siblings, so every non-diverging
 * scene stays single-mode. Two scenes rather than one because the runner keys
 * deviceScaleFactor on the SCENE's outDir (screenshots 1x, features 2x) and
 * each half of a pair must mint at its sibling's scale: the features pair
 * halves render in `pricing-modern` at 2x, the showcase-bound batch dialog in
 * `pricing-modern-batch` at 1x.
 */
import { type Scene } from "../screenshot-env.ts";
import { buildModernPricingTower } from "../screenshot-builders.ts";

export const PRICING_SCENES: Scene[] = [
  {
    id: "pricing-modern",
    outDir: "features",
    build: buildModernPricingTower,
    assertUnits: 60,
    shots: [
      {
        name: "editor-pricing-modern",
        crop: "#editor",
        setup: async (page) => {
          await page.evaluate(() => {
            const g = (window as any).game;
            const office = g.sim.tower.units.find((u: any) => u.kind === "office" && u.state === "occupied");
            if (!office) throw new Error("pricing-modern tower has no occupied office to select");
            g.selected = { type: "unit", id: office.id };
            g.engine.selectedId = office.id;
            g.refreshEditor();
          });
          // Fail loudly if the Modern steppers never render in the card.
          await page.waitForSelector('#editor [data-edit="rentUp"]', { timeout: 4000 });
        },
        wait: 300,
      },
      {
        name: "stats-tenancy-modern",
        crop: "#modal .modal-box",
        setup: async (page) => {
          await page.evaluate(() => document.getElementById("btn-stats")?.click());
          await page.waitForSelector("#modal .stats-grid", { timeout: 4000 });
          // Frame the Tenancy block and assert the Modern-only Households
          // readout (this shot's whole subject) actually rendered, so a
          // template rename or a mode-staging regression fails the shot
          // instead of committing a picture of the wrong thing.
          await page.evaluate(() => {
            const box = document.querySelector("#modal .modal-box") as HTMLElement;
            const secs = [...box.querySelectorAll(".stats-section")];
            const sec = secs.find((h) => /Tenancy/.test(h.textContent || "")) as HTMLElement | undefined;
            if (!sec) throw new Error("stats dialog has no Tenancy section to frame");
            if (!secs.some((h) => /Households/.test(h.textContent || ""))) {
              throw new Error("the Modern-only Households readout did not render");
            }
            box.scrollTop = sec.offsetTop - box.offsetTop - 8;
          });
        },
        wait: 300,
      },
    ],
  },
  {
    // The Modern half of the batch-pricing pair. Its own scene (same builder
    // as pricing-modern) because its Classic sibling lives in the showcase
    // gallery at deviceScaleFactor 1, and the runner keys DSF on the scene's
    // outDir: minted from the features-outDir scene above it would land at
    // twice its sibling's resolution.
    id: "pricing-modern-batch",
    outDir: "screenshots",
    build: buildModernPricingTower,
    assertUnits: 60,
    shots: [
      {
        name: "10-batch-pricing-modern",
        keepDialogs: true,
        setup: async (page) => {
          // Select an occupied office, then open the batch dialog off its
          // editor card.
          await page.evaluate(() => {
            const g = (window as any).game;
            const office = g.sim.tower.units.find((u: any) => u.kind === "office" && u.state === "occupied");
            if (!office) throw new Error("pricing-modern tower has no occupied office to select");
            g.selected = { type: "unit", id: office.id };
            g.engine.selectedId = office.id;
            g.refreshEditor();
          });
          await page.waitForTimeout(150);
          await page.evaluate(() => (document.querySelector('#editor [data-edit="batchKind"]') as HTMLElement | null)?.click());
          // The Modern dialog is the number-band variant. Type a price so the
          // dialog reads in use (custom value + live preview line); the
          // Classic sibling has no number input and instead shows the rung
          // ladder at its Average default, so the pair differs here on
          // purpose: each variant is captured in its own natural editing
          // state.
          await page.waitForSelector("#modal #bp-price", { timeout: 4000 });
          await page.evaluate(() => {
            const el = document.querySelector("#bp-price") as HTMLInputElement;
            el.value = "12000";
            el.dispatchEvent(new Event("input", { bubbles: true }));
          });
        },
        wait: 250,
      },
    ],
  },
];

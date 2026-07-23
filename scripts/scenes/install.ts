/**
 * Install-affordance scenes (SPEC-pwa-install): the in-game "⤓ Install" surface
 * on desktop and mobile. Part of the SCENES manifest; concatenated in order by
 * `screenshot-scenes.ts`. Exists because the install offer is otherwise invisible
 * in the gallery: the topbar chip and the Game-panel entry are hidden until a
 * browser both fires `beforeinstallprompt` AND meets the play-gate, neither of
 * which happens in a plain capture run. These scenes stage that installable state
 * for real (a synthetic `beforeinstallprompt` through the same seam the app
 * listens on) and reveal the chip, so a render-affecting change to the affordance
 * shows up as a gallery diff. The SPLASH install button (CAP-5) needs no scene of
 * its own: it shows for any not-standalone session, so the existing `00-splash` /
 * `00-splash-mobile` shots already carry it.
 *
 * Backdrop is a STATIC canon tower at a frozen clock, NOT the live `buildEngineTower`
 * demo: the chip is the subject, and a live-motion draw (crowds/elevators) plus the
 * PHONE viewport is nondeterministic across the drift-check's two render legs. This
 * mirrors the deterministic `mobile` showcase scene (canon tower, fixed clock, no
 * drawSettle). Keep ERASABLE.
 */
import { type Scene, PHONE } from "../screenshot-env.ts";
import { buildCanonTower } from "../screenshot-builders.ts";

/** Page-context: make the session installable through the real seam, then reveal
 *  the in-game chip. Dispatching a synthetic `beforeinstallprompt` drives
 *  `initPwaInstall`'s own listener (so `installAvailability()` becomes "prompt"
 *  and the controller un-hides the Game-panel entry via its onChange); the chip
 *  is then shown directly, standing in for the play-gated tick that surfaces it
 *  in a live session. Purely DOM + a synthetic event, so it adds no time- or
 *  RNG-driven pixels: the shot stays deterministic. */
function stageInstallable(): void {
  const e = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = () => Promise.resolve();
  e.userChoice = Promise.resolve({ outcome: "accepted" });
  e.preventDefault = () => {};
  window.dispatchEvent(e);
  const chip = document.getElementById("btn-install") as HTMLButtonElement | null;
  if (chip) chip.hidden = false;
}

export const INSTALL_SCENES: Scene[] = [
  {
    id: "install-affordance",
    outDir: "features",
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      {
        // Desktop gameplay with the topbar "⤓ Install" chip surfaced. A static
        // canon tower is the backdrop at a fixed midday clock; the chip is the
        // subject, so the full topbar is in frame.
        name: "install-affordance-desktop",
        setup: async (page) => void (await page.evaluate(stageInstallable)),
        clock: 12,
        frame: { floor: 8, zoom: 0.5 },
        wait: 800,
      },
    ],
  },
  {
    id: "install-affordance-mobile",
    outDir: "features",
    viewport: PHONE,
    build: buildCanonTower,
    assertUnits: 200,
    shots: [
      {
        // Determinism note: revealing the topbar install chip reflows the WRAPPING
        // mobile #topbar, which shrinks #stage and makes Excalibur's ResizeObserver
        // resize the canvas. That observer fires on the browser's own schedule, NOT
        // the stepped TestClock, so if the resize lands mid-settle the drift-check's
        // two render legs disagree (desktop never wraps, so it never hits this).
        // Order fixes it: reveal the chip, flush the observer with two rAFs (the
        // stopped Excalibur clock means this advances no sim or animation time, so
        // the resize fully applies with zero frames stepped), THEN set the camera
        // against the settled canvas. Mirrors takeShot's own post-viewport-resize
        // flush. Camera via explicit setCamera args (not `frame`, which reads canvas
        // size) keeps the shot a pure function of the seeded tower.
        name: "install-affordance-mobile",
        setup: async (page) => {
          await page.evaluate(stageInstallable);
          await page.evaluate(
            () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
          );
          await page.evaluate(() =>
            (window as { game?: { engine: { setCamera: (x: number, y: number, z: number) => void }; grid: { width: number } } }).game!.engine.setCamera(
              Math.floor(
                (window as { game?: { grid: { width: number } } }).game!.grid.width / 2,
              ),
              18,
              0.32,
            ),
          );
        },
        clock: 12,
        wait: 1000,
      },
    ],
  },
];

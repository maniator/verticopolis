/**
 * The Chromium flags every committed pixel is rendered with: the screenshot
 * gallery (`scripts/screenshots.ts`, docs/screenshots) and the visual
 * regression baselines (`e2e/visual.spec.ts`, #797). Both pass these, so two
 * browsers in one container cannot settle a raster differently.
 *
 * Compositor flags added for #762 by PR #871. Its evidence held (the only
 * differing pixels in 27c-elevator-schedule-unsaved were the dialog's two
 * sticky layers, a subpixel text phase apart) but its cause did not hold.
 * The race happens before the scroll: a composited layer keeps the subpixel
 * phase of its first raster, and 27c's dialog moved by a fraction of a pixel
 * after a first render that CI load decided whether to make. Measured with
 * these flags on, 8 of 24 renders still took the raster that differs from
 * the committed PNG. The fix lives in the 27c scene
 * (scripts/scenes/schedule.ts), and takeShot guards that shot with the
 * dialog phase watch (Shot.phaseWatch; other dialog shots are #889). The
 * flags stay because every committed PNG was minted with them on, so
 * dropping them is a pixel change of its own: running every compositor stage
 * to completion before a draw (the flag Chromium's own pixel tests use), no
 * checker imaging, no off-main-thread animation.
 */
export const DETERMINISTIC_RASTER_ARGS: readonly string[] = [
  "--run-all-compositor-stages-before-draw",
  "--disable-checker-imaging",
  "--disable-threaded-animation",
];

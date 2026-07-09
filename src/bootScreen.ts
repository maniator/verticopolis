/**
 * Pure boot-screen decision, split out of main.ts (the GameApp constructor,
 * which needs a canvas + WebGL and can't be unit-tested) so the rule is covered
 * without a browser. Same rationale as `./pwaUpdateInfo` splitting the
 * version-info sanitizer out of `./pwa`.
 *
 * The rule: the title screen ("splash") loads on EVERY boot, except an
 * app-initiated resume reload with a readable save to resume into. Two reloads
 * qualify as app-initiated: the post-"Update now" reload (the update modal
 * promised "keep playing") and the WebGL context-loss recovery reload (a GPU
 * crash we auto-recover from). Both drop the player straight back in ("resume",
 * paused). Everything else (cold reopen, a manual reload, first run, a
 * corrupt/unreadable save) shows the splash.
 */

/** Which first screen a boot presents. `"resume"` drops straight into the tower
 *  (paused); `"splash"` shows the title screen. */
export type BootScreen = "resume" | "splash";

/**
 * Decide the boot screen. Only an app-initiated resume reload (`justUpdated` or
 * `justRecovered`) with a readable save skips the splash; a resume that reloaded
 * into a corrupt/absent save (`hadReadableSave` false) still splashes, since
 * there's nothing to resume into.
 */
export function resolveBootScreen(opts: {
  hadReadableSave: boolean;
  justUpdated: boolean;
  justRecovered: boolean;
}): BootScreen {
  return opts.hadReadableSave && (opts.justUpdated || opts.justRecovered) ? "resume" : "splash";
}

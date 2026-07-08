/**
 * The seam between the game and a bundled native wrapper (the iOS Capacitor
 * shell built in the private distribution repo). The public repo takes
 * no wrapper dependency: a wrapper injects its implementation through the
 * `__VC_PLATFORM__` global, and the browser default in `./browser.ts` covers
 * everything else. The Android TWA renders the live site with the plain web
 * build, so it never sets the global and never sees `isNativeWrapper: true`.
 *
 * Cross-repo contract (the wrapper shell implements against this file):
 *  - The shell script must set `globalThis.__VC_PLATFORM__` BEFORE the game's
 *    module scripts run (the wrapper's build patches index.html to load it
 *    first), and must consume the `--mode native` bundle. Injecting the global
 *    into a plain-mode bundle is unsupported; plain bundles ignore it.
 *  - `isNativeWrapper` must be literally `true` on an injected port; the
 *    resolver treats anything else (including a truthy non-boolean) as a
 *    malformed injection and falls back to the browser port.
 *  - `saveFile` contents are a string for the `.vctower` text payload (see
 *    SaveGame.export) or a Uint8Array for the binary `.TDT` legacy export; a
 *    shell built before the binary path may reject the byte form, and the
 *    game surfaces that rejection to the player as a failed save (graceful
 *    degradation, not corruption). A native implementation must RESOLVE when
 *    the player cancels
 *    the share/save flow (cancel is not an error) and reject only on real
 *    failure; the game surfaces rejections to the player.
 *  - The game only ever hands `openExternal` http(s) URLs from its own UI; a
 *    native implementation should still validate the scheme before forwarding
 *    to the system browser, and must also cover activations that bypass DOM
 *    click handlers (long-press menus, middle-button auxclick the game does
 *    not see) through its WebView navigation delegate.
 */
export interface PlatformPort {
  /** True only on a wrapper-injected port. The browser default is false. */
  readonly isNativeWrapper: boolean;
  /** Deliver an exported file to the player: a download in the browser, a
   *  share/save flow in a native shell. */
  saveFile(filename: string, contents: string | Uint8Array<ArrayBuffer>, mime: string): Promise<void>;
  /** Open a URL outside the game, so a native shell can hand it to the system
   *  browser instead of navigating its WebView away. May return a Promise
   *  (Capacitor's Browser.open does); the game folds a rejection into the
   *  same browser fallback as a synchronous throw. */
  openExternal(url: string): void | Promise<void>;
}

declare global {
  /** Untrusted wrapper injection point; duck-checked in `./index.ts` before use. */
  var __VC_PLATFORM__: unknown;
}

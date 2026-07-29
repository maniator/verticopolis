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
 *    SaveGame.export) or a Uint8Array for the binary `.TDT` legacy export. The
 *    parameter stays the non-generic `Uint8Array` so a wrapper repo pinned to
 *    an older TypeScript (where typed arrays are not generic) can still
 *    compile against this contract. A
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
 *  - `onHostCommand` is OPTIONAL, and deliberately so: a shell built against
 *    an earlier revision of this contract carries only the three members above
 *    and must keep duck-validating (see `isPlatformPort`). A required fourth
 *    member would silently demote such a shell to the browser port and take
 *    its native file save with it.
 */

/**
 * A command a wrapper shell may ask the game to run, named for what the player
 * gets rather than for the affordance that sent it (a desktop menu item today,
 * possibly something else later).
 *
 * Store-neutral by construction: every value here maps to a control the plain
 * web build already has, so this union says nothing about any storefront.
 * Adding a value is a public-repo change reviewed on that basis.
 */
export type HostCommand =
  | "new-game"
  | "save"
  | "open-saves"
  | "undo"
  | "redo"
  | "stats"
  | "help"
  | "settings";

export interface PlatformPort {
  /** True only on a wrapper-injected port. The browser default is false. */
  readonly isNativeWrapper: boolean;
  /** Deliver an exported file to the player: a download in the browser, a
   *  share/save flow in a native shell. */
  saveFile(filename: string, contents: string | Uint8Array, mime: string): Promise<void>;
  /** Open a URL outside the game, so a native shell can hand it to the system
   *  browser instead of navigating its WebView away. May return a Promise
   *  (Capacitor's Browser.open does); the game folds a rejection into the
   *  same browser fallback as a synchronous throw. */
  openExternal(url: string): void | Promise<void>;
  /**
   * Subscribe to commands from the shell: the one seam that runs shell to
   * game, where every other member runs game to shell. Optional, so a shell
   * that drives nothing simply omits it and the game binds nothing.
   *
   * The shell sends INTENT and never permission. It does not know whether a
   * command can run right now, so it never disables the affordance that sends
   * one; the game applies its own guards and tells the player when it refuses
   * (see `src/game/hostCommands.ts`). That keeps game state out of the shell
   * entirely, which on Electron means out of a separate OS process.
   *
   * Called at most once, during boot. A shell may deliver commands at any time
   * after that.
   */
  onHostCommand?(handler: (command: HostCommand) => void): void;
  /**
   * Tell the shell which commands can run right now, so it can gray out the
   * rest instead of offering an affordance that will be refused.
   *
   * This does not move the decision into the shell. The game is still the only
   * thing that decides, and it still re-checks on arrival: a command can become
   * unavailable between the push and the click. The shell renders what it was
   * told and reasons about nothing, so no game state is duplicated there and
   * the two cannot disagree about what a splash is.
   *
   * Called once at boot and again whenever the set changes. Optional, like
   * `onHostCommand`: a shell that cannot gray anything out simply omits it and
   * keeps everything enabled, which stays correct because of the re-check.
   */
  setCommandsAvailable?(commands: readonly HostCommand[]): void;
}

declare global {
  /** Untrusted wrapper injection point; duck-checked in `./index.ts` before use. */
  var __VC_PLATFORM__: unknown;
}

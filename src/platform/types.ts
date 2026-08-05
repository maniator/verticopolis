/**
 * The seam between the game and a bundled wrapper shell built in the private
 * distribution repo. Either wrapped build mode can bind it; epic E3b specifies
 * the iOS Capacitor shell doing so, and no shell binds it yet. The public repo
 * takes no wrapper dependency: a wrapper injects its implementation through the
 * `__VC_PLATFORM__` global, and the browser default in `./browser.ts` covers
 * everything else. The Android TWA renders the live site with the plain web
 * build, so it never sets the global and never sees `isNativeWrapper: true`.
 *
 * Cross-repo contract (the wrapper shell implements against this file):
 *  - The shell script must set `globalThis.__VC_PLATFORM__` BEFORE the game's
 *    module scripts run (the wrapper's build patches index.html to load it
 *    first), and must consume a wrapped bundle: `--mode native` for iOS,
 *    `--mode desktop` for the Electron shell. Injecting the global into a
 *    plain-mode bundle is unsupported; plain bundles ignore it.
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
 *    its native file save with it. `setCommandsAvailable` and `saveStore` are
 *    optional on the same grounds; every member added here after the original
 *    three must be.
 */

import type { SaveStorePort } from "./saveStore";

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
  /**
   * Subscribe to the shell's QUIT-TIME flush request (story D6). The shell
   * calls the handler when the player quits (menu, Cmd+Q, or the window's
   * close button), and the handler runs the same splash-guarded SYNCHRONOUS
   * flush the update path uses, so the tower the player was just playing is
   * on disk before the process exits. Synchronous is the contract: the shell
   * observes the flush as the `writeSync` arriving on its own channel, so an
   * async handler would look like no flush at all.
   *
   * Optional like every member added after the original three, and latched
   * to at most one registration like `onHostCommand`. A shell that omits it
   * simply keeps the current loss bound (one autosave interval).
   */
  onFlushRequest?(handler: () => void): void;
  /**
   * Durable storage the game uses in place of localStorage when a shell offers
   * it. Optional for the same reason as the two members above, and the reason
   * bites harder here: the iOS Capacitor shell implements the three-member
   * revision of this contract, so requiring a save store would demote it to the
   * browser port and take its native file save with it.
   *
   * Omitted rather than stubbed on ports that have no store (see
   * `./browser.ts`), so a caller can ask `if (port.saveStore)` and get a
   * truthful runtime answer.
   *
   * That check does NOT make the store code fold out of a browser bundle, and
   * an earlier version of this comment claimed it did. `port.saveStore` is a
   * property read on a value returned by `getPlatform()`, which Rollup cannot
   * prove undefined, so the branch and everything it references ship to every
   * player. Only `IS_WRAPPED_BUILD` folds, because Vite statically replaces
   * `import.meta.env.MODE` (see `./index.ts`). Anything that must stay out of
   * the browser bundle goes behind that, and is checked in the built artifact
   * by `scripts/verify-wrapper-seam.ts`, since a source test cannot see it.
   *
   * See `./saveStore.ts` for the blob shape and the opaque scope token.
   */
  saveStore?: SaveStorePort;
}

declare global {
  /** Untrusted wrapper injection point; duck-checked in `./index.ts` before use. */
  var __VC_PLATFORM__: unknown;
}

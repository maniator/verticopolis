import type { ReleaseNotes } from "./changelog";

/**
 * This build's notes for the Help menu's What's new, baked in at build time
 * (`whatsNewReleases` in src/changelog.ts, injected as `__WHATS_NEW__` by
 * vite.config.ts). The game imports this module on demand, so the text is its
 * own precached chunk: it works offline and adds nothing to startup. Empty
 * outside a build.
 */
export const WHATS_NEW: readonly ReleaseNotes[] = typeof __WHATS_NEW__ !== "undefined" ? __WHATS_NEW__ : [];

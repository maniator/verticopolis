/**
 * The "page not found" page (`src/404.html`, `src/notFoundPage.ts`): a message
 * box on the 1994 desk with the sunrise skyline, on a computer and a phone,
 * for a missing game page and a missing manual page. Its own shard,
 * `not-found`. The page has no engine; it sets `notFoundReady` once drawn.
 *
 * The address is moved to a missing page before the page's script reads it,
 * under /help for the manual's variant (`?at=manual`), which is how a build
 * without the manual's own host serves a missing manual page. The taskbar
 * clock reads a pinned date, so the tray says 9:41 AM on every render.
 * Keep ERASABLE.
 */
import { PHONE, type Scene } from "../screenshot-env.ts";

/** Page-context, before any page script: pin the clock to 9:41 AM, and move
 *  the address to a missing page (under /help for the manual's variant,
 *  `?at=manual`), as a player who followed an old link sees it. */
function stagePage(): void {
  const missing =
    location.search === "?at=manual" ? "/help/rooms/hotell" : "/towers/old-link";
  history.replaceState(null, "", missing);
  const fixed = new Date(2026, 10, 15, 9, 41).valueOf();
  const Real = Date;
  class Pinned extends Real {
    constructor(...args: unknown[]) {
      if (args.length) super(...(args as [number]));
      else super(fixed);
    }
    static now(): number {
      return fixed;
    }
  }
  (window as unknown as { Date: DateConstructor }).Date =
    Pinned as unknown as DateConstructor;
}

const GAME = "404.html";
const MANUAL = "404.html?at=manual";

export const NOT_FOUND_SCENES: Scene[] = [
  {
    id: "not-found",
    outDir: "features",
    route: GAME,
    initScript: stagePage,
    shots: [{ name: "not-found" }],
  },
  {
    id: "not-found-phone",
    outDir: "features",
    route: GAME,
    viewport: PHONE,
    initScript: stagePage,
    shots: [{ name: "not-found-phone" }],
  },
  {
    id: "not-found-help",
    outDir: "features",
    route: MANUAL,
    initScript: stagePage,
    shots: [{ name: "not-found-help" }],
  },
  {
    id: "not-found-help-phone",
    outDir: "features",
    route: MANUAL,
    viewport: PHONE,
    initScript: stagePage,
    shots: [{ name: "not-found-help-phone" }],
  },
];

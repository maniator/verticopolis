import { announceLive } from "./game/liveRegion";

/**
 * The loading line on the boot cover (#1132). Booting on the WASM engine waits
 * for its package before the app exists, and the cover is a plain sky until
 * then. After a short wait (so a cached or fast load never flashes it) the
 * cover says the engine is loading, and a screen reader hears it through
 * `#a11y-live`. After a longer wait it adds that a slow connection or device can take a while (it does not claim a first visit, since an installed game can be slow too).
 * The line goes when the load settles; the cover itself goes with the splash
 * or a boot message (`hideBootCover` in bootstrap.ts). The slow-load note is
 * announced too.
 */
export const ENGINE_LOADING_DELAY_MS = 1200;
export const ENGINE_SLOW_AFTER_MS = 6000;
export const ENGINE_LOADING_TEXT = "Loading the game engine...";
export const ENGINE_SLOW_TEXT = "This can take a while on a slow connection or device.";

/** Start the wait; the returned function ends it and removes anything shown. */
export function showEngineLoading(doc: Document = document): () => void {
  let line: HTMLElement | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const show = () => {
    const cover = doc.getElementById("boot-cover");
    if (!cover) return;
    line = doc.createElement("p");
    line.className = "boot-loading";
    line.textContent = ENGINE_LOADING_TEXT;
    cover.appendChild(line);
    announceLive(ENGINE_LOADING_TEXT);
  };
  const slow = () => {
    if (!line) return;
    line.textContent = `${ENGINE_LOADING_TEXT} ${ENGINE_SLOW_TEXT}`;
    announceLive(ENGINE_SLOW_TEXT);
  };
  timers.push(setTimeout(show, ENGINE_LOADING_DELAY_MS), setTimeout(slow, ENGINE_SLOW_AFTER_MS));
  return () => {
    for (const t of timers) clearTimeout(t);
    line?.remove();
    // The region only held our announcement; leave a later one alone.
    const live = doc.getElementById("a11y-live");
    const clear = () => {
      if (live?.textContent === ENGINE_LOADING_TEXT || live?.textContent === ENGINE_SLOW_TEXT) live.textContent = "";
    };
    if (line) {
      clear();
      // An announcement made just before the stop sets its text a frame
      // later (announceLive); this runs after it.
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(clear);
    }
    line = null;
  };
}

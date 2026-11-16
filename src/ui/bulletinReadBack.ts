import { trackAppActionOnce } from "../analyticsActions";

/**
 * Report, once per page life, that the player scrolled the Bulletin down to
 * read older lines (`app_action` `bulletin_read_back`). The Bulletin opens on
 * its newest line at the top, so a scroll away from the top is the player
 * reading back. New lines arriving while it sits at the top never move it,
 * so they never send this. The count says how many sessions read the log's
 * history, the evidence for whether a separate tower history is worth
 * building. The listener removes itself after the one report. A page
 * without the Bulletin (a test's partial DOM) wires nothing.
 */
export function wireBulletinReadBack(log: HTMLElement | null): void {
  if (!log) return;
  const onScroll = (): void => {
    if (log.scrollTop <= 0) return;
    log.removeEventListener("scroll", onScroll);
    trackAppActionOnce("bulletin_read_back");
  };
  log.addEventListener("scroll", onScroll, { passive: true });
}

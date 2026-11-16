import { trackAppAction } from "../analyticsActions";

/**
 * The title screen's buttons, counted as `app_action` `title_pick` (owner,
 * 2026-11-16: every title-screen button reports what the player pressed). One
 * listener on the document hears a press on any `#splash [data-splash]`
 * button, however many times the title screen is drawn again.
 *
 * Only a real press counts. The menu bar and the desk's Verticopolis menu
 * press the title screen's own New Tower and mute buttons from a script
 * (`ON_TITLE_SCREEN` in menuWiring.ts), and those count as their menu's own
 * events (`menu_pick`, `desk_start`), so a script's click (`isTrusted`
 * false) is not a title pick. Continue reports from `showTitleScreen`
 * instead, since Esc and a click on the title screen's empty background
 * continue too.
 *
 * Each button's own event still follows (`files_open` `open_title`,
 * `help_open`, `mute`, `install_offer` `splash`, `sponsor_click` `splash`),
 * so `title_pick` says what the title screen was used for and never replaces
 * a command's total.
 *
 * Cost: one capture listener for the page life; a press reads one attribute.
 */

/** The `title_pick` detail each title-screen button reports, by its
 *  `data-splash` code. Continue is reported by the title screen itself. */
export const TITLE_PICK = {
  load: "open",
  new: "new",
  help: "help",
  mute: "mute",
  install: "install",
  sponsor: "sponsor",
} as const;

/** The `title_pick` detail Continue reports, from every way it is chosen. */
export const TITLE_PICK_CONTINUE = "continue";

/** The `title_pick` detail of a press on `target`, or null when it is not a
 *  title-screen button this listener counts. */
export function titlePickOf(target: EventTarget | null): string | null {
  const button = target instanceof Element ? target.closest<HTMLElement>("#splash [data-splash]") : null;
  const code = button?.dataset.splash;
  return code && Object.prototype.hasOwnProperty.call(TITLE_PICK, code) ? TITLE_PICK[code as keyof typeof TITLE_PICK] : null;
}

/** Report a press on a title-screen button; a script's click is not one. */
export function reportTitlePick(e: Pick<Event, "isTrusted" | "target">): void {
  if (!e.isTrusted) return;
  const pick = titlePickOf(e.target);
  if (pick) trackAppAction("title_pick", pick);
}

/** Listen for title-screen presses for this page life, once. */
export function wireTitlePicks(doc: Document = document): void {
  if (doc.body.dataset.titlePicks) return;
  doc.body.dataset.titlePicks = "1";
  doc.addEventListener("click", reportTitlePick, true);
}

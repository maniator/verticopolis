import type { GameMode } from "../shared/types";

/**
 * About this game's "Report a problem": GitHub's bug form with what the game
 * already knows filled in. Issue forms take each field's id as a query
 * parameter (the crash screen's link works the same way,
 * src/game/crashReport.ts), so the player starts on the form with the version
 * line, the engine diagnostics, the browser, the platform and the tower's
 * mode already set, and only has to say what went wrong.
 *
 * What the link carries: the version line; the browser, platform and mode as
 * the form's own dropdown choices; and, in the diagnostics field, the text
 * About this game shows (the same text its Copy diagnostics gives). That text
 * includes the full browser string, the time of the report and any engine
 * error text, which can quote a tower name (src/wasmhost/engineDiagnostics.ts).
 * All of it travels to github.com in the link's query string when the player
 * clicks Report a problem. Nothing is filed then: the player sees and can edit
 * every field on GitHub, and only their own submit sends the report.
 */

const NEW_ISSUE = "https://github.com/maniator/verticopolis/issues/new";

/** The bug form's Browser choices (.github/ISSUE_TEMPLATE/bug_report.yml). */
export const BROWSER_OPTION = {
  chrome: "Chrome / Chromium",
  firefox: "Firefox",
  safari: "Safari",
  edge: "Edge",
  other: "Other (note in description)",
} as const;

/** The bug form's Platform choices. */
export const PLATFORM_OPTION = { desktop: "Desktop", mobile: "Mobile / tablet" } as const;

/** The bug form's Game mode choices. */
export const MODE_OPTION = { unsure: "Not sure", classic: "Classic", modern: "Modern" } as const;

/** GitHub refuses very long URLs; diagnostics past this are cut, and the
 *  player can still paste the whole report from About this game. */
export const MAX_DIAGNOSTICS = 2000;

export interface BugReportFacts {
  /** The whole version line, as the title screen shows it. */
  versionLine: string;
  /** About this game's Copy diagnostics text, if the game has one. */
  diagnostics?: string;
  /** `navigator.userAgent`, read to pick the Browser choice. The raw string
   *  reaches the link only inside `diagnostics`, as that text's Browser row. */
  userAgent: string;
  /** Whether the device is a phone or tablet. */
  mobile: boolean;
  /** The live tower's mode, or null when no tower is open (the title screen). */
  mode: GameMode | null;
}

/** The Browser choice for a user agent string. Edge and the iOS browsers name
 *  Chrome or Safari too, so the more specific names are checked first. */
export function browserOption(userAgent: string): string {
  if (/\bEdg(e|A|iOS)?\//.test(userAgent)) return BROWSER_OPTION.edge;
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) return BROWSER_OPTION.firefox;
  if (/\b(Chrome|Chromium|CriOS)\//.test(userAgent)) return BROWSER_OPTION.chrome;
  if (/\bSafari\//.test(userAgent)) return BROWSER_OPTION.safari;
  return BROWSER_OPTION.other;
}

/** Whether `nav` is a phone or tablet. An iPad asks for the desktop site and
 *  reports a Mac, so a Mac with a touch screen counts as a tablet. */
export function isMobileDevice(nav: Pick<Navigator, "userAgent" | "maxTouchPoints">): boolean {
  if (/Mobi|Android|iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1;
}

/** The prefilled bug form URL for these facts. */
export function bugReportHref(facts: BugReportFacts): string {
  const params = new URLSearchParams({
    template: "bug_report.yml",
    version: facts.versionLine,
    browser: browserOption(facts.userAgent),
    platform: facts.mobile ? PLATFORM_OPTION.mobile : PLATFORM_OPTION.desktop,
    mode: facts.mode ? MODE_OPTION[facts.mode] : MODE_OPTION.unsure,
  });
  const diagnostics = facts.diagnostics?.trim();
  if (diagnostics) params.set("diagnostics", diagnostics.length > MAX_DIAGNOSTICS ? `${diagnostics.slice(0, MAX_DIAGNOSTICS)}\n…` : diagnostics);
  return `${NEW_ISSUE}?${params.toString()}`;
}

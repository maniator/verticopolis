import { html, nothing, render, type TemplateResult } from "lit-html";
import { iconTemplate } from "@verticopolis/components/windows/icons";
import { injectPageTelemetry } from "./telemetry";
import { trackAppAction } from "./analyticsActions";
import { BACK_NOTE_ID, backToOpenGame, takeFromGameFlag } from "./ui/fromGame";
import { GAME_HOME, HELP_ORIGIN, helpUrl } from "./helpAddress";

/**
 * Entry for the site's "page not found" page, `404.html`. The host serves it,
 * with a 404 status, for any path the site does not have, so a mistyped or
 * old link (`/help/changlog`, a page from a later build) gets a way on instead
 * of the host's own error page. The manual's own host (help.verticopolis.com)
 * serves the same file, so the page tells the two apart ({@link notFoundSite})
 * and puts the manual first there.
 *
 * It looks like the game on a computer: a message box on the teal 1994 desk,
 * with the sunrise skyline from the startup screen and a taskbar. One tower in
 * the skyline is missing a floor, tagged 404. No game code runs here, and the
 * page is kept out of the offline precache.
 */

/** Which site the missing address belongs to. */
export type NotFoundSite = "game" | "help";

/** What a pick on the page reports in `not_found_pick`: one of its buttons,
 *  the window's close box, or the taskbar's Verticopolis button. */
export type NotFoundPick = "game" | "manual" | "changelog" | "rooms" | "close" | "taskbar";

/** A place the page offers, with the code its pick reports. */
export interface NotFoundLink {
  code: NotFoundPick;
  href: string;
  label: string;
}

/** The game's front page. Its link closes a game-opened tab instead. */
export const GAME_LINK: NotFoundLink = {
  code: "game",
  href: GAME_HOME,
  label: "Play the game",
};

/** The manual's pages a lost visitor most likely meant. */
export const MANUAL_LINKS: readonly NotFoundLink[] = [
  { code: "manual", href: helpUrl("/help"), label: "Player's Manual" },
  {
    code: "changelog",
    href: helpUrl("/help/changelog"),
    label: "Release notes",
  },
  { code: "rooms", href: helpUrl("/help/rooms"), label: "Every room" },
];

/**
 * Whether the missing address is the manual's: on the manual's own host in a
 * production build, or under /help on a build that serves it there.
 */
export function notFoundSite(
  loc: Pick<Location, "origin" | "pathname">,
  helpOrigin: string = HELP_ORIGIN,
): NotFoundSite {
  if (helpOrigin && loc.origin === helpOrigin) return "help";
  return /^\/help(?:\/|$)/.test(loc.pathname) ? "help" : "game";
}

/** The buttons in the order the page shows them: the site the visitor was on
 *  comes first, and its first button is the default. */
export function notFoundLinks(site: NotFoundSite): NotFoundLink[] {
  const [manual, ...rest] = MANUAL_LINKS;
  return site === "help" ? [manual, GAME_LINK, ...rest] : [GAME_LINK, manual, ...rest];
}

/** What the page shows: the missing `path` (rendered as text, which lit
 *  escapes), which site it is on, whether the game opened this tab, and the
 *  taskbar clock's text. */
export interface NotFoundView {
  path: string;
  site?: NotFoundSite;
  fromGame?: boolean;
  clock?: string;
}

/** `MouseEvent.button` for the middle (wheel) button, the one that opens a
 *  link in a new tab; the right button's `auxclick` opens a menu instead. */
export const MIDDLE_BUTTON = 1;

/** The taskbar clock's text for `now`, as the 1995 tray showed it: "4:34 PM". */
export function trayClock(now: Date): string {
  const h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** How long from `now` until the clock's minute turns over, a little after
 *  it so the redraw reads the new minute. */
export function msToNextMinute(now: Date): number {
  return (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
}

/** The Windows 95 warning icon of the message box, drawn on a 32 by 32 grid. */
const WARNING_ICON = html`<svg
  class="nf-icon"
  viewBox="0 0 32 32"
  width="32"
  height="32"
  aria-hidden="true"
>
  <path
    d="M15 2h2v2h1v3h1v3h1v3h1v3h1v3h1v3h1v3h1v3h1v3H5v-3h1v-3h1v-3h1v-3h1v-3h1v-3h1v-3h1V7h1V4h1z"
    fill="#000"
  />
  <path
    d="M15.5 5h1v3h1v3h1v3h1v3h1v3h1v3h1v3h1v2H7v-2h1v-3h1v-3h1v-3h1v-3h1v-3h1V8h1V5z"
    fill="#ffd400"
  />
  <path d="M15 10h2v9h-2zM15 21h2v2h-2z" fill="#000" />
</svg>`;

/** The sunrise skyline from the startup screen, with one tower missing a floor. */
const SKYLINE = html`<div class="nf-sky" aria-hidden="true">
  <span class="nf-star" style="left:12%;top:18%"></span>
  <span class="nf-star" style="left:34%;top:9%"></span>
  <span class="nf-star" style="left:71%;top:14%"></span>
  <span class="nf-star" style="left:88%;top:30%"></span>
  <span class="nf-sun"></span>
  <span class="nf-bldg" style="left:3%;width:15%;height:52%;--lit:0.35"></span>
  <span class="nf-bldg" style="left:20%;width:11%;height:70%;--lit:0.6"></span>
  <span class="nf-tower">
    <span class="nf-tower-top"></span>
    <span class="nf-gap"><span class="nf-tag">404</span></span>
    <span class="nf-tower-base"></span>
  </span>
  <span class="nf-bldg" style="left:63%;width:13%;height:62%;--lit:0.45"></span>
  <span class="nf-bldg" style="left:80%;width:17%;height:44%;--lit:0.3"></span>
</div>`;

/** The page: a message box on the desk, and the taskbar. Pure, so the test
 *  renders it directly. */
export function notFoundPageTemplate(view: NotFoundView): TemplateResult {
  const { path, site = "game", fromGame = false, clock = "" } = view;
  const links = notFoundLinks(site);
  const title = site === "help" ? "Verticopolis Player's Manual" : "Verticopolis";
  const heading = site === "help" ? "Page 404 isn't in the manual." : "Floor 404 hasn't been built yet.";
  // Every pick reports where it went: a click, keyboard Enter, or a
  // middle-click that opens it in a new tab. A way back to the game closes a
  // game-opened tab instead, as the manual's Back to game does.
  const toGame = (code: NotFoundPick) => (e: MouseEvent) => {
    trackAppAction("not_found_pick", code);
    if (fromGame) backToOpenGame(e);
  };
  const noted = (code: NotFoundPick) => () => trackAppAction("not_found_pick", code);
  const middle = (code: NotFoundPick) => (e: MouseEvent) => {
    if (e.button === MIDDLE_BUTTON) trackAppAction("not_found_pick", code);
  };
  const button = (l: NotFoundLink, primary: boolean): TemplateResult =>
    l.code === "game"
      ? html`<a
          class="btn ${primary ? "primary" : ""}"
          href=${l.href}
          data-act="back-to-game"
          @click=${toGame(l.code)}
          @auxclick=${middle(l.code)}
          >${l.label}</a
        >`
      : html`<a
          class="btn ${primary ? "primary" : ""}"
          href=${l.href}
          @click=${noted(l.code)}
          @auxclick=${middle(l.code)}
          >${l.label}</a
        >`;
  return html`
    <div class="nf-desk">
      <main class="nf-win win" aria-labelledby="nf-heading">
        <div class="win-title">
          <span class="nf-title-icon" aria-hidden="true"
            >${iconTemplate("brand", { size: 16 })}</span
          >
          <span class="nf-title-text">${title}</span>
          <a
            class="btn xs nf-close"
            href=${GAME_HOME}
            data-act="back-to-game"
            aria-label="Close and go to the game"
            @click=${toGame("close")}
            @auxclick=${middle("close")}
            >✕</a
          >
        </div>
        ${SKYLINE}
        <div class="nf-body">
          ${
            fromGame
              ? html`<p
                id=${BACK_NOTE_ID}
                class="page-note"
                tabindex="-1"
                hidden
              ></p>`
              : nothing
          }
          <div class="nf-msg">
            ${WARNING_ICON}
            <div>
              <h1 id="nf-heading">${heading}</h1>
              <p>There is no page at <code>${path}</code>.</p>
              <p>The link may be mistyped, or the page may have moved.</p>
            </div>
          </div>
          <nav class="nf-buttons" aria-label="Pages">
            ${links.map((l, i) => button(l, i === 0))}
          </nav>
        </div>
      </main>
    </div>
    <footer class="nf-taskbar">
      <a
        class="nf-start"
        href=${GAME_HOME}
        data-act="back-to-game"
        @click=${toGame("taskbar")}
        @auxclick=${middle("taskbar")}
        >${iconTemplate("brand", { size: 16 })}<span>Verticopolis</span></a
      >
      <span class="nf-task" aria-hidden="true"
        >${iconTemplate("warning", { size: 14 })}<span
          >Page not found</span
        ></span
      >
      <span class="nf-tray"><time>${clock}</time></span>
    </footer>
  `;
}

function main(): void {
  const root = document.getElementById("app");
  if (!root) return;
  injectPageTelemetry();
  const site = notFoundSite(location);
  trackAppAction("not_found_view", site);
  const view: NotFoundView = {
    path: location.pathname,
    site,
    fromGame: takeFromGameFlag(location, history),
  };
  const fallback = [...root.childNodes];
  const draw = (): void => {
    render(notFoundPageTemplate({ ...view, clock: trayClock(new Date()) }), root);
  };
  draw();
  for (const node of fallback) node.remove();
  // The tray clock moves on the minute, as the desk's does.
  const tick = (): void => {
    draw();
    setTimeout(tick, msToNextMinute(new Date()));
  };
  setTimeout(tick, msToNextMinute(new Date()));
  (window as unknown as { notFoundReady?: boolean }).notFoundReady = true;
}

main();

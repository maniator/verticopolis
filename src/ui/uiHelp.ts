import type { TemplateResult } from "lit-html";
import type { UI } from "./UI";
import { HelpPause, PAUSED_FOR_HELP } from "./helpPause";
import { aboutTemplate } from "./templates/about";
import { compareModalTemplate, towerRulesModalTemplate } from "./templates/compare";
import { fromGameHref, type GameHelpSource } from "./fromGame";
import { isSplashUp } from "../game/interactionState";
import { isInstalledStandalone } from "./standalone";
import { trackAppAction } from "../analytics";
import { engineSuffix, versionLine } from "@verticopolis/components/host/engineLabel";
import { bugReportHref, isMobileDevice } from "./bugReport";
import { gameDiagnostics } from "./aboutDiagnostics";
import type { DiagnosticsReport } from "@verticopolis/components/host/engineDiagnostics";
import { copyText } from "./copyText";
import { announceLive } from "../game/liveRegion";
import { isGameMode } from "@verticopolis/components/shared/types";
import { HELP_ADDRESS, helpUrl } from "../helpAddress";
import { HELP_TOPIC_PATH, isHelpTopic } from "./helpTopics";
import type { HelpTopicSurface } from "./templates/helpTopicLink";
import { hostHelpBar } from "./helpBarHost";

/**
 * The in-game Help: About this game (the game panel's "About…") and the
 * Classic vs Modern comparison the Tower panel's mode badge opens. The guide
 * (the Help button) is the Help site, opened in a new tab; the release notes
 * and the privacy page live there too. About this game also carries Report a
 * problem, GitHub's bug form prefilled by the game. Every one of them
 * pauses the tower through one {@link HelpPause} per UI, and every close route
 * (the buttons, Esc, the backdrop, the title-bar ✕, another dialog taking the
 * screen, or any other closeModal) ends that pause exactly once. A link that
 * opens a Help site page in a new tab closes the dialog and keeps the pause
 * until the player is back on the game tab.
 */

const pauses = new WeakMap<UI, HelpPause>();

/** The Pause button's own label, put back when Help lets go of it. */
const PAUSE_LABEL = "Pause";

/** The Help pause for `ui`, made on first use. */
export function helpPause(ui: UI): HelpPause {
  let pause = pauses.get(ui);
  if (!pause) {
    pause = new HelpPause({
      getSpeed: () => ui.cb.getSpeed(),
      setSpeed: (s) => ui.cb.onSpeed(s),
      announce: (text) => announceHelp(ui, text),
      markToolbar: (held) => {
        const button = document.querySelector<HTMLElement>('#speed button[data-speed="0"]');
        if (!button) return;
        const label = held ? PAUSED_FOR_HELP : PAUSE_LABEL;
        button.title = label;
        button.setAttribute("aria-label", label);
      },
    });
    pauses.set(ui, pause);
    watchPlayerSpeed(pause);
  }
  return pause;
}

/** The attribute that marks a Help dialog's own status line. */
const HELP_STATUS_ATTR = "data-help-status";

/**
 * Say `text` to a screen reader. While a dialog is open everything outside it
 * is inert, so the page's live region would never be read: the line goes to
 * the open Help dialog's own status line instead. Once the dialog has closed
 * (the "Back at ..." line), the page's live region reads it.
 */
function announceHelp(ui: UI, text: string): void {
  const dialog = ui.el.modal as HTMLDialogElement;
  const status = dialog.open ? dialog.querySelector<HTMLElement>(`[${HELP_STATUS_ATTR}]`) : null;
  if (!status) {
    announceLive(text);
    return;
  }
  // Set on the next frame, so a status line that was only just added is in
  // the accessibility tree before its text changes.
  status.textContent = "";
  const set = () => {
    status.textContent = text;
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(set);
  else set();
}

/** An empty, visually hidden status line just above a Help dialog's buttons.
 *  The buttons stay the box's last child, which the sticky footer's cover
 *  under them depends on (src/styles/game/dialogs.css). */
function addStatusLine(box: HTMLElement): void {
  const p = document.createElement("p");
  p.className = "visually-hidden";
  p.setAttribute("role", "status");
  p.setAttribute(HELP_STATUS_ATTR, "");
  box.insertBefore(p, box.querySelector(":scope > .modal-actions"));
}

/** The game marks the active speed button; when the Pause button stops being
 *  the active one while Help holds the pause, the player chose a speed (a
 *  click or a speed key), so Help lets go ({@link HelpPause.release}). One
 *  observer on one attribute of one button. */
function watchPlayerSpeed(pause: HelpPause): void {
  const button = document.querySelector<HTMLElement>('#speed button[data-speed="0"]');
  if (!button || typeof MutationObserver === "undefined") return;
  new MutationObserver(() => {
    if (pause.held && !button.classList.contains("active")) pause.release();
  }).observe(button, { attributes: true, attributeFilter: ["class"] });
}

interface HelpDialogOpts {
  /** Whether another dialog may take the screen from this one (default true).
   *  The comparison keeps the old rule: it is not displaced. */
  displaceable?: boolean;
  /** Extra `data-act` handlers; each gets the dialog's `finish`. */
  actions?: Record<string, (finish: () => void) => void>;
}

/**
 * Open a Help dialog with the pause held. The dialog opens FIRST and the pause
 * starts after, so a render that throws never leaves the tower paused with no
 * dialog to close. Returns the box and its `finish` (close and end the pause).
 */
function openHelpDialog(ui: UI, result: TemplateResult, opts: HelpDialogOpts = {}): { box: HTMLElement; finish: () => void } {
  const pause = helpPause(ui);
  const dialog = ui.el.modal as HTMLDialogElement;
  const replacing = dialog.open;
  let box!: HTMLElement;
  pause.swap(() => {
    box = ui.openModalTemplate(result, { displaceable: opts.displaceable ?? true, onDisplaced: () => pause.displaced() });
  });
  addStatusLine(box);
  // A dialog that was already open is not shown again, so the browser never
  // runs `autofocus` and focus would fall to the page with the old content.
  if (replacing) box.querySelector<HTMLElement>("[autofocus]")?.focus();
  pause.begin();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    ui.closeModal();
    pause.end();
  };
  const handlers: Record<string, () => void> = { close: finish };
  for (const [act, fn] of Object.entries(opts.actions ?? {})) handlers[act] = () => fn(finish);
  ui.wireActions(box, handlers);
  dialog.onclick = (e) => {
    if (e.target === dialog) finish();
  };
  dialog.oncancel = () => finish();
  // Any other route that closes the shared dialog (a game action calling
  // closeModal) still ends the pause.
  dialog.addEventListener("close", () => pause.closed(), { once: true });
  return { box, finish };
}

/** A link that opens a page in a new tab: let the browser follow the
 *  link, close the dialog, and hold the pause until the player comes back.
 *  A Ctrl or Cmd click opens the tab in the background and the player stays
 *  here, so Help stays open and its own close restores the speed. */
function leaveForTab(ui: UI, e: MouseEvent): void {
  if (e.ctrlKey || e.metaKey) return;
  const pause = helpPause(ui);
  pause.untilReturn({ win: window, doc: document });
  ui.closeModal();
}

/** The guide: the Help site's front page in a new tab, from the Help menu's
 *  Player's Manual (`game_menu`), the title screen's How to Play (`title`),
 *  F1 with no room card up (`help_key`) and the tooling handle `ui.showHelp(source)`. `help_open` and the page's
 *  landing both report `source` (#2037). */
export function showHelp(ui: UI, source: GameHelpSource): void {
  trackAppAction("help_open", source);
  // The manual is online only (the service worker leaves /help to the
  // network), so offline say so rather than open a tab that cannot load.
  if (!navigator.onLine) {
    ui.sayVisibly(`The manual needs an internet connection. It is at ${HELP_ADDRESS}.`);
    return;
  }
  openPageInTab(ui, "/help/", source, () => ui.sayVisibly(`The guide could not open. It is at ${HELP_ADDRESS}.`));
}

/**
 * Open a Help site page in a new tab and hold the tower's pause until the
 * player is back on the game tab. A Ctrl or Cmd click (`e`) opens it in the
 * background and the tower keeps running. `blocked` runs when the browser
 * refuses the new tab (a pop-up blocker), so the player is never left with
 * nothing. Returns whether the tab opened.
 */
function openPageInTab(ui: UI, href: string, source: GameHelpSource, blocked: () => void, e?: MouseEvent): boolean {
  const background = !!e && (e.ctrlKey || e.metaKey);
  const tab = window.open(fromGameHref(helpUrl(href), source), "_blank");
  if (!tab) {
    blocked();
    return false;
  }
  try {
    tab.opener = null; // the page never reaches back into the game
  } catch {
    // Read-only in some hosts; the page never uses it either way.
  }
  if (background) return true;
  const pause = helpPause(ui);
  pause.begin();
  pause.untilReturn({ win: window, doc: document });
  return true;
}

/** A Help link's surface, read from where it sits: the room card (the hover
 *  card or the phone's editor fold-in) or Tower Statistics. */
function topicSurface(link: Element): HelpTopicSurface {
  return link.closest("#inspector, #editor") ? "inspector" : "stats";
}

/**
 * The problem lines' Help links (#2036): the room card's and Tower
 * Statistics'. One listener on the page catches a press on any of them and
 * opens its page the way the Help menu does, in a new tab with the tower
 * paused until the player is back; offline it says where the page is
 * instead. A middle-click follows the link's own href.
 *
 * The desktop hover card lets the pointer through, so its links cannot be
 * pressed there: F1 opens the first one on the card showing, and with no card
 * up it opens the guide, as F1 does in a Windows program. With a dialog open,
 * F1 is left alone.
 *
 * Cost: two idle listeners; nothing runs until a click or a key.
 */
export function wireHelpTopics(ui: UI): void {
  // One pair of listeners for the page, whichever UI asked last (the game
  // makes one; a test makes one per case), so a press never opens two tabs.
  topicUi = ui;
  if (topicsWired) return;
  topicsWired = true;
  document.addEventListener("click", (e) => {
    const link = (e.target as Element | null)?.closest?.<HTMLAnchorElement>("a[data-help-topic]");
    if (link && topicUi) openHelpTopic(topicUi, link, e);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key !== "F1" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !topicUi) return;
    if ((topicUi.el.modal as HTMLDialogElement).open) return;
    e.preventDefault();
    const card = topicUi.el.inspector;
    const link = card.classList.contains("hidden") ? null : card.querySelector<HTMLAnchorElement>("a[data-help-topic]");
    if (link) openHelpTopic(topicUi, link);
    else showHelp(topicUi, "help_key");
  });
}

/**
 * The game's side of the Help bar on a page it opened (#2035,
 * src/ui/helpBarHost.ts): the tower's state for the bar's mini HUD, and its
 * "Keep my tower running" and "Pause it" buttons, which work through this
 * UI's Help pause. One host for the page, serving whichever UI asked last,
 * as {@link wireHelpTopics} does.
 */
export function wireHelpBar(ui: UI): void {
  barUi = ui;
  if (barHosted) return;
  barHosted = true;
  const pause = () => helpPause(barUi!);
  hostHelpBar({
    active: () => barUi !== null && !isSplashUp(),
    getSpeed: () => barUi!.cb.getSpeed(),
    setSpeed: (speed) => barUi!.cb.onSpeed(speed),
    heldForHelp: () => pause().held,
    endHelpPause: () => pause().end(),
    pauseForHelp: () => {
      pause().begin();
      pause().untilReturn({ win: window, doc: document });
    },
    visible: () => document.visibilityState === "visible",
    hud: () => {
      const text = (el: HTMLElement) => (el.textContent ?? "").trim();
      const el = barUi!.el;
      return { date: text(el.date), time: text(el.time), money: text(el.money), population: text(el.pop), stars: text(el.star) };
    },
  });
}

let barUi: UI | null = null;
let barHosted = false;

/** The UI the page's Help link listeners serve ({@link wireHelpTopics}). */
let topicUi: UI | null = null;
let topicsWired = false;

/** Open a Help link's page, counted as `help_topic_open` with
 *  `surface_topic` (inspector_parking, stats_recycling). */
function openHelpTopic(ui: UI, link: HTMLAnchorElement, e?: MouseEvent): void {
  const topic = link.dataset.helpTopic;
  if (!isHelpTopic(topic)) return;
  e?.preventDefault();
  const path = HELP_TOPIC_PATH[topic];
  if (!navigator.onLine) {
    ui.sayVisibly(`The manual needs an internet connection. It is at ${HELP_ADDRESS}.`);
    return;
  }
  const surface = topicSurface(link);
  trackAppAction("help_topic_open", `${surface}_${topic}`);
  openPageInTab(ui, path, surface, () => ui.sayVisibly(`The manual could not open. It is at ${HELP_ADDRESS}.`), e);
}

/** About this game, from the game panel's "About…": the version, the engine
 *  diagnostics with Copy, the privacy link and Replay Getting Started. */
export function showAbout(ui: UI): void {
  trackAppAction("about_open");
  const onSplash = isSplashUp();
  const diagnostics = gameDiagnostics();
  let finishAbout = () => {};
  const { box, finish } = openHelpDialog(
    ui,
    aboutTemplate(onSplash, appVersion(), { onReplay: () => replay(ui, finishAbout) }, engineSuffix(), diagnostics, reportHref(ui, onSplash, diagnostics)),
    { actions: { "copy-diagnostics": () => copyDiagnostics(box, diagnostics) } },
  );
  finishAbout = finish;
  wirePrivacyLink(ui, box);
  wireReportLink(ui, box);
}

/** GitHub's bug form, prefilled with what About this game shows as it opens. */
function reportHref(ui: UI, onSplash: boolean, diagnostics: DiagnosticsReport): string {
  return bugReportHref({
    versionLine: versionLine(appVersion()),
    diagnostics: diagnostics.text,
    userAgent: navigator.userAgent,
    mobile: isMobileDevice(navigator),
    mode: onSplash ? null : ui.cb.getMode(),
  });
}

/** Report a problem opens GitHub in a new tab and holds the pause until the
 *  player is back, like the privacy link; offline it says so instead. */
function wireReportLink(ui: UI, box: HTMLElement): void {
  const link = box.querySelector<HTMLAnchorElement>('a[data-act="report"]');
  const status = box.querySelector<HTMLElement>(".help-links-status");
  link?.addEventListener("click", (e) => {
    if (!navigator.onLine) {
      e.preventDefault();
      if (status) status.textContent = "Reporting a problem needs an internet connection. Copy diagnostics now and report it once you are back online.";
      return;
    }
    leaveForTab(ui, e);
  });
}

/** The privacy link opens the Help site's page in a new tab and holds the
 *  pause until the player is back ({@link leaveForTab}). The Help site is
 *  online only (the service worker leaves /help to the network), so offline
 *  the link stays put and says where the page is instead. */
function wirePrivacyLink(ui: UI, box: HTMLElement): void {
  const link = box.querySelector<HTMLAnchorElement>('a[data-act="privacy"]');
  const status = box.querySelector<HTMLElement>(".help-links-status");
  link?.addEventListener("click", (e) => {
    if (!navigator.onLine) {
      e.preventDefault();
      if (status) status.textContent = `The privacy page needs an internet connection. It is at ${HELP_ADDRESS}/privacy.`;
      return;
    }
    leaveForTab(ui, e);
  });
}

/**
 * The in-game Classic vs Modern comparison: the mode badge in the installed
 * app, and the guide's "Open the full help page" there. Not displaceable, as
 * before: a dialog that owes a restore on close keeps the screen.
 */
export function showCompare(ui: UI): void {
  trackAppAction("compare_open");
  openHelpDialog(ui, compareModalTemplate(), { displaceable: false });
}

/** Tower > This Tower's Rules: the comparison cut to the column this tower
 *  plays by, read from the mode badge the status pump keeps current
 *  (`uiStatus.setMode`). */
export function showTowerRules(ui: UI): void {
  const mode = ui.el.modeBadge.dataset.mode;
  // Before the first status pass names the rules, the whole comparison.
  if (!isGameMode(mode)) return showCompare(ui);
  trackAppAction("compare_open");
  openHelpDialog(ui, towerRulesModalTemplate(ui.el.towerName.value, mode), { displaceable: false });
}

/**
 * The Tower panel's mode badge. In a browser tab it opens the Help site's
 * Classic and Modern page in a new tab and holds the pause until the player
 * is back; in the installed app, or when the tab is blocked, it opens the
 * in-game comparison.
 */
export function showModeHelp(ui: UI, e?: MouseEvent): void {
  if (isInstalledStandalone()) {
    showCompare(ui);
    return;
  }
  if (openPageInTab(ui, "/help/classic-vs-modern/", "mode_badge", () => showCompare(ui), e)) trackAppAction("compare_open");
}

/** Close the dialog and end the pause, THEN replay, so Getting Started never
 *  starts on a paused tower. */
function replay(ui: UI, finish: () => void): void {
  finish();
  ui.cb.onReplayOnboarding();
}

function copyDiagnostics(box: HTMLElement, diagnostics: DiagnosticsReport): void {
  const status = box.querySelector<HTMLElement>(".help-diagnostics-status");
  void copyText(diagnostics.text, navigator, document, box.closest("dialog") ?? undefined).then((ok) => {
    if (status) status.textContent = ok ? "Copied." : "Could not copy. Select the lines above and copy them by hand.";
  });
}

function appVersion(): string {
  return typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
}

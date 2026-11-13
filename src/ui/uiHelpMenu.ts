import type { TemplateResult } from "lit-html";
import type { UI } from "./UI";
import { HelpPause, PAUSED_FOR_HELP } from "./helpPause";
import { aboutTemplate } from "./templates/about";
import { compareModalTemplate } from "./templates/compare";
import { fromGameHref } from "./fromGame";
import { isSplashUp } from "../game/interactionState";
import { isInstalledStandalone } from "./standalone";
import { trackAppAction } from "../analytics";
import { engineSuffix, versionLine } from "../wasmhost/engineLabel";
import { bugReportHref, isMobileDevice } from "./bugReport";
import { liveDiagnostics } from "../wasmhost/engineDiagnosticsLive";
import type { DiagnosticsReport } from "../wasmhost/engineDiagnostics";
import { copyText } from "./copyText";
import { announceLive } from "../game/liveRegion";

/**
 * The in-game Help: About this game (the game panel's "About…") and the
 * Classic vs Modern comparison the Tower panel's mode badge opens. The guide
 * (the Help button) is the Help site, opened in a new tab; the release notes,
 * Report a problem and the privacy page live there too. Every one of them
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

/** The guide: the Help site's front page in a new tab, from the game panel's
 *  Help button, the title screen and the tooling handle `ui.showHelp()`. */
export function showHelp(ui: UI): void {
  trackAppAction("help_open");
  // The manual is online only (the service worker leaves /help to the
  // network), so offline say so rather than open a tab that cannot load.
  if (!navigator.onLine) {
    ui.sayVisibly("The manual needs an internet connection. It is at verticopolis.com/help.");
    return;
  }
  openPageInTab(ui, "/help/", () => ui.sayVisibly("The guide could not open. It is at verticopolis.com/help."));
}

/**
 * Open a Help site page in a new tab and hold the tower's pause until the
 * player is back on the game tab. A Ctrl or Cmd click (`e`) opens it in the
 * background and the tower keeps running. `blocked` runs when the browser
 * refuses the new tab (a pop-up blocker), so the player is never left with
 * nothing. Returns whether the tab opened.
 */
function openPageInTab(ui: UI, href: string, blocked: () => void, e?: MouseEvent): boolean {
  const background = !!e && (e.ctrlKey || e.metaKey);
  const tab = window.open(fromGameHref(href), "_blank");
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

/** About this game, from the game panel's "About…": the version, the engine
 *  diagnostics with Copy, the privacy link and Replay Getting Started. */
export function showAbout(ui: UI): void {
  trackAppAction("about_open");
  const onSplash = isSplashUp();
  const diagnostics = liveDiagnostics();
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
  const status = box.querySelector<HTMLElement>(".help-privacy-status");
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
  const status = box.querySelector<HTMLElement>(".help-privacy-status");
  link?.addEventListener("click", (e) => {
    if (!navigator.onLine) {
      e.preventDefault();
      if (status) status.textContent = "The privacy page needs an internet connection. It is at verticopolis.com/help/privacy.";
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
  if (openPageInTab(ui, "/help/classic-vs-modern/", () => showCompare(ui), e)) trackAppAction("compare_open");
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

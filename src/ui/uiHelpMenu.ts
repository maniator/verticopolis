import type { TemplateResult } from "lit-html";
import type { UI } from "./UI";
import { HelpPause, PAUSED_FOR_HELP } from "./helpPause";
import { helpTemplate } from "./templates/help";
import { aboutTemplate, helpMenuTemplate, whatsNewTemplate } from "./templates/helpMenu";
import { compareModalTemplate } from "./templates/compare";
import { fromGameHref } from "./fromGame";
import { isSplashUp } from "../game/interactionState";
import { isInstalledStandalone } from "./standalone";
import { trackAppAction } from "../analytics";
import { engineSuffix } from "../wasmhost/engineLabel";
import { liveDiagnostics } from "../wasmhost/engineDiagnosticsLive";
import type { DiagnosticsReport } from "../wasmhost/engineDiagnostics";
import { copyText } from "./copyText";
import { announceLive } from "../game/liveRegion";

/**
 * The in-game Help: the Help menu the toolbar's "Help…" opens, the guide
 * (How to play), What's new, About this game, and the Classic vs Modern
 * comparison the Tower panel's mode badge opens. Every one of them pauses the
 * tower through one {@link HelpPause} per UI, and every close route (the
 * buttons, Esc, the backdrop, the title-bar ✕, another dialog taking the
 * screen, or any other closeModal) ends that pause exactly once. Moving from
 * the menu to one of its windows keeps the one pause. A menu row that opens a
 * page in a new tab closes the menu and keeps the pause until the player is
 * back on the game tab.
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

/** A row or link that opens a page in a new tab: let the browser follow the
 *  link, close the dialog, and hold the pause until the player comes back.
 *  A Ctrl or Cmd click opens the tab in the background and the player stays
 *  here, so Help stays open and its own close restores the speed. */
function leaveForTab(ui: UI, e: MouseEvent): void {
  if (e.ctrlKey || e.metaKey) return;
  const pause = helpPause(ui);
  pause.untilReturn({ win: window, doc: document });
  ui.closeModal();
}

/** Wire every new-tab link in `box` to {@link leaveForTab}. */
function wireNewTabLinks(ui: UI, box: HTMLElement): void {
  for (const a of box.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]')) {
    a.addEventListener("click", (e) => leaveForTab(ui, e));
  }
}

/** The toolbar's "Help…": the Help menu. */
export function showHelpMenu(ui: UI): void {
  trackAppAction("help_open");
  const inBrowserTab = !isInstalledStandalone();
  const { box } = openHelpDialog(
    ui,
    helpMenuTemplate(inBrowserTab),
    {
      actions: {
        // In a browser tab How to play is a link (wired below); the button
        // only exists in the installed app.
        ...(inBrowserTab ? {} : { "how-to-play": () => openGuide(ui) }),
        "whats-new": () => openWhatsNew(ui, box),
        about: () => showAbout(ui),
      },
    },
  );
  wireNewTabLinks(ui, box);
}

/** The in-game guide (How to play). Reached from the title screen, from the
 *  installed app's Help menu, and by the tooling handle `ui.showHelp()`. */
export function showHelp(ui: UI): void {
  trackAppAction("help_open");
  openGuide(ui);
}

function openGuide(ui: UI): void {
  // Replaying the intro is meaningless while the title screen is still up, so
  // the button is disabled there (and onReplayOnboarding no-ops behind it).
  const onSplash = isSplashUp();
  const diagnostics = liveDiagnostics();
  let finishGuide = () => {};
  const { box, finish } = openHelpDialog(
    ui,
    helpTemplate(onSplash, appVersion(), { onReplay: () => replay(ui, finishGuide) }, engineSuffix(), diagnostics),
    { actions: { "copy-diagnostics": () => copyDiagnostics(box, diagnostics) } },
  );
  finishGuide = finish;
  // "Open the full help page" is a real link to /help/classic-vs-modern/ in a
  // new tab. From the installed app a new tab drops to the system browser and
  // loses the session, so there it opens the in-app comparison instead.
  const fullPage = box.querySelector<HTMLAnchorElement>('a[data-act="open-help"]');
  if (fullPage) fullPage.href = fromGameHref(fullPage.getAttribute("href") ?? "/help");
  fullPage?.addEventListener("click", (e) => {
    if (isInstalledStandalone()) {
      e.preventDefault();
      showCompare(ui);
      return;
    }
    leaveForTab(ui, e);
  });
}

/** What's new: this build's notes, offline. The notes are a chunk of their
 *  own, loaded on demand; the menu stays up until they arrive. */
function openWhatsNew(ui: UI, menu: HTMLElement): void {
  void import("../whatsNewData").then(
    ({ WHATS_NEW }) => {
      if (!menu.isConnected) return; // the player closed the menu meanwhile
      const { box } = openHelpDialog(ui, whatsNewTemplate(WHATS_NEW, !isInstalledStandalone()));
      wireNewTabLinks(ui, box);
    },
    () => {
      if (menu.isConnected) ui.sayVisibly("What's new could not load. Try again in a moment.");
    },
  );
}

/** About this game: the version, the engine diagnostics with Copy, privacy,
 *  and Replay Getting Started. */
export function showAbout(ui: UI): void {
  const onSplash = isSplashUp();
  const diagnostics = liveDiagnostics();
  let finishAbout = () => {};
  const { box, finish } = openHelpDialog(
    ui,
    aboutTemplate(onSplash, appVersion(), { onReplay: () => replay(ui, finishAbout) }, engineSuffix(), diagnostics),
    { actions: { "copy-diagnostics": () => copyDiagnostics(box, diagnostics) } },
  );
  finishAbout = finish;
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
 * The Tower panel's mode badge. In a browser tab it opens the guide's
 * Classic vs Modern section in a new tab and holds the pause until the player
 * is back; in the installed app it opens the in-game comparison.
 */
export function showModeHelp(ui: UI, e?: MouseEvent): void {
  if (isInstalledStandalone()) {
    showCompare(ui);
    return;
  }
  // A Ctrl or Cmd click opens the page in a background tab and the player
  // stays here, so the tower keeps running.
  const background = !!e && (e.ctrlKey || e.metaKey);
  const tab = window.open(fromGameHref("/help/classic-vs-modern/"), "_blank");
  if (!tab) {
    // A blocked pop-up: show the same comparison in the game instead.
    showCompare(ui);
    return;
  }
  try {
    tab.opener = null; // the page never reaches back into the game
  } catch {
    // Read-only in some hosts; the page never uses it either way.
  }
  trackAppAction("compare_open");
  if (background) return;
  const pause = helpPause(ui);
  pause.begin();
  pause.untilReturn({ win: window, doc: document });
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

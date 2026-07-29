import type { UI } from "./UI";
import { confirmTemplate, installHelpTemplate, type InstallHelpVariant } from "./templates/confirm";
import { eventChoiceTemplate } from "./templates/eventChoice";
import { updatePromptTemplate } from "./templates/updatePrompt";
import { settingsTemplate } from "./templates/settings";
import { helpTemplate } from "./templates/help";
import { compareModalTemplate } from "./templates/compare";
import { savesTemplate } from "./templates/saves";
import { newTowerTemplate } from "./templates/newTower";
import { exportConfirmTemplate, importReportTemplate, exportReportTemplate } from "./templates/reports";
import { statsModalTemplate } from "./templates/stats";
import { congratsTemplate } from "./templates/congrats";
import type { TemplateResult } from "lit-html";
import type { GameMode } from "../engine/types";
import type { CalendarKind } from "../engine/calendar";
import type { SlotInfo } from "../storage/SaveGame";
import type { ImportReport } from "../storage/tdtImport";
import type { ExportReport } from "../storage/tdtExport";
import type { UpdateInfo } from "../pwa";
import { routeExternalInWrapper } from "./externalLink";
import { isInstalledStandalone } from "./standalone";
import { getPlatform } from "../platform";
import { trackAppAction } from "../analytics";

/**
 * Dialog and modal controllers for {@link UI}, as friend functions taking the
 * UI instance. Each one builds its lit template body from `./templates/`, opens it
 * through the UI's shared modal primitives, and wires the interactive handlers.
 * Extracted from `UI.ts`; the class keeps thin delegations so `main.ts` and the
 * rest of the app keep calling `ui.showHelp()` etc. unchanged.
 */

// The batch-pricing controllers live in their own module; re-exported so
// `dialogs.showBatchPricingDialog` callers (UI.ts) are unchanged.
export { showBatchPricingDialog, type BatchPricingDialogCtx, type BatchPricingDialogCb } from "./uiBatchPricing";

// The elevator Schedule dialog controller likewise lives in its own module.
export { showElevatorScheduleDialog, type ScheduleDialogCtx } from "./uiElevatorSchedule";

// The title-screen tower picker likewise lives in its own module.
export { showTowerPicker, type TowerPickerCtx } from "./uiTowerPicker";

// The file-picker entry point lives in its own module so the tower picker can
// reach it without importing this one (which re-exports the tower picker, and
// would therefore form a cycle). Re-exported so existing callers are unchanged.
export { openImport } from "./uiImport";
import { openImport } from "./uiImport";

export function showStats(ui: UI, body: TemplateResult, handlers: Record<string, () => void> = {}): void {
  const box = ui.openModalTemplate(statsModalTemplate(body), { displaceable: true });
  ui.wireActions(box, handlers);
}

/** Saves manager: auto-save + numbered slots, plus export/import. */
export function showSaves(ui: UI, slots: SlotInfo[]): void {
  const box = ui.openModalTemplate(savesTemplate(slots), { displaceable: true });
  box.querySelectorAll<HTMLElement>("[data-save]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.cb.onSaveSlot(Number(b.dataset.save));
      ui.cb.onShowSaves();
    }),
  );
  box.querySelectorAll<HTMLElement>("[data-load]").forEach((b) =>
    b.addEventListener("click", () => {
      const v = b.dataset.load!;
      ui.cb.onLoadSlot(v === "auto" ? "auto" : Number(v));
      ui.closeModal();
    }),
  );
  box.querySelectorAll<HTMLElement>("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      ui.cb.onDeleteSlot(Number(b.dataset.del));
      ui.cb.onShowSaves();
    }),
  );
  // Close the saves dialog first: <dialog>'s top layer paints over the toast
  // rail, so export feedback would be invisible behind the open modal, and
  // the confirm dialog / file picker replace it rather than stacking on it.
  ui.wireActions(box, {
    export: () => {
      ui.closeModal();
      confirmExport(ui);
    },
    import: () => {
      ui.closeModal();
      openImport(ui);
    },
  });
}

/** Open the Add-to-Home-Screen how-to (SPEC-pwa-install CAP-3 / CAP-5). The
 *  install controller calls this directly (keeping UI.ts under its size ceiling);
 *  it is only ever reached from a deliberate tap on an install affordance. The
 *  `variant` picks the iOS Safari steps or the Chrome/Edge browser-menu steps. */
export function showInstallHelp(ui: UI, variant: InstallHelpVariant = "ios"): void {
  ui.openModalTemplate(installHelpTemplate(() => ui.closeModal(), variant), { displaceable: true });
}

export function confirmModal(
  ui: UI,
  title: string,
  body: string,
  onYes: () => void,
  yesLabel = "Confirm",
): void {
  // The lit template binds both actions inline with @click, so there is no
  // wireActions pass. There is no [data-act="close"] button; the title-bar ✕
  // still exists and closes through the dialog's cancel path.
  ui.openModalTemplate(
    confirmTemplate(title, body, yesLabel, {
      onCancel: () => ui.closeModal(),
      onYes: () => {
        ui.closeModal();
        onYes();
      },
    }),
  );
}

/**
 * The New Tower rule-set picker. The mode is founded here and is PERMANENT for
 * the tower's life (never a settings toggle). `onFound` fires only once the
 * player commits; the caller does the actual swap.
 */
export function newTowerModal(
  ui: UI,
  opts: { hasSave: boolean; onFound: (mode: GameMode, modernCalendar: CalendarKind, startUnbridged: boolean) => void },
): void {
  const box = ui.openModalTemplate(newTowerTemplate(opts.hasSave));
  ui.wireActions(
    box,
    {
      cancel: () => ui.closeModal(),
      found: () => {
        const picked = box.querySelector<HTMLInputElement>('input[name="nt-mode"]:checked')?.value;
        const mode: GameMode = picked === "modern" ? "modern" : "classic";
        // The calendar choice and the "no bridging" option only apply to Modern;
        // Classic is always canon and always bridges, so a Classic founding pins
        // the harmless defaults regardless of the Modern sub-picker.
        let modernCalendar: CalendarKind = "realWorld";
        let startUnbridged = false;
        if (mode === "modern") {
          const pickedCal = box.querySelector<HTMLInputElement>('input[name="nt-cal"]:checked')?.value;
          if (pickedCal === "canon") modernCalendar = "canon";
          startUnbridged = box.querySelector<HTMLInputElement>('input[name="nt-unbridged"]')?.checked === true;
        }
        ui.closeModal();
        opts.onFound(mode, modernCalendar, startUnbridged);
      },
    },
    { close: false },
  );
}

/** Export is deliberately two-step: nothing is serialized or downloaded until
 *  the player clicks a choice here. The .vctower path stays primary; the 1994
 *  .TDT path is secondary and leads to its own reverse fidelity modal. */
export function confirmExport(ui: UI): void {
  // The 1994 .TDT path is Classic only: buildTDT refuses a Modern tower, so
  // disable the button up front (with the reason) rather than let it fail.
  const isModern = ui.cb.getMode() === "modern";
  const box = ui.openModalTemplate(exportConfirmTemplate(isModern));
  ui.wireActions(box, {
    export: () => {
      ui.closeModal();
      ui.cb.onExport();
    },
    legacy: () => {
      ui.closeModal();
      ui.cb.onExportLegacy();
    },
  });
}


/** What the player is told when a report's tower is lost, wherever it is lost. */
const DROPPED = (kind: "import" | "export") =>
  `The ${kind} was dropped: another window took over before it could open. Try again.`;

/**
 * Hold a report until the dialog in the way resolves, then re-run it.
 *
 * The wait is leashed to THAT dialog rather than left open ended: a report
 * closes over a fully parsed tower, and a wait held across a tower swap or a
 * second import would eventually adopt the wrong one. When the leash breaks the
 * parsed tower is dropped, and the player is told so in the place they are
 * actually looking, which is inside whatever dialog is now on screen when there
 * is one. A toast cannot carry this message: the `<dialog>` top layer paints
 * over every z-index, and this path is only reachable while a dialog is up.
 */
function waitForDialog(ui: UI, reopen: () => void, kind: "import" | "export"): void {
  // Both halves: `#a11y-live` is visually hidden, so announcing only there
  // leaves a sighted player with no sign their file was even read.
  const waiting = `The SimTower ${kind} will open when you finish here.`;
  announce(waiting);
  ui.sayVisibly(waiting, "info");
  ui.precedence.wait(reopen, (reason) => {
    // Name what actually happened. "Another window took over" is a lie when the
    // truth is that a second file was picked, and a player who is told the
    // wrong reason cannot act on it.
    // One announcement, not two: `mountNotice` carries `role="alert"`, so
    // writing the same sentence to the polite region as well would either be
    // read out twice or be swallowed as a duplicate.
    const because =
      reason === "superseded"
        ? "another file was picked"
        : reason === "tower-swapped"
          ? "you started a different tower"
          : "another window took over";
    ui.sayVisibly(`The ${kind} was dropped: ${because} before it could open. Try again.`);
  });
}

/** Put a line in the polite live region, for the screen-reader half of "the
 *  player was told". The visible half is the caller's job. */
function announce(text: string): void {
  const live = document.getElementById("a11y-live");
  if (live) live.textContent = text;
}

/**
 * Fidelity report for a parsed legacy (.TDT) import, shown BEFORE anything is
 * adopted. `onOpen` fires only when the player commits via "Open tower".
 */
export function showImportReport(ui: UI, report: ImportReport, cb: { onOpen: () => void }): void {
  // Not "is a dialog open" but "would replacing it destroy something": one that
  // owns nothing is displaced, one that owns a decision is waited for. The old
  // guard refused on "open at all" and said so with a toast, which a <dialog>
  // paints over by construction (GH #658). See ./modalPrecedence.
  if (ui.precedence.ownsPendingWork(ui.isModalOpen())) {
    waitForDialog(ui, () => showImportReport(ui, report, cb), "import");
    return;
  }
  const box = ui.openModalTemplate(importReportTemplate(report), {
    // An open report holds a parsed tower; losing it silently is the same
    // defect one step later (GH #685).
    onDisplaced: () => ui.sayVisibly(DROPPED("import")),
  });
  // Announce for screen readers (the modal takes focus, but the polite region
  // tells them WHY a dialog appeared).
  const live = document.getElementById("a11y-live");
  if (live) live.textContent = "SimTower import report ready.";
  ui.wireActions(box, {
    open: () => {
      ui.closeModal();
      cb.onOpen();
    },
  });
}

/**
 * Reverse fidelity report for a legacy (.TDT) export, shown BEFORE anything
 * downloads. `onDownload` fires only on the primary; Cancel downloads nothing.
 */
export function showExportReport(ui: UI, report: ExportReport, cb: { onDownload: () => void }): void {
  // Same precedence as the import report; see the note there.
  if (ui.precedence.ownsPendingWork(ui.isModalOpen())) {
    waitForDialog(ui, () => showExportReport(ui, report, cb), "export");
    return;
  }
  const box = ui.openModalTemplate(exportReportTemplate(report), {
    onDisplaced: () => ui.sayVisibly(DROPPED("export")),
  });
  const live = document.getElementById("a11y-live");
  if (live) live.textContent = "SimTower export summary ready.";
  ui.wireActions(box, {
    download: () => {
      ui.closeModal();
      cb.onDownload();
    },
  });
}

export function showHelp(ui: UI): void {
  trackAppAction("help_open");
  // Replaying the intro is meaningless while the title screen is still up, so
  // disable that button there.
  const onSplash = !!document.getElementById("splash");
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  // Replay binds inline via @click. While the splash is up the button is
  // disabled, so a real browser suppresses the click, and onReplayOnboarding
  // also no-ops behind #splash; both make a splash-time trigger a no-op.
  const box = ui.openModalTemplate(helpTemplate(onSplash, version, { onReplay: () => ui.cb.onReplayOnboarding() }), { displaceable: true });
  // Inside a native wrapper the report link routes to the system browser
  // through the platform port (see routeExternalInWrapper).
  routeExternalInWrapper(box.querySelector<HTMLAnchorElement>(".help-report a")!);
  // "Open the full help page" is a real <a href="/help#classic-vs-modern"
  // target="_blank">, so a plain browser tab opens the shareable help page
  // (deep-linked to the comparison section) as written. But from an installed
  // standalone PWA (or the native shell, which has no /help route) a new tab
  // drops to the system browser and loses the session, so there we keep the
  // player in the running sim: swap the navigation for the in-app compare modal,
  // which pauses the tower and shows the same comparison.
  const fullPage = box.querySelector<HTMLAnchorElement>('a[data-act="open-help"]');
  fullPage?.addEventListener("click", (e) => {
    // Downgrade in an installed standalone PWA AND in the native Capacitor shell:
    // the shell renders the bundled snapshot with no /help route (and no Vercel
    // rewrite), so a new tab would 404 or lose the session there just as it would
    // for a standalone PWA.
    if (isInstalledStandalone() || getPlatform().isNativeWrapper) {
      e.preventDefault();
      showCompare(ui);
    }
  });
  ui.wireActions(box);
}

/**
 * The in-game Classic vs Modern comparison, opened from the Tower-panel mode
 * badge. It renders the shared {@link compareModalTemplate} through the single
 * `#modal`. Reading the reference should never cost the player elevator time, so
 * the tower pauses on open and its prior speed is restored on close, no matter
 * how the modal is dismissed (Got it, Esc, the backdrop, or the title-bar ✕).
 * The restore fires exactly once through a shared `finish`, wired to every close
 * path, so a double dismissal can't over-restore or leave the tower stuck paused.
 */
export function showCompare(ui: UI): void {
  trackAppAction("compare_open");
  const dialog = ui.el.modal as HTMLDialogElement;
  // Open the modal FIRST, then pause. If the render/open ever threw, pausing
  // first would leave the tower stuck at speed 0 with no modal to dismiss and no
  // restore path; opening first means a failure never pauses at all.
  const box = ui.openModalTemplate(compareModalTemplate());
  const prevSpeed = ui.cb.getSpeed();
  ui.cb.onSpeed(0);
  let restored = false;
  const finish = () => {
    if (restored) return;
    restored = true;
    ui.closeModal();
    ui.cb.onSpeed(prevSpeed);
  };
  // The "Got it" button, the backdrop, and Esc/✕ all route through finish so the
  // speed is always restored. Passing a `close` handler overrides wireActions'
  // default plain-close binding. These property handlers are re-set by
  // finishModal on the next modal open (as with showEventChoice), so they do not
  // leak to a later dialog.
  ui.wireActions(box, { close: finish });
  dialog.onclick = (e) => {
    if (e.target === dialog) finish();
  };
  dialog.oncancel = () => finish();
}

/** The Settings dialog: sound levels plus the presentation toggles. */
export function showSettings(ui: UI): void {
  trackAppAction("settings_open");
  // Same build constant the splash and Help's About line show; masked to a fixed
  // placeholder in screenshots (see pgMaskVersion, which keys on `.app-version`).
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  // The Building section (the bridging toggle) is Modern-only; Classic never
  // renders it (bridging is forced on and can't be toggled there).
  const modern = ui.cb.getMode() === "modern";
  const box = ui.openModalTemplate(settingsTemplate(version, modern), { displaceable: true });
  // Volume sliders: initialize from the live levels, apply on every input tick
  // (persistence is debounced by the onSetVolume handler in main.ts), and keep
  // the percent readout in step. Mute is independent; sliders never touch it.
  const vols = ui.cb.getVolumes();
  const wireVolume = (id: string, kind: "music" | "ambience" | "sfx", initial: number) => {
    const input = box.querySelector<HTMLInputElement>(`#${id}`)!;
    const readout = box.querySelector<HTMLElement>(`[data-vol-val="${id}"]`)!;
    const show = (v: number) => (readout.textContent = `${Math.round(v * 100)}%`);
    input.value = String(Math.round(initial * 100));
    show(initial);
    input.addEventListener("input", () => {
      const v = Number(input.value) / 100;
      ui.cb.onSetVolume(kind, v);
      show(v);
    });
  };
  wireVolume("vol-music", "music", vols.music);
  wireVolume("vol-ambience", "ambience", vols.ambience);
  wireVolume("vol-sfx", "sfx", vols.sfx);
  // Both switches show the LIVE state and re-read it from the callback's return
  // after every toggle, so a stuck pref can never desync the UI.
  const sc = box.querySelector<HTMLInputElement>("#set-steady-clock")!;
  sc.checked = ui.cb.isSteadyClock();
  sc.addEventListener("change", () => (sc.checked = ui.cb.onToggleSteadyClock()));
  const rm = box.querySelector<HTMLInputElement>("#set-reduce-motion")!;
  // When the OS forces reduced motion on, the user pref can't override it: show
  // the switch on, disable it (so it isn't a silent no-op), and say why.
  const osForced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  rm.checked = osForced || document.documentElement.classList.contains("reduce-motion");
  rm.disabled = osForced;
  if (osForced) rm.closest("label")!.querySelector("span")!.textContent = "Reduced motion (system)";
  rm.addEventListener("change", () => (rm.checked = ui.cb.onToggleReducedMotion()));
  // Modern-only bridging toggle: it shows the live state and re-reads the
  // callback's return after every toggle. Always available in Modern (rooms
  // auto-lay their floor regardless; this only controls the between-things
  // bridge), whatever was chosen at founding.
  if (modern) {
    const ab = box.querySelector<HTMLInputElement>("#set-auto-bridge")!;
    ab.checked = ui.cb.isAutoBridge();
    ab.addEventListener("change", () => (ab.checked = ui.cb.onToggleAutoBridge()));
  }
  // The controller wires every stateful control above; the plain Close action is
  // the one [data-act] button, so wireActions binds it (its loud lookup throws at
  // open if the button is ever dropped).
  ui.wireActions(box);
}

/** A two-choice emergency modal (fire rescue / bomb ransom). */
export function showEventChoice(
  ui: UI,
  message: string,
  costLabel: string,
  onResolve: (opt: "accept" | "decline") => void,
): void {
  const dialog = ui.el.modal as HTMLDialogElement;
  // The choice MUST resolve exactly once, no matter how the modal closes
  // (buttons, Esc, a backdrop click, or the title-bar x), or the sim (frozen
  // while a choice is open) would deadlock. Dismissing counts as declining.
  let done = false;
  const finish = (opt: "accept" | "decline") => {
    if (done) return;
    done = true;
    ui.closeModal();
    onResolve(opt);
  };
  // Actions bind inline in the template; the controller keeps the fire-once
  // logic and the dismissal paths. No wireActions pass, no [data-act="close"].
  ui.openModalTemplate(
    eventChoiceTemplate(message, costLabel, {
      onAccept: () => finish("accept"),
      onDecline: () => finish("decline"),
    }),
  );
  dialog.onclick = (e) => {
    if (e.target === dialog) finish("decline");
  }; // backdrop
  dialog.oncancel = () => finish("decline"); // Esc (the title-bar x routes here too)
}

/**
 * "A new build is ready" prompt. Dismissing by Esc, the ✕, or a backdrop click
 * all count as "Later", the safe choice, and, like the emergency modal, the
 * outcome fires exactly once no matter how the modal closes.
 */
export function showUpdatePrompt(
  ui: UI,
  onUpdateNow: () => void | Promise<void>,
  onLater: () => void | Promise<void>,
  info?: UpdateInfo | null,
): void {
  const dialog = ui.el.modal as HTMLDialogElement;
  let done = false;
  // The handlers may be async (Update now saves then reloads); invoke them
  // fire-and-forget through Promise.resolve().then(...).catch(...) so both a
  // synchronous throw and a rejected promise are contained here instead of
  // escaping as an `unhandledrejection`.
  const fireAndForget = (cb: () => void | Promise<void>) => {
    void Promise.resolve()
      .then(cb)
      .catch(() => {});
  };
  const later = () => {
    if (done) return;
    done = true;
    ui.closeModal();
    fireAndForget(onLater);
  };
  const update = () => {
    if (done) return;
    done = true;
    ui.closeModal();
    fireAndForget(onUpdateNow);
  };
  // Actions bind inline in the template; the controller keeps the fire-once logic
  // and the dismissal paths. No wireActions pass, no [data-act="close"].
  ui.openModalTemplate(updatePromptTemplate(info, { onLater: later, onUpdate: update }));
  dialog.onclick = (e) => {
    if (e.target === dialog) later();
  }; // backdrop
  dialog.oncancel = () => later(); // Esc / ✕
}

/** Reveal the persistent "Update" chip in the speed toolbar (idempotent) and
 *  wire its click. Announced politely for screen readers. */
export function showUpdateChip(_ui: UI, onClick: () => void): void {
  const btn = document.getElementById("btn-update") as HTMLButtonElement | null;
  if (!btn) return;
  btn.onclick = onClick;
  btn.hidden = false; // reveal (idempotent — safe to call again while shown)
  // Announce on EVERY call, not just the first reveal: a newer build arriving
  // while the chip is already visible should still reach screen-reader users.
  // Clear first, then set on the next frame so an identical message re-fires.
  const live = document.getElementById("a11y-live");
  if (live) {
    live.textContent = "";
    const announce = () => (live.textContent = "An update is ready.");
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(announce);
    else announce();
  }
}

export function congratsTower(ui: UI): void {
  ui.openModalTemplate(congratsTemplate(() => ui.closeModal()), { displaceable: true });
}

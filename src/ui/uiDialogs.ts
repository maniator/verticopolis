import type { UI } from "./UI";
import * as tpl from "./uiTemplates";
import { confirmTemplate } from "./templates/confirm";
import { eventChoiceTemplate } from "./templates/eventChoice";
import { updatePromptTemplate } from "./templates/updatePrompt";
import { settingsTemplate } from "./templates/settings";
import { helpTemplate } from "./templates/help";
import { savesTemplate } from "./templates/saves";
import type { BatchTarget, BatchRentOptions, BatchRentResult } from "../engine/Simulation";
import type { FacilityKind, GameMode } from "../engine/types";
import type { CalendarKind } from "../engine/calendar";
import { TOWER_FILE_EXT, type SlotInfo } from "../storage/SaveGame";
import type { ImportReport } from "../storage/tdtImport";
import { looksLikeLegacyTower } from "../storage/tdtImport";
import type { ExportReport } from "../storage/tdtExport";
import type { UpdateInfo } from "../pwa";
import { routeExternalInWrapper } from "./externalLink";

/**
 * Dialog and modal controllers for {@link UI}, as friend functions taking the
 * UI instance. Each one asks {@link uiTemplates} for its HTML body, opens it
 * through the UI's shared modal primitives, and wires the interactive handlers.
 * Extracted from `UI.ts`; the class keeps thin delegations so `main.ts` and the
 * rest of the app keep calling `ui.showHelp()` etc. unchanged.
 */

export function showStats(ui: UI, html: string): void {
  const box = ui.openModal(tpl.statsModalHtml(html));
  ui.wireActions(box);
}

/** Saves manager: auto-save + numbered slots, plus export/import. */
export function showSaves(ui: UI, slots: SlotInfo[]): void {
  const box = ui.openModalTemplate(savesTemplate(slots));
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

/** Per-floor stop configuration for an elevator (express service). */
export function showStopsDialog(
  ui: UI,
  title: string,
  floors: { floor: number; stop: boolean; lobby: boolean }[],
  onToggle: (floor: number, stop: boolean) => void,
): void {
  const box = ui.openModal(tpl.stopsHtml(title, floors));
  box.querySelectorAll<HTMLInputElement>("input[data-floor]").forEach((cb) => {
    cb.addEventListener("change", () => onToggle(Number(cb.dataset.floor), cb.checked));
  });
  ui.wireActions(box);
}

/** Batch-pricing dialog, pre-scoped to one priced kind. Live honest preview
 *  (same engine core as apply); Apply is disabled at zero changes. */
export function showBatchPricingDialog(
  ui: UI,
  ctx: {
    kind: FacilityKind;
    kindLabel: string;
    band: { default: number; min: number; max: number; step: number };
  },
  cb: {
    preview: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
    apply: (target: BatchTarget, opts: BatchRentOptions) => BatchRentResult;
    onApplied: (summary: string) => void;
  },
): void {
  const { kind, band } = ctx;
  const noun = ctx.kindLabel.toLowerCase() + "s";
  const priceWord = kind === "condo" ? "price" : "rent";
  const money = (n: number) => `$${n.toLocaleString()}`;
  const box = ui.openModal(tpl.batchPricingHtml(noun, priceWord, band));
  const priceEl = box.querySelector<HTMLInputElement>("#bp-price")!;
  const onlyEl = box.querySelector<HTMLInputElement>("#bp-only")!;
  const previewEl = box.querySelector<HTMLElement>("#bp-preview")!;
  const applyBtn = box.querySelector<HTMLButtonElement>("#bp-apply")!;
  const mode = () => box.querySelector<HTMLInputElement>('input[name="bp-mode"]:checked')!.value;
  // Snap a typed price to the band's step grid, so batch matches the ± adjuster's
  // granularity (a typed 12,345 becomes 12,000 for a $1,000-step office).
  const snap = (v: number) => {
    const stepped = Math.round((v - band.min) / band.step) * band.step + band.min;
    return Math.max(band.min, Math.min(band.max, stepped));
  };
  const target = (): BatchTarget => (mode() === "default" ? "default" : snap(Number(priceEl.value) || 0));
  const opts = (): BatchRentOptions => ({ onlyDefaultPriced: onlyEl.checked });
  const priceText = (t: BatchTarget) => (t === "default" ? `the default (${money(band.default)})` : money(t as number));

  let resetArmed = false; // bulk "Reset to default" needs a confirming second click
  const refresh = () => {
    priceEl.disabled = mode() === "default";
    resetArmed = false;
    applyBtn.textContent = "Apply";
    const r = cb.preview(target(), opts());
    let msg = `Set ${r.changed} of ${r.matched} ${noun} to ${priceText(target())}.`;
    if (r.skippedCustom) msg += ` ${r.skippedCustom} custom-priced left as-is.`;
    if (r.customOverwritten) msg += ` ${r.customOverwritten} custom price${r.customOverwritten === 1 ? "" : "s"} will be overwritten.`;
    if (r.skippedSold) msg += ` ${r.skippedSold} sold skipped.`;
    if (r.clampedHigh) msg += ` Clamped to the ${money(band.max)} max.`;
    if (r.clampedLow) msg += ` Clamped to the ${money(band.min)} min.`;
    previewEl.textContent = msg;
    applyBtn.disabled = r.changed === 0;
  };
  const step = (dir: 1 | -1) => {
    priceEl.value = String(Math.max(band.min, Math.min(band.max, (Number(priceEl.value) || 0) + dir * band.step)));
    refresh();
  };
  box.querySelector('[data-bp="inc"]')!.addEventListener("click", () => step(1));
  box.querySelector('[data-bp="dec"]')!.addEventListener("click", () => step(-1));
  priceEl.addEventListener("input", refresh);
  // On commit (blur/Enter), normalize the field to the snapped value it will
  // actually apply, so the input never shows a number different from the result.
  priceEl.addEventListener("change", () => {
    if (mode() !== "default") priceEl.value = String(snap(Number(priceEl.value) || 0));
    refresh();
  });
  onlyEl.addEventListener("change", refresh);
  box.querySelectorAll('input[name="bp-mode"]').forEach((el) => el.addEventListener("change", refresh));
  ui.wireActions(box);
  applyBtn.addEventListener("click", () => {
    // A bulk reset clears everyone's custom price, require a confirming click.
    if (mode() === "default" && !resetArmed) {
      resetArmed = true;
      applyBtn.textContent = "Confirm reset";
      return;
    }
    const r = cb.apply(target(), opts());
    cb.onApplied(`Set ${r.changed} ${noun} to ${priceText(target())}.`);
    ui.closeModal();
  });
  refresh();
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
  opts: { hasSave: boolean; onFound: (mode: GameMode, modernCalendar: CalendarKind) => void },
): void {
  const box = ui.openModal(tpl.newTowerHtml(opts.hasSave));
  ui.wireActions(
    box,
    {
      cancel: () => ui.closeModal(),
      found: () => {
        const picked = box.querySelector<HTMLInputElement>('input[name="nt-mode"]:checked')?.value;
        const mode: GameMode = picked === "modern" ? "modern" : "classic";
        // The calendar choice only applies to Modern; Classic is always canon,
        // so a Classic founding pins the harmless default regardless of what
        // the Modern sub-picker reads.
        let modernCalendar: CalendarKind = "realWorld";
        if (mode === "modern") {
          const pickedCal = box.querySelector<HTMLInputElement>('input[name="nt-cal"]:checked')?.value;
          if (pickedCal === "canon") modernCalendar = "canon";
        }
        ui.closeModal();
        opts.onFound(mode, modernCalendar);
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
  const box = ui.openModal(tpl.exportConfirmHtml(isModern));
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

/** Import goes straight to the file picker, exports are .vctower downloads
 *  now, so there is deliberately no paste-a-save textarea anymore. */
export function openImport(ui: UI): void {
  const input = document.getElementById("import-file") as HTMLInputElement;
  // Single source of truth for our own extension; the octet-stream entry keeps
  // .vctower selectable on pickers that filter by MIME type (Android). Original
  // 1994 SimTower saves (.TDT) import too; content is validated on load either
  // way, and a renamed save still routes right via the header-magic sniff.
  input.accept = `${TOWER_FILE_EXT},application/octet-stream,.tdt,.TDT`;
  input.value = "";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    // A file that vanishes or errors mid-read must not fail silently: the
    // launching dialog is already gone by the time the read runs.
    reader.onerror = () => ui.toast("Couldn't read that file. Please try again.", "bad");
    // Every pick is read as bytes and routed through ONE heuristic
    // (looksLikeLegacyTower): extension first, then the header-magic sniff, so a
    // renamed original save still lands on the legacy importer. Everything else
    // decodes as text for the .vctower path. BOM sniffing preserves the old
    // readAsText behavior (UTF-16 re-saves must keep decoding).
    const decodeText = (b: Uint8Array): string => {
      if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b);
      if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b);
      return new TextDecoder().decode(b); // UTF-8; strips a UTF-8 BOM itself
    };
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buffer);
      if (looksLikeLegacyTower(file.name, bytes)) ui.cb.onImportLegacy(buffer, file.name);
      else ui.cb.onImport(decodeText(bytes));
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
}

/**
 * Fidelity report for a parsed legacy (.TDT) import, shown BEFORE anything is
 * adopted. `onOpen` fires only when the player commits via "Open tower".
 */
export function showImportReport(ui: UI, report: ImportReport, cb: { onOpen: () => void }): void {
  // Never clobber a live dialog: the OS file picker isn't a modal, so a
  // blocking choice (emergency, update prompt) can open in the shared <dialog>
  // before the file finishes reading. openModal would wipe its DOM and handlers.
  if (ui.isModalOpen()) {
    ui.toast("Close the open dialog first, then import again.", "info");
    return;
  }
  const box = ui.openModal(tpl.importReportHtml(report));
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
  if (ui.isModalOpen()) {
    ui.toast("Close the open dialog first, then export again.", "info");
    return;
  }
  const box = ui.openModal(tpl.exportReportHtml(report));
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
  // Replaying the intro is meaningless while the title screen is still up, so
  // disable that button there.
  const onSplash = !!document.getElementById("splash");
  const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
  // Replay binds inline via @click. While the splash is up the button is
  // disabled, so a real browser suppresses the click, and onReplayOnboarding
  // also no-ops behind #splash; both make a splash-time trigger a no-op.
  const box = ui.openModalTemplate(helpTemplate(onSplash, version, { onReplay: () => ui.cb.onReplayOnboarding() }));
  // Inside a native wrapper the report link routes to the system browser
  // through the platform port (see routeExternalInWrapper).
  routeExternalInWrapper(box.querySelector<HTMLAnchorElement>(".help-report a")!);
  ui.wireActions(box);
}

/** The Settings dialog: sound levels plus the presentation toggles. */
export function showSettings(ui: UI): void {
  const box = ui.openModalTemplate(settingsTemplate());
  // Volume sliders: initialize from the live levels, apply on every input tick
  // (persistence is debounced by the onSetVolume handler in main.ts), and keep
  // the percent readout in step. Mute is independent; sliders never touch it.
  const vols = ui.cb.getVolumes();
  const wireVolume = (id: string, kind: "music" | "sfx", initial: number) => {
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
  const box = ui.openModal(tpl.congratsHtml());
  ui.wireActions(box);
}

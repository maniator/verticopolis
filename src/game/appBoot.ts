import type { GameApp } from "../main";
import { BuildActions } from "./buildActions";
import { EditorActions } from "./editorActions";
import { SaveLoad, RESUME_AFTER_RECOVERY_KEY } from "./saveLoad";
import { InspectorController } from "./inspector";
import { KeyboardPlay } from "./keyboardPlay";
import { attemptContextRecovery } from "./contextRecovery";
import { showCrashScreen } from "../ui/crashScreen";
import { OnboardingController, isOnboarded } from "../ui/Onboarding";
import { resolveBootScreen } from "../bootScreen";
import { hideBootCover } from "../bootstrap";
import { rebuildEngine } from "./engineWiring";
import { RESUME_AFTER_UPDATE_KEY, RESUME_RELOAD_MAX_AGE_MS } from "./updateFlow";
import { gameplaySession, setCommonProps } from "../analytics";
import { reportCrashException } from "../analyticsErrors";
import { bootCommonProps, platformLabel } from "../analyticsEnrichment";
import { isStandalone } from "../pwaInstall";
import { initInstallAffordance, splashInstallOffered, activateInstall } from "./installAffordance";
import { showTowerPicker } from "./appModals";

/**
 * Constructor collaborators for `GameApp`, split out to keep the class body a
 * thin shell: {@link wireControllers} builds the `src/game/` controller modules
 * (each closing over `app`, re-reading `app.sim` so an `adoptSim` swap stays
 * visible), and {@link runBootFlow} drives the first-paint boot: resume-flag
 * handling, splash/onboarding, the corrupt-save message, and the autosave timer.
 * Behavior unchanged from the former inline constructor bodies.
 */

/** Compile-time app version (see vite.config.ts `define`); "dev" outside a build. */
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

/** Classify why this boot happened, for the analytics boot snapshot. Mirrors
 *  `resolveBootScreen`: an "Update now" or WebGL-recovery reload only actually
 *  resumes the tower when a readable save survived, so "update" / "recovery" are
 *  gated on `hadReadableSave`. When a resume reload lands on an unreadable save
 *  (e.g. a save-format-breaking update), the player gets the splash and the
 *  corrupt message, so that outcome is reported as "corrupt", not the trigger.
 *  Otherwise a readable save is "continue" and nothing is "fresh". */
export function bootReason(flags: {
  justUpdated: boolean;
  justRecovered: boolean;
  hadReadableSave: boolean;
  saveWasCorrupt: boolean;
}): string {
  if (flags.justUpdated && flags.hadReadableSave) return "update";
  if (flags.justRecovered && flags.hadReadableSave) return "recovery";
  if (flags.saveWasCorrupt) return "corrupt";
  return flags.hadReadableSave ? "continue" : "fresh";
}

/** Build the controller modules onto `app`. Called from the constructor BEFORE
 *  the UI, because the `UI` ctor's initial selectTool fires `onSelectTool`
 *  synchronously (which resets the keyboard anchor), so `app.keyboard` /
 *  `app.build` must already exist. Their UI-facing deps are lazy closures for
 *  the same reason: `app.ui` is assigned just after this returns. Every module
 *  re-asks `app.sim` per call, so an adoptSim() swap is picked up automatically. */
export function wireControllers(app: GameApp): void {
  app.build = new BuildActions({
    getSim: () => app.sim,
    ui: { toast: (text, kind) => app.ui.toast(text, kind) },
    audio: app.audio,
    selectedId: () => app.selected?.id ?? null,
    clearSelection: () => app.clearSelection(),
  });
  app.inspector = new InspectorController({
    getSim: () => app.sim,
    ui: { showInspector: (html) => app.ui.showInspector(html) },
    setAnchor: (anchor) => (app.inspectAnchor = anchor),
  });
  app.editor = new EditorActions({
    getSim: () => app.sim,
    ui: {
      toast: (text, kind) => app.ui.toast(text, kind),
      showBatchPricingDialog: (ctx, cb) => app.ui.showBatchPricingDialog(ctx, cb),
      showElevatorScheduleDialog: (ctx, cb) => app.ui.showElevatorScheduleDialog(ctx, cb),
    },
    audio: app.audio,
    build: app.build,
    selected: () => app.selected,
    selectedUnit: () => app.selectedUnit(),
    selectedTransport: () => app.selectedTransport(),
    clearSelection: () => app.clearSelection(),
    refreshEditor: () => app.refreshEditor(),
    captureUndo: (label) => app.captureUndo(label),
    commitUndo: () => app.commitUndo(),
    announce: (msg) => app.announce(msg),
  });
  app.saveLoad = new SaveLoad({
    getSim: () => app.sim,
    getView: () => app.engine.viewState(),
    adoptSim: (sim) => app.adoptSim(sim),
    ui: {
      toast: (text, kind) => app.ui.toast(text, kind),
      downloadFile: (filename, contents) => app.ui.downloadFile(filename, contents),
      showImportReport: (report, cb) => app.ui.showImportReport(report, cb),
      showExportReport: (report, cb) => app.ui.showExportReport(report, cb),
    },
    // SaveLoad owns the crash shape and the reload action; the app supplies
    // the context only it has (version, the live sim, the frame-error ring).
    showCrashScreen: (info) => {
      // Render the recovery UI FIRST: it is the whole point of this path, and
      // analytics must never precede or block it.
      showCrashScreen({
        ...info,
        version: APP_VERSION,
        speed: app.speed,
        getSim: () => app.sim,
        frameErrors: app.frameErrors,
      });
      // Then report the crash the moment its screen is shown (not just via the
      // next boot's reason), flattening the description plus build and tower
      // context. Sim reads are defensive: a crash is when sim state is least
      // trustworthy, and a telemetry payload must never throw into the crash
      // handler. Host-gated and best-effort inside noteCrash.
      gameplaySession.noteCrash({
        ...info.crash,
        version: APP_VERSION,
        star: app.sim?.star ?? 0,
        population: app.sim?.population ?? 0,
      });
      // Additionally surface the crash in PostHog Error Tracking as a synthetic
      // $exception (the crash event above is analytics; this is the Error
      // Tracking lens on the same incident). Relay-only, host-gated, never-throw
      // inside, so it can never break crash recovery.
      reportCrashException(info.crash);
    },
    attemptGraphicsRecovery: (done) =>
      attemptContextRecovery(
        {
          onRestored: (cb) => {
            // Subscribe on the engine that lost its context. Unsubscribe
            // clears that same instance (app.engine points at the fresh
            // one after a rebuild).
            const lost = app.engine;
            lost.onContextRestored = cb;
            return () => {
              lost.onContextRestored = null;
            };
          },
          rebuild: () => rebuildEngine(app),
        },
        done,
      ),
    armOnboarding: () => {
      app.onboarding.arm(app.sim);
    },
  });
  app.keyboard = new KeyboardPlay({
    getSim: () => app.sim,
    engine: () => app.engine,
    audio: app.audio,
    ui: { toast: (text, kind) => app.ui.toast(text, kind) },
    build: app.build,
    tool: () => app.tool,
    isTransportTool: () => app.isTransportTool(),
    announce: (msg) => app.announce(msg),
    pickedAt: (floor, tile) => app.pickedAt(floor, tile),
    selectPicked: (p) => app.selectPicked(p),
    placeSimpleBuild: (kind, tile, floor) => app.placeSimpleBuild(kind, tile, floor),
    updateBuildPreview: (tile, floor) => app.updateBuildPreview(tile, floor),
    captureUndo: (label) => app.captureUndo(label),
    commitUndo: () => app.commitUndo(),
  });
}

/** First-paint boot flow: build the onboarding controller, consume the two
 *  resume flags, show the splash (or drop straight back into the tower on a
 *  resume reload), report an unreadable save, and start the autosave timer.
 *  Called at the end of the constructor once the engine is running. `savedAtBoot`
 *  is the loaded tower's write time (from `SaveGame.loadResult`), passed in for
 *  the S4 return-recency bucket; undefined with no readable save. */
export function runBootFlow(app: GameApp, savedAtBoot?: number): void {
  // Wire the install affordance early: the browser can fire beforeinstallprompt
  // during initial load, so its capture must be in place before then. The chip
  // stays hidden until the play-gate trips (see tickInstallAffordance).
  initInstallAffordance(app);
  // First-run splash + onboarding (chrome only; the engine is untouched).
  app.onboarding = new OnboardingController({
    mq: app.mobileMq,
    showHelp: () => app.ui.showHelp(),
    pauseForSplash: (paused) => app.setSpeed(paused ? 0 : 1),
    chime: () => app.audio.sfx("promote"),
    // A tower arrived over the title screen (SPEC-splash-load-tower CAP-6):
    // a loaded slot, a .vctower, or a 1994 .TDT. Land paused with the same
    // greeting Continue gives, the ▶ Play control being the single resume.
    onEnterTower: () => {
      app.setSpeed(0);
      app.ui.toast("Welcome back. Press ▶ to resume.", "info");
    },
    // Splash theme on the start screen, calm bed in the tower. Audio is
    // autoplay-gated (it only sounds after a gesture), so the splash theme is
    // heard on the New Tower path, where the splash stays up through the
    // rule-set modal while the audio chunk loads and then crossfades to the
    // bed. An instant Continue dismiss has no pre-dismiss gesture to sound
    // under, so it lands straight on the bed (tracked in the backlog).
    setMusicProgram: (onSplash) => app.audio.setProgram(onSplash ? "splash" : "game"),
  });
  // The title screen loads on every boot, so its branding, the attribution
  // line, and the Continue-vs-New-Tower (rule-set) choice greet the player each
  // launch. The exceptions are the two app-initiated resume reloads: the
  // post-"Update now" reload (its modal promised "keep playing") and the WebGL
  // context-loss recovery reload (a GPU crash we auto-recover from). Both drop
  // the player straight back into their tower (paused), skipping the splash.
  // Continue (or a resume drop-in) boots PAUSED either way: time must never
  // advance while the player reacquires their view and selection, which reset
  // on reload (the same "don't lose game-hours" rule the update modal's freeze
  // enforces).
  //
  // Read+clear both resume flags UNCONDITIONALLY, before the branch: a resume
  // reload can land on an unreadable save (the splash branch below), and the
  // flags must still be consumed there so a stale one can't mislabel a later
  // boot.
  let justUpdated = false;
  try {
    const stamp = Number(sessionStorage.getItem(RESUME_AFTER_UPDATE_KEY));
    sessionStorage.removeItem(RESUME_AFTER_UPDATE_KEY);
    justUpdated = Number.isFinite(stamp) && Date.now() - stamp < RESUME_RELOAD_MAX_AGE_MS;
  } catch {
    /* sessionStorage can throw in private mode, treat it as not-an-update */
  }
  let justRecovered = false;
  try {
    const stamp = Number(sessionStorage.getItem(RESUME_AFTER_RECOVERY_KEY));
    sessionStorage.removeItem(RESUME_AFTER_RECOVERY_KEY);
    justRecovered = Number.isFinite(stamp) && Date.now() - stamp < RESUME_RELOAD_MAX_AGE_MS;
  } catch {
    /* sessionStorage can throw in private mode, so treat it as not-a-recovery */
  }
  // One-time boot enrichment merged into EVERY event (S4): the platform
  // dimension (AUD-036) plus anonymous on-device buckets. Cookieless: coarse
  // buckets derived from state the device already holds (the onboarding flag,
  // the loaded tower's in-game age, and the autosave's write time), no id and no
  // new storage. Set BEFORE the boot event below so the very first event carries
  // it. Each read is individually defensive, but the whole compute is wrapped so
  // an enrichment hiccup can never throw past this point and abort boot: matching
  // the never-block-boot posture the boot snapshot below relies on.
  try {
    setCommonProps(
      bootCommonProps({
        platform: platformLabel(),
        onboarded: isOnboarded(),
        tenureDay: app.sim?.clock?.day,
        savedAt: savedAtBoot,
        standalone: isStandalone(),
        now: Date.now(),
      }),
    );
  } catch {
    /* best-effort enrichment; a returning/tenure/platform read must never block boot */
  }

  // One analytics snapshot per boot: the origin (update / recovery / corrupt /
  // continue / fresh) plus the loaded tower's standing state and the build
  // version. Fired here, once both resume flags are resolved, so a returning
  // player's established tower is captured even if they trigger no other event.
  // Best-effort and host-gated inside; never blocks boot.
  gameplaySession.noteBoot({
    reason: bootReason({
      justUpdated,
      justRecovered,
      hadReadableSave: app.hadReadableSave,
      saveWasCorrupt: app.saveWasCorrupt,
    }),
    version: APP_VERSION,
    // Defensive reads: a telemetry payload must never throw and abort boot.
    mode: app.sim?.mode ?? "unknown",
    star: app.sim?.star ?? 0,
    floors: app.sim?.tower?.highestFloor ?? 0,
    population: app.sim?.population ?? 0,
  });

  if (resolveBootScreen({ hadReadableSave: app.hadReadableSave, justUpdated, justRecovered }) === "resume") {
    // An app-initiated resume reload (update or GPU-crash recovery): drop the
    // player straight back into their tower, skipping the title screen. Land
    // paused; the ▶ Play control is the single "resume", so time must not
    // advance while the player reacquires their view and selection, which reset
    // on reload (the same rule the update modal's freeze enforces). The update
    // reload gets the "Updated …" greeting; a recovery reload gets the plain
    // "Welcome back" (a successful GPU recovery is deliberately undramatic).
    app.setSpeed(0);
    app.ui.toast(
      justUpdated ? `Updated to v${APP_VERSION}. Press ▶ to resume.` : "Welcome back. Press ▶ to resume.",
      "info",
    );
  } else {
    // Every other boot (cold reopen, a manual reload, first run, or a
    // corrupt/unreadable save) shows the title screen. `hasSave` reflects
    // READABILITY, not mere presence, so the splash only promises "Continue"
    // when a real tower sits behind it, never over a fresh boot sim.
    const hasSave = app.hadReadableSave;
    app.onboarding.showSplash({
      hasSave,
      // The splash mute is a second view of the ONE persisted master mute
      // (SPEC-splash-mute CAP-2): it drives the same toggleMute the topbar
      // button does, which also keeps the topbar glyph in sync for when the
      // splash dismisses into the game.
      muted: () => app.audio.muted,
      onToggleMute: () => app.toggleMute(),
      // The persistent splash install button (SPEC-pwa-install CAP-5): offered to
      // any not-standalone session, routed through the SAME activation the in-game
      // surfaces use (native prompt where captured, else an honest how-to).
      installOffered: () => splashInstallOffered(),
      onInstall: () => void activateInstall(app, "splash").catch(() => {}),
      onContinue: () => {
        // Only rendered when `hasSave`. teardownSplash() resumes the engine to
        // play speed, so re-pause: a returning player lands back in their tower
        // paused, the ▶ Play control being the single resume (as in the reload
        // path above).
        app.setSpeed(0);
        app.ui.toast("Welcome back. Press ▶ to resume.", "info");
      },
      // The load-only tower picker (SPEC-splash-load-tower). Offered on every
      // boot, not just when `hasSave`: the manual slots are invisible to
      // `hasSave` (it reads the autosave keys alone), and the picker's file row
      // is the only way a fresh install or a new device gets its towers back.
      onLoadTower: () => showTowerPicker(app),
      onNewTower: (dismiss) => {
        // The rule-set picker (Classic vs Modern) warns that New Tower abandons
        // the current tower only when one is continuable (`hasSave`); on a
        // corrupt / first-run boot there's nothing to lose, so it shows no
        // warning.
        app.ui.newTowerModal({
          hasSave,
          onFound: (mode, modernCalendar, manualStructure) => {
            dismiss();
            app.saveLoad.newGame(mode, modernCalendar, manualStructure);
          },
        });
      },
    });
  }

  // The first real screen (the splash, or the resumed tower) is now mounted, so
  // drop the static boot cover: on the splash path it uncovers the identical
  // title sky underneath, on the resume path the running tower.
  hideBootCover();

  // Tell the player plainly when their save couldn't be read, rather than
  // dropping them into a fresh tower with no explanation. Goes to the bulletin
  // (persists) and pops as a toast on the first UI update after the splash.
  if (app.saveWasCorrupt) {
    // The corrupt flag can coexist with a loaded tower: an unreadable
    // Verticopolis autosave with a healthy legacy save behind it loads the
    // legacy tower, and the message must not claim a fresh start.
    app.sim.emit(
      app.hadReadableSave
        ? "⚠️ Your latest autosave couldn't be read, so an older saved tower was loaded instead."
        : "⚠️ Your saved tower couldn't be read. It may be corrupted or from a newer version. Starting a new tower.",
      "bad",
    );
  }

  // Autosave periodically, but never while the first-run splash is up, so an
  // idle first visit can't persist the throwaway boot sim (which would flip
  // hasSave() true for a tower the player never started).
  window.setInterval(() => {
    if (!document.getElementById("splash")) void app.saveLoad.autosave();
  }, 30000);
}

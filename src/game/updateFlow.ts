import type { GameApp } from "../main";
import type { UpdateInfo } from "../pwa";
import { gameplaySession } from "../analytics";
import { hasBlockingModal, isDialogOpen, isSplashUp } from "./interactionState";

/**
 * The PWA update-prompt flow, split out of the `GameApp` class as friend
 * functions taking the app. They own the pending-update latch state ON `app`
 * (read by the frame loop's soft-freeze) and read the live sim/ui through `app`.
 * Behavior unchanged from the former methods. `GameApp.onUpdateAvailable` stays a
 * public method (e2e + bootstrap call it) delegating to {@link onUpdateAvailable}.
 */

/** sessionStorage key: stamped with `Date.now()` right before an "Update now"
 *  reload so the fresh build greets the player with "Updated …" instead of
 *  "Welcome back". sessionStorage survives the same-tab reload; the timestamp
 *  lets the boot ignore a stale flag left by an `updateSW` that resolved without
 *  ever reloading (so an unrelated later reload is never mislabeled). */
export const RESUME_AFTER_UPDATE_KEY = "vc-resume-after-update";
/** An app-initiated resume reload (an "Update now" reload or a WebGL context-loss
 *  recovery reload) fires within a second or two of its trigger. Only honor the
 *  resume flag (skip the splash, greet accordingly) inside this window, so a stale
 *  flag left by a trigger that resolved without actually reloading can't skip a
 *  later boot's splash. Shared by both resume flags. */
export const RESUME_RELOAD_MAX_AGE_MS = 30_000;

/** Called by the PWA layer the instant a newer build is waiting (wired up in
 *  the bootstrap). We do NOT reload; we hold the activation, reveal the
 *  toolbar "Update" chip so the player always has a way in, and let the
 *  ~6Hz loop pop the prompt at the next calm moment. A second release during
 *  a long session overwrites the pending activation and re-arms the auto-pop. */
export function onUpdateAvailable(app: GameApp, activate: () => Promise<void>, info?: UpdateInfo): void {
  app.pendingUpdate = activate;
  app.pendingUpdateInfo = info ?? null;
  app.updatePromptShown = false;
  app.ui.showUpdateChip(() => showUpdatePrompt(app));
}

/** True when it's safe to pop the update modal: nothing else owns the screen
 *  or a pending player decision. Opening a second modal would wipe the shared
 *  `<dialog>` and can strand a frozen sim, so this guard is load-bearing. */
export function updateCoastClear(app: GameApp): boolean {
  return (
    app.pendingUpdate !== null &&
    // `hasBlockingModal` is `shownUpdate || shownChoice`; the update flow writes
    // `shownUpdate` but reads the pair through the module like every other guard.
    !hasBlockingModal(app) &&
    !app.transportStart &&
    !isDialogOpen() &&
    !isSplashUp()
  );
}

/** Auto-surface the update prompt at most once per pending build, only when
 *  the coast is clear. Called every ~6Hz tick. */
export function maybeSurfaceUpdatePrompt(app: GameApp): void {
  if (app.updatePromptShown) return;
  if (!updateCoastClear(app)) return;
  showUpdatePrompt(app);
}

/** Open the "update available" modal. Shared by the auto-surface poll and the
 *  toolbar chip. No-ops unless the coast is clear (so a chip tap during an
 *  emergency, a drag, or another dialog is simply ignored). */
export function showUpdatePrompt(app: GameApp): void {
  if (!updateCoastClear(app)) return;
  const activate = app.pendingUpdate!;
  app.updatePromptShown = true;
  app.shownUpdate = true; // freeze the sim while the prompt is up
  app.ui.showUpdatePrompt(
    // Update now: save the tower FIRST, then activate (skipWaiting + reload).
    // If the save fails we do NOT reload (dropping unsaved progress is the one
    // thing this flow exists to prevent), so we unfreeze, tell the player, and
    // leave the build waiting (the chip stays, so they can retry).
    async () => {
      try {
        app.saveLoad.saveBeforeUpdate();
      } catch {
        app.shownUpdate = false;
        app.ui.toast("Couldn't save your tower. Update paused. Try again.", "bad");
        return;
      }
      // Unfreeze before activating: on success `activate()` reloads onto the
      // new build and nothing below matters, but if the worker swap ever
      // hiccups the sim must not be left frozen with no modal (a save just
      // ran, so a few resumed ticks are harmless). Keep `pendingUpdate` and the
      // chip live through the call so a failed activate leaves a way to retry
      // rather than stranding the player on the old build. We intentionally
      // keep NO "activating" latch: `updateSW(true)` resolves before the reload
      // fires, so any such latch could stick forever if the reload never comes,
      // and a second activation is idempotent (skipWaiting + reload) anyway.
      app.shownUpdate = false;
      // Report the update the player just initiated (from this build to the
      // incoming one) before the activating reload navigates away. This counts
      // the apply action: a rare failed activation (below) still sends one, so
      // the post-reload boot usually lands with reason "update", an approximate
      // applied signal: reclassification (storage failure, corrupt save) drops
      // it, and a manual reload in the resume window can carry it on the old build.
      // Best-effort and host-gated inside; sendToRelay prefers
      // navigator.sendBeacon (fetch keepalive fallback), surviving the reload.
      gameplaySession.noteUpdate(
        typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
        app.pendingUpdateInfo?.version ?? "unknown",
      );
      // Mark this reload as an update so the fresh build drops the player back
      // into their tower (paused) with an "Updated …" greeting instead of the
      // title screen, honoring the modal's "keep playing" promise.
      try {
        sessionStorage.setItem(RESUME_AFTER_UPDATE_KEY, String(Date.now()));
      } catch {
        /* private mode, the player just gets the normal "Welcome back" instead */
      }
      try {
        await activate();
      } catch {
        // The reload didn't happen, clear the flag so a later manual reload
        // isn't mislabeled "Updated", and tell the player they can retry.
        try {
          sessionStorage.removeItem(RESUME_AFTER_UPDATE_KEY);
        } catch {
          /* private mode, nothing to clear */
        }
        app.ui.toast("Update couldn't be applied. Try again.", "bad");
      }
    },
    // Later: keep playing. The waiting build activates on the next cold reopen
    // (prompt mode never force-activates); reset the autosave baseline to now
    // so that reopen can't cost more than this moment, and leave the chip up so
    // they can pull the prompt back up and update whenever they like.
    () => {
      app.shownUpdate = false;
      // Mark as surfaced so the auto-pop doesn't immediately re-open, even if a
      // newer build arrived mid-modal and re-armed it. The chip stays as the way
      // back in; a genuinely newer build re-arms auto-pop via onUpdateAvailable.
      app.updatePromptShown = true;
      try {
        app.saveLoad.save(true);
      } catch {
        /* best-effort, a failed baseline save just leaves the last autosave in place */
      }
    },
    app.pendingUpdateInfo,
  );
}

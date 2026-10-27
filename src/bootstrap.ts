import { html, nothing, render, type TemplateResult } from "lit-html";
import { registerPWA, type UpdateInfo } from "./pwa";
import { injectVercelTelemetry } from "./telemetry";
import { startGameplaySession, trackAppActionOnce } from "./analytics";
import { installErrorTracking } from "./analyticsErrors";
import { initPwaInstall } from "./pwaInstall";
import { dualRunRequested, startDualRun, type DualRunApp } from "./dualrun/dualRun";
import { noteRustFailed, selectBootEngine, stageNotice } from "./engineCohort/boot";
import { enginePackageUrl, loadWasmEngine, startWasmHost, type WasmHostApp, type WasmHostHandle } from "./wasmhost/startWasmHost";
import { makeBrowserWorker, spawnEngineWorker, startWorkerHost, type SpawnedWorker, type WorkerHostHandle } from "./wasmhost/workerController";
import { setEngineWriter } from "./storage/vctowerWriter";
import { noteEngineFallback, noteEngineSettled, noteEngineWriterLatched } from "./analyticsEngineStatus";
import { refreshSplashVersion } from "./wasmhost/engineLabel";
import { isHostFault } from "./wasmhost/hostFault";
import { ENGINE_FAILURE_ID } from "./game/interactionState";
import { showEngineLoading } from "./engineLoading";
import { catalogVerdict } from "./wasmhost/foreignCatalog";
import { bootFailure, bootFailureReason, engineFailureCopy, failBoot, loadBootEngine, publishBootState, typescriptBoot, type EngineBootState, type FallbackReason } from "./wasmhost/engineBoot";
import type { BuildMetadataResult } from "./wasmhost/buildSection";
import { copyEngineDiagnostics } from "./engineDiagnosticsCopy";
import { pageControlled, repairOffered } from "./wasmhost/engineRepair";
import { runEngineRepair } from "./engineRepairControl";

/**
 * Boot entry split out of `main.ts` (the `GameApp` composition root). Keeps the
 * WebGL capability probe, the telemetry gate, and the service-worker
 * registration next to the DOM-ready trigger, so `main.ts` stays the class
 * shell. `bootGame` takes a factory rather than importing `GameApp`, so there is
 * no runtime import cycle: `main.ts` calls `bootGame(() => new GameApp())` after
 * the class is defined.
 */

/** The slice of the app `bootGame` touches: it publishes the handle and wires
 *  the PWA update prompt. Structural, so `bootstrap.ts` need not import `GameApp`. */
interface BootApp {
  onUpdateAvailable(activate: () => Promise<void>, info?: UpdateInfo): void;
  ui?: { toast?(text: string): void };
}

/** The renderer needs WebGL; some in-app file viewers don't provide it. */
export function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Remove the static boot cover (index.html) once the app has something real to
 *  show: the mounted splash, the resumed tower, or a boot-fallback message. It
 *  is idempotent, so every boot outcome can call it without coordinating. */
export function hideBootCover(): void {
  document.getElementById("boot-cover")?.remove();
}

export function showBootMessage(content: TemplateResult | string, withReload = false): void {
  // A boot-fallback message (no WebGL, a boot error) must never be trapped
  // behind the cover, so drop it unconditionally, before the #stage guard.
  hideBootCover();
  // The stage check stays as the "is this the app page" gate, but the overlay
  // mounts in its OWN host under <body>: rendered inside #stage, its fixed
  // positioning would be hostage to any future transformed or filtered
  // ancestor (CSS makes such an ancestor the containing block for fixed
  // descendants, quietly shrinking "full viewport" to the stage box). A
  // direct child of <body> has no ancestors to capture it. Reused across
  // calls, so a second boot failure re-renders the same host.
  const stage = document.getElementById("stage");
  if (!stage) return;
  let host = document.getElementById("boot-fallback-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "boot-fallback-host";
    document.body.appendChild(host);
  }
  // Render through lit-html (the app's renderer): an interpolated string is
  // escaped to a text node, so a dynamic value (a caught boot error's message)
  // can never inject markup, while a caller that needs formatting passes a lit
  // template. No innerHTML.
  //
  // The message is a FIXED full-viewport overlay above everything, because
  // nothing weaker can be trusted here. Flow content sinks below the fold
  // behind the dead canvas (the live Firefox no-WebGL report). A stage-local
  // absolute overlay loses to the splash on the boot-error path (a boot
  // throw after runBootFlow leaves the title screen mounted at z-index 40),
  // and REMOVING the splash is worse: its controller keeps a document
  // keydown listener, the autosave interval gates on the splash node's
  // presence, and the game chrome behind it would become reachable around a
  // fatal message. Covering everything at z-index 100 (the stylesheet tops
  // out at 50) leaves every owner's state intact while the player sees only
  // the message. Longhand top/right/bottom/left instead of the `inset`
  // shorthand on purpose: this path serves old and hardened engines, exactly
  // the crowd a newer shorthand can strand at static position. The inner
  // wrapper centers itself with margin:auto rather than justify-content, so
  // copy taller than a short viewport scrolls from its first line instead of
  // clipping unreachably above the scroll origin.
  // The id is a stable hook: the screenshot runner's boot-fallback scenes and
  // the tests wait on it (there is no `window.game` to wait for on this path).
  render(
    html`<div
      id="boot-fallback"
      style="position:fixed;top:0;right:0;bottom:0;left:0;z-index:100;background:#1c2030;overflow:auto;display:flex;flex-direction:column;align-items:center;padding:24px;text-align:center;color:#cdd3da;font:15px/1.5 system-ui,sans-serif"
    >
      <div
        style="margin:auto;max-width:100%;overflow-wrap:anywhere;display:flex;flex-direction:column;gap:16px;align-items:center"
      >
        <div>${content}</div>
        ${withReload
          ? html`<button style="padding:8px 24px;font:inherit;cursor:pointer" @click=${() => location.reload()}>Reload</button>`
          : nothing}
      </div>
    </div>`,
    host,
  );
}

let inertWatch: MutationObserver | null = null;

/** Stop the game with the wasm-only build's engine failure: what happened,
 *  why, and what to try. Covers the title screen and any running tower, like
 *  every other boot-fallback message. */
export function showEngineFailure(state: EngineBootState, online = typeof navigator === "undefined" || navigator.onLine !== false): void {
  if (!state.failure) return;
  // An open modal dialog sits in the top layer above any z-index and makes
  // the rest of the page inert, the Reload button included, so close it.
  for (const dialog of Array.from(document.querySelectorAll("dialog[open]"))) (dialog as HTMLDialogElement).close();
  const offerRepair = repairOffered(state.failure, pageControlled());
  const copy = engineFailureCopy(state.failure, online, { secure: typeof window === "undefined" || window.isSecureContext !== false, repair: offerRepair });
  showBootMessage(
    html`<div id=${ENGINE_FAILURE_ID} data-stage=${state.failure.stage} role="alert" aria-live="assertive">
      <p><b>${copy.headline}</b></p>
      <p style="opacity:.8">Reason: ${copy.reason}</p>
      <ul style="text-align:left;margin:0 auto;max-width:36em">
        ${copy.steps.map((step) => html`<li>${step}</li>`)}
      </ul>
      <p>
        ${offerRepair
          ? html`<button style="padding:4px 16px;font:inherit;cursor:pointer" data-act="repair-engine" @click=${runEngineRepair}>Repair engine files</button>
              <span class="engine-failure-repair-status" role="status" aria-live="polite" style="margin:0 .5em;opacity:.8"></span>`
          : nothing}
        <button style="padding:4px 16px;font:inherit;cursor:pointer" data-act="copy-diagnostics" @click=${copyEngineDiagnostics}>Copy diagnostics</button>
        <span class="engine-failure-copy-status" role="status" aria-live="polite" style="margin-left:.5em;opacity:.8"></span>
      </p>
    </div>`,
    true,
  );
  // Everything behind the message goes inert, so a button that kept focus
  // cannot be pressed with Enter or Space and the title screen's keys do
  // nothing: the message and its Reload button are all that is left.
  // A surface mounted later (a panel, a dialog) goes inert as it arrives.
  const settle = (el: Element) => {
    if (el.id !== "boot-fallback-host") (el as HTMLElement).inert = true;
  };
  for (const el of Array.from(document.body.children)) settle(el);
  if (!inertWatch && typeof MutationObserver !== "undefined") {
    inertWatch = new MutationObserver((records) => {
      if (!document.getElementById(ENGINE_FAILURE_ID)) return;
      records.forEach((r) => r.addedNodes.forEach((n) => n instanceof Element && settle(n)));
    });
    inertWatch.observe(document.body, { childList: true });
  }
  // The stop announces itself (role=alert above), and focus lands on Reload,
  // the one control left, so a keyboard or screen-reader user is not left on
  // an inert element.
  const host = document.getElementById("boot-fallback-host");
  const reload = host?.querySelector<HTMLButtonElement>("#boot-fallback button:not([data-act])");
  if (reload) reload.focus();
  else {
    const active = document.activeElement as HTMLElement | null;
    if (active && !host?.contains(active)) active.blur?.();
  }
}

/** Boot the game once the DOM is ready. `create` builds the app instance (a
 *  `() => new GameApp()` thunk from `main.ts`), kept as a factory so this module
 *  imports no `GameApp` value and stays cycle-free. */
export function bootGame(create: () => BootApp): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  // Async so the WASM engine can load before the game constructs. The rethrow
  // below therefore becomes a REJECTION rather than a
  // synchronous throw, which is still captured: `installErrorTracking` binds
  // `unhandledrejection` alongside `error` (see analyticsErrors.ts), and it is
  // installed as the first statement here, so the listener is already up.
  const boot = async () => {
    // Install the cookieless error listeners first, so an uncaught throw during
    // the rest of boot is captured (a throw during module eval, before this line,
    // is inherently out of reach). Host-gated per report (nothing is sent on a
    // dark host), never-throw, and only two passive listeners, so it is safe to
    // run before anything else.
    installErrorTracking();
    // Bind the PWA install capture as early as boot runs: `beforeinstallprompt`
    // can fire during initial load, before the game constructs and the install
    // affordance controller wires its callbacks, so catch an early event into
    // the module now. The install analytics latch rides here too, so an
    // `appinstalled` on ANY page (including the no-WebGL fallback, which returns
    // before the game constructs) still records the fact once; the controller
    // re-inits with its UI callbacks later and the listeners bind once.
    // (SPEC-pwa-install CAP-2 / CAP-4.)
    initPwaInstall({ onInstalled: () => trackAppActionOnce("install_app") });
    // Report Core Web Vitals and page views through the shared, host-gated
    // helper (the same inject the gallery and the /help page use), so a
    // telemetry hiccup can never throw past this line and suppress the WebGL
    // fallback below.
    injectVercelTelemetry();
    if (!hasWebGL()) {
      // The copy leads with the remedy (every current browser, Firefox
      // included, runs WebGL once hardware acceleration is on; most real hits
      // here are acceleration turned off, a driver blocklist, or a hardened
      // profile, all fixable in place) and keeps another browser or device as
      // the honest last resort. The reload button closes the loop after the
      // setting flips.
      showBootMessage(
        html`This browser can't use WebGL right now, and Verticopolis needs it to
          draw the tower.<br /><br />Enable <b>hardware acceleration</b> (or WebGL) in your
          browser's settings and reload. If that doesn't help, another browser or
          device should run it.`,
        true,
      );
      return;
    }
    // The WASM engine is fetched before the app exists, so the first tower is
    // hosted before its first tick. A switchable build loads it only when asked
    // (`?engine=wasm`, or `vc.engine` in storage) and stays on the TypeScript
    // engine when it fails to load. A wasm-only build (`VC_ENGINE=wasm`) always
    // loads it and stops here when it cannot: the TypeScript step loop is not
    // in that bundle, and a silent fallback is what the build rules out. The
    // engine switch is compiled away there with the `__WASM_ONLY__` define.
    // A TypeScript boot does not await, so it stays synchronous as before.
    // `wasm-frame` and `wasm-worker` are experimental hosts of the same
    // engine, for measurement only (docs/architecture/wasm-worker-host.md),
    // and only in a switchable build. The worker host never loads the engine
    // on the main thread: the worker loads it and answers ready before the
    // app exists, for the same reason; one that fails to start leaves the
    // game on the TypeScript engine.
    // A wasm-only build has no switch: `__WASM_ONLY__` folds the choice and
    // drops the experimental hosts from its bundle. A switchable build asks
    // the staged cohort's policy (#1197): the URL, a safety suppression, the
    // Settings choice, then the cohort arm.
    const choice = __WASM_ONLY__ ? "wasm" : selectBootEngine();
    const mainThreadWasm = choice === "wasm" || choice === "wasm-frame";
    // The cover says so after a short wait, when the package takes a while (#1132).
    const stopLoadingLine = mainThreadWasm || choice === "wasm-worker" ? showEngineLoading() : () => {};
    const booted = mainThreadWasm ? await loadBootEngine({ wasmOnly: __WASM_ONLY__, load: (signal, onBuild) => loadWasmEngine(undefined, signal, { onBuild }) }) : typescriptBoot();
    let engineWorker: SpawnedWorker | null = null;
    let workerHost: WorkerHostHandle | null = null;
    let bootState: EngineBootState = booted.state;
    if (!__WASM_ONLY__ && choice === "wasm-worker") {
      try {
        engineWorker = await spawnEngineWorker(makeBrowserWorker, enginePackageUrl());
        if (engineWorker.identity !== undefined) bootState = { ...bootState, identity: engineWorker.identity };
        if (engineWorker.build) bootState = { ...bootState, binary: engineWorker.build };
      } catch (e) {
        // Recorded with its reason, as a failed package load is (#874).
        const workerBuild = (e as { build?: BuildMetadataResult } | null)?.build;
        bootState = { ...bootState, ...(workerBuild ? { binary: workerBuild } : {}), failure: bootFailure("load", e) };
        console.error("[wasm-worker] the engine worker did not start; running on the TypeScript engine:", e);
      }
    }
    stopLoadingLine();
    // Rust failed on this device: later boots stay on TypeScript (#1197), for
    // this build after a load failure, else until a retry. Never throws.
    const rustFailed = (stage: Parameters<typeof noteRustFailed>[0], reason: string) =>
      __WASM_ONLY__ || noteRustFailed(stage, reason, bootState.binary?.state === "ok" ? bootState.binary.sourceHash : undefined);
    if (bootState.failure) rustFailed(bootState.failure.stage, bootState.failure.reason);
    publishBootState(bootState);
    // Start the gameplay session clock (foreground time + funnel state) only once
    // the game can run: a no-WebGL visitor bails above, and a wasm-only build
    // whose engine did not load stops just below. A wasm-only build that stops
    // later (a refused tower) has a session, but its frame loop samples nothing
    // once stopped. Host-gated inside, like the page-view inject above.
    const engineless = bootState.engine === "none" && bootState.failure !== null;
    if (!engineless) startGameplaySession();
    // The reliability instrument's one row per page life (`engine_status`,
    // `analyticsEngineStatus.ts`): codes only, read from the boot state. The
    // message stays behind; only the stage and the reason are handed over.
    const settle = () => {
      const f = bootState.failure;
      noteEngineSettled({ build: bootState.build, requested: choice, failure: f && { stage: f.stage, reason: f.reason } });
    };
    if (engineless && bootState.failure) {
      settle();
      showEngineFailure(bootState);
      // A fixed deploy is the way out of a broken or stale engine package:
      // with no tower running there is nothing to save, so take it at once.
      registerPWA({ onUpdateAvailable: (activate) => void activate() });
      // This error reaches the exception tracker, which groups by message, so a
      // refused package is named by its code and kind, never by its file or
      // digests (those stay on the console and in `__vcEngineBoot`).
      const f = bootState.failure;
      throw new Error(`the Rust engine did not start (${f.stage}): ${f.package ? `${f.reason}, ${f.package.kind}` : f.message}`);
    }
    // Whether the game exists: a boot that throws before it does sends no
    // row, even when its engine had already failed to load (the error itself
    // reaches `$exception`, and the reliability report names the gap).
    let created = false;
    try {
      const app = create();
      created = true;
      const wasmModule = booted.module;
      if (!__WASM_ONLY__ && engineWorker) {
        try {
          const catalogs = engineWorker.catalogs;
          workerHost = startWorkerHost(app as unknown as WasmHostApp, engineWorker, () => spawnEngineWorker(makeBrowserWorker, enginePackageUrl()));
          engineWorker = null; // the host owns it now
          // startWorkerHost reports a refused first tower on its status. That
          // tower stays on TypeScript, recorded as the main-thread host records
          // it (#874); the host follows every later adopt either way.
          const { hosted, lastError } = workerHost.status;
          // A package whose catalogs this build cannot draw is a mismatched
          // one (#1086), as the main-thread host codes it; the worker sent
          // its catalogs when it answered ready.
          if (hosted) bootState = { ...bootState, engine: "wasm" };
          else {
            const refusal = catalogVerdict((mode) => catalogs[mode]) === "foreign" ? "package-mismatch" : "attach-refused";
            bootState = failBoot(bootState, "start", refusal, lastError ?? "the worker host did not take the first tower");
          }
          publishBootState(bootState);
          refreshSplashVersion();
        } catch (e) {
          // A host that started before a later throw lets its tower go
          // (startWorkerHost cleans up after its own throws).
          workerHost?.stop();
          workerHost = null;
          engineWorker?.worker.terminate();
          engineWorker = null;
          bootState = failBoot(bootState, "start", bootFailureReason(e), e instanceof Error ? e.message : String(e));
          rustFailed("start", bootFailureReason(e));
          publishBootState(bootState);
          console.error("[wasm-worker] did not start; running on the TypeScript engine:", e);
        }
      }
      if (wasmModule) {
        // The host reports a refusal through `onFatal` (wasm-only builds), and
        // the first tower's refusal arrives during `startWasmHost` itself, so
        // `starting` tells a failed start from a later tower the host lost.
        let starting = true;
        const stopForEngine = (stage: "start" | "host", reason: FallbackReason, message: string) => {
          bootState = failBoot(bootState, stage, reason, message);
          publishBootState(bootState);
          if (!__WASM_ONLY__) return;
          showEngineFailure(bootState);
          // Nothing can advance a tower now; stop asking the frame loop to.
          (app as { setSpeed?: (s: number) => void }).setSpeed?.(0);
        };
        let hosted = false;
        try {
          let handle: WasmHostHandle | null = null;
          handle = startWasmHost(app as unknown as WasmHostApp, wasmModule, console, {
            // onFatal hears a tower the host would not take, and a running
            // engine's fault (#874).
            ...(__WASM_ONLY__ ? { strict: true, onFatal: (m: string, reason: FallbackReason) => stopForEngine(starting ? "start" : "host", reason, m) } : {}),
            sync: !__WASM_ONLY__ && choice === "wasm-frame" ? "frame" : "step",
            // A later tower the host would not take is a fallback of its own;
            // the first one is in the boot state the settle row reads. A
            // fallback that latches hosting off (a running engine's fault,
            // #874, or a trap while a tower attaches, #1113) also turns the
            // engine save writer off, since a trapped module may be corrupt.
            // A fault's code says so too, should a caller leave `latched` off.
            onFallback: (fallback, latched) => {
              if (latched || isHostFault(fallback.reason)) {
                setEngineWriter(null);
                rustFailed(fallback.stage, fallback.reason);
                // The boot state tooling and support read says so too (a
                // wasm-only build records it through onFatal, and a first
                // tower's is recorded below, with its message).
                if (!__WASM_ONLY__ && !starting) stopForEngine("host", fallback.reason, handle?.status.lastError ?? fallback.reason);
              }
              noteEngineFallback(fallback);
            },
          });
          // A refused first tower: strict mode reported it through onFatal; a
          // switchable build leaves it on TypeScript, recorded here (#874).
          if (!handle.status.hosted && !bootState.failure) stopForEngine("start", handle.status.lastFallback?.reason ?? "attach-refused", handle.status.lastError ?? "the host did not take the first tower");
          // A switchable build keeps the engine writer and label even when its
          // first tower stayed on TypeScript: the host follows every later
          // adopt, so the next tower it holds saves through the engine. Not
          // when that tower's engine trapped: no later tower is hosted, and
          // the module is not asked again (#1113).
          hosted = !(__WASM_ONLY__ && bootState.failure) && !handle.status.latched;
        } catch (e) {
          stopForEngine("start", bootFailureReason(e), e instanceof Error ? e.message : String(e));
          rustFailed("start", bootFailureReason(e));
          console.error(__WASM_ONLY__ ? "[wasm] did not start, and this build has no other engine:" : "[wasm] did not start; running on the TypeScript engine:", e);
        }
        starting = false;
        if (hosted) {
          // Saves are written through the engine too (same bytes, #935).
          if (wasmModule.encodeVctower) {
            setEngineWriter(wasmModule.encodeVctower, () => {
              bootState = { ...bootState, writerLatched: true };
              publishBootState(bootState);
              noteEngineWriterLatched();
            });
          }
          refreshSplashVersion(); // the title screen mounted before the host started
        }
      }
      // The engine is settled. Sent before the tooling and service-worker
      // steps below, so a throw in one of them cannot lose the row.
      settle();
      // A stage change that moved this browser's engine says so once (#1197).
      try {
        const notice = stageNotice();
        if (notice) app.ui?.toast?.(notice);
      } catch (e) {
        console.error("[engine] could not show the engine test notice:", e);
      }
      // Publish the tooling handle only where tooling runs: dev serves and
      // VC_TOOLING=1 builds (the e2e, screenshot, and perf pipelines; see
      // vite.config.ts `define`). A production build compiles this branch
      // away, so a deployed session ships no `window.game` console handle
      // into the sim (`game.sim.star = 5` was a one-line cheat). Devtools can
      // still reach anything client-side; this closes the handed-out path.
      if (import.meta.env.DEV || __TOOLING_BUILD__) {
        (window as unknown as { game: BootApp }).game = app;
        // The dual run (the WASM engine shadowing the live one, compared
        // every hour) is a developer switch on the same tooling-only path.
        // A switch that fails to start is logged and never takes boot down.
        if (!__WASM_ONLY__ && dualRunRequested()) {
          try {
            startDualRun(app as unknown as DualRunApp);
          } catch (e) {
            console.error("[dualrun] did not start:", e);
          }
        }
      }
      // Register the service worker so the game is installable and offline-ready.
      // On a new build: prompt the player (never force a reload), see
      // GameApp.onUpdateAvailable.
      // A wasm-only build that has stopped on its engine takes an update at
      // once instead: the prompt would sit under the engine-failure message,
      // and a fixed deploy is the way out.
      registerPWA({
        onUpdateAvailable: (activate, info) => (__WASM_ONLY__ && bootState.failure ? void activate() : app.onUpdateAvailable(activate, info)),
      });
    } catch (err) {
      // A worker started for a game that never came up is let go.
      (workerHost as WorkerHostHandle | null)?.stop(); // assigned in the try above
      engineWorker?.worker.terminate();
      // A non-Error throw (a string, say) has no `.message`, so derive the text
      // defensively rather than render "undefined"; the original error is still
      // rethrown untouched.
      const message = err instanceof Error ? err.message : String(err);
      // The worker host that had started is let go above, so the published
      // state stops claiming it. The throw came from a boot step outside the
      // engine, so it is coded `other`, and reported as a fallback when the
      // settle row already went out.
      if (workerHost && bootState.engine === "wasm" && !bootState.failure) {
        bootState = failBoot(bootState, "start", "other", message);
        publishBootState(bootState);
        noteEngineFallback({ reason: "other", stage: "start" });
      }
      // A throw that skipped the settle row (a wasm-only stop whose failure
      // message could not be shown, say) still sends it, from the boot state.
      if (created) settle();
      // A wasm-only build that already stopped on its engine keeps that
      // message, which carries the reason and the recovery steps.
      if (!document.getElementById(ENGINE_FAILURE_ID)) showBootMessage("Something went wrong starting the game: " + message);
      throw err;
    }
  };
  // Returns the boot promise rather than firing and forgetting it. `boot` became
  // async so the WASM engine can load before the game constructs, and
  // its rethrow would otherwise be a floating rejection nothing could observe:
  // not the caller, and not a test.
  //
  // `main.ts` still VOIDS the result, deliberately. There is nothing useful to
  // do with a boot failure beyond the message already rendered, so an unhandled
  // rejection reaches `installErrorTracking`'s `unhandledrejection` listener
  // exactly as an uncaught throw used to reach its `error` listener. Both are
  // bound by the first statement in `boot`, so the listener is up before
  // anything here can fail.
  if (document.readyState === "loading") {
    return new Promise<void>((resolve, reject) => {
      document.addEventListener("DOMContentLoaded", () => void boot().then(resolve, reject));
    });
  }
  return boot();
}

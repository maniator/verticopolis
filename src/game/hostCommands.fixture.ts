import { expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { GameApp } from "../main";
import type { PlatformPort, HostCommand } from "../platform/types";
import { __resetHostCommandsForTest } from "./hostCommands";
import { setLiveSplashActions } from "../ui/splashActions";

/**
 * Shared fixture for the shell-to-game command seam tests.
 *
 * Split out of `hostCommands.test.ts` when that file crossed the 500-line
 * ceiling (`src/tests/fileSize.guard.test.ts`). The dispatch/guard suite and the
 * availability/binding suite are separate files now, and both need the same fake
 * app, the same spy accounting, and the same DOM and splash mounting, so keeping
 * one copy here is what stops the two suites from drifting into disagreeing
 * fixtures for the same seam.
 */
/** The fake app's spies. Everything the dispatch only ever HANDS to the app is a
 *  bare mock; the two the fixture itself CALLS carry a real signature, because a
 *  bare `vi.fn()` types as `Mock<Procedure | Constructable>`, which is not
 *  callable and cannot satisfy `LiveSplashActions`. Narrowing here beats loosening
 *  the port that production code depends on. */
export type Spies = Record<
  | "promptNewTower"
  | "onSave"
  | "onShowSaves"
  | "onShowStats"
  | "onUndo"
  | "onRedo"
  | "showHelp"
  | "showSettings"
  | "sayVisibly"
  | "isEditorBusy"
  | "saveBeforeUpdate",
  ReturnType<typeof vi.fn>
> & {
  splashNew: Mock<() => void>;
  splashLoad: Mock<() => void>;
};

export function makeApp(): { app: GameApp; spies: Spies } {
  const spies: Spies = {
    promptNewTower: vi.fn(),
    onSave: vi.fn(),
    onShowSaves: vi.fn(),
    onShowStats: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    showHelp: vi.fn(),
    showSettings: vi.fn(),
    sayVisibly: vi.fn(),
    isEditorBusy: vi.fn(() => false),
    // The quit-time flush target (story D6): the same splash-guarded
    // synchronous flush the update path uses, spied so the binding tests can
    // assert it ran without touching real storage.
    saveBeforeUpdate: vi.fn(),
    // The title screen's own two buttons. Registered through the real
    // `setLiveSplashActions` by `mountSplash` below, not injected, so these tests
    // exercise the same registry `OnboardingController.showSplash` publishes to.
    splashNew: vi.fn(),
    splashLoad: vi.fn(),
  };
  const app = {
    // The two blocking-choice flags the guard reads directly. False here, and
    // flipped by the tests that need them, so their default is the same
    // "no choice pending" the real app boots with rather than undefined.
    shownChoice: false,
    shownUpdate: false,
    saveLoad: { saveBeforeUpdate: spies.saveBeforeUpdate },
    ui: {
      promptNewTower: spies.promptNewTower,
      showHelp: spies.showHelp,
      showSettings: spies.showSettings,
      sayVisibly: spies.sayVisibly,
      isEditorBusy: spies.isEditorBusy,
      cb: {
        onSave: spies.onSave,
        onShowSaves: spies.onShowSaves,
        onShowStats: spies.onShowStats,
        onUndo: spies.onUndo,
        onRedo: spies.onRedo,
      },
    },
  } as unknown as GameApp;
  return { app, spies };
}

/** Every dispatch target, so a refusal case can assert that NOTHING ran rather
 *  than only checking the one command it sent. */
export const TARGETS = [
  "promptNewTower",
  "onSave",
  "onShowSaves",
  "onShowStats",
  "onUndo",
  "onRedo",
  "showHelp",
  "showSettings",
] as const;
export const totalCalls = (s: Spies) => TARGETS.reduce((n, k) => n + s[k].mock.calls.length, 0);
/** Every dispatch, the two splash routes included. `TARGETS` deliberately leaves
 *  them out so the one-arm-per-command count stays exact; refusal cases need this
 *  wider count, so that a refused command cannot quietly drive the title screen
 *  instead of an in-game target and still read as "nothing ran". */
export const totalDispatch = (s: Spies) => totalCalls(s) + s.splashNew.mock.calls.length + s.splashLoad.mock.calls.length;

export const ALL_COMMANDS: HostCommand[] = [
  "new-game",
  "save",
  "open-saves",
  "undo",
  "redo",
  "stats",
  "help",
  "settings",
];

export const mountDom = () => {
  document.body.innerHTML = `<dialog id="modal"></dialog>`;
};

/** Put the title screen up the way the app does: the `#splash` element the guard
 *  reads AND the published actions the dispatch routes to. Production sets and
 *  clears both together in `showSplash` / `teardownSplash`, so mounting only one
 *  of them would test a state the app cannot reach. */
export function mountSplash(spies: Spies): void {
  document.body.insertAdjacentHTML("beforeend", '<div id="splash"></div>');
  setLiveSplashActions({
    // `Spies` types every entry as a bare `vi.fn()`, whose signature is wider than
    // the port's, so the narrowing happens here rather than by loosening the port.
    onNewTower: () => spies.splashNew(),
    onLoadTower: () => spies.splashLoad(),
  });
}

/** Take the title screen down the same way, both halves at once. */
export function unmountSplash(): void {
  document.getElementById("splash")?.remove();
  setLiveSplashActions(null);
}

/** Open the shared modal the way the guard reads it, and assert the fixture took:
 *  a happy-dom quirk leaving `.open` false would make every refusal below pass
 *  vacuously. */
export function openModal(): void {
  const dialog = document.getElementById("modal") as HTMLDialogElement;
  dialog.setAttribute("open", "");
  expect(dialog.open).toBe(true);
}

export const basePort = (): PlatformPort => ({
  isNativeWrapper: true,
  saveFile: () => Promise.resolve(),
  openExternal: () => {},
});

/** The per-test setup both suites need. Called at the top level of each test
 *  file so vitest registers the hooks for that file. Resets BOTH module
 *  registries the seam depends on: its own bind state, and the title screen
 *  action registry, since either surviving a test would silently change how the
 *  next one dispatches. */
export function installSeamHooks(): void {
  beforeEach(() => {
    mountDom();
    __resetHostCommandsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    setLiveSplashActions(null);
    __resetHostCommandsForTest();
  });
}

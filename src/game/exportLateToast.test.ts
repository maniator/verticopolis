import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveStorePort } from "../platform/saveStore";
import {
  HUNG_TOAST,
  LATE_PREFIX,
  LATE_SUFFIX,
  STORED_TOAST,
  deferred,
  fakeUi,
  flowDeps,
  storeWithExport,
} from "./exportFlow.fixture";

/**
 * The wording an export uses when it succeeds AFTER the watchdog already told
 * the player it had stalled (GH #774). The player has usually moved on to
 * another tower by then, so the toast names the one that actually landed on
 * disk, and that name is captured when Export was pressed rather than read
 * back at settle time. The `vi.mock` preamble is repeated here because
 * vi.mock is file-scoped and hoisted; `exportFlow.fixture` carries the rest.
 */

let injectedStore: SaveStorePort | undefined;

vi.mock("../platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../platform")>()),
  IS_WRAPPED_BUILD: true,
  getPlatform: () => ({
    isNativeWrapper: true,
    saveFile: () => Promise.resolve(),
    openExternal: () => {},
    get saveStore() {
      return injectedStore;
    },
  }),
}));

const { prepareSaveStore, resetSaveStoreForTests } = await import("./desktopSaveStore");
const { resetManualSaveForTests } = await import("./manualSavePersist");
const { runExportFlow, resetExportFlowForTests, EXPORT_WATCHDOG_MS } = await import("./exportFlow");

beforeEach(() => {
  resetSaveStoreForTests();
  resetManualSaveForTests();
  resetExportFlowForTests();
  injectedStore = undefined;
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("late-success wording (GH #774)", () => {
  /** Drive one export to the hung-bridge state, run `afterInvoke` (the minutes
   *  in which the player moves on), then settle it as a success. Returns the
   *  toasts, which always open with the watchdog's line. */
  async function lateSuccessToasts(sim: Simulation, afterInvoke?: (state: { current: Simulation }) => void) {
    const gate = deferred<boolean>();
    const store = storeWithExport(() => gate.promise);
    injectedStore = store.port;
    await prepareSaveStore();
    vi.useFakeTimers();
    const { ui, toasts } = fakeUi();
    const state = { current: sim };
    const deps = { getSim: () => state.current, ui };

    const run = runExportFlow(deps, () => {});
    await vi.advanceTimersByTimeAsync(EXPORT_WATCHDOG_MS);
    afterInvoke?.(state);
    gate.resolve(true);
    await run;
    return toasts;
  }

  function named(name: string) {
    const sim = Simulation.newGame(7);
    sim.tower.towerName = name;
    return sim;
  }

  /** The quoted span of a named late-success toast. */
  function quotedName(text: string) {
    return text.slice(LATE_PREFIX.length, -LATE_SUFFIX.length);
  }

  it("names the tower when the success lands after the watchdog gave up", async () => {
    const toasts = await lateSuccessToasts(named("Skyline Heights"));
    expect(toasts).toEqual([HUNG_TOAST, { text: `${LATE_PREFIX}Skyline Heights${LATE_SUFFIX}`, kind: "good" }]);
  });

  it("REGRESSION: the name is captured at invocation, never read back at settle", async () => {
    // Two ways a settle-time read drifts, both exercised here: the player
    // renames the exported tower and then loads a different one, so by settle
    // time the captured sim and getSim each answer something else. The file on
    // disk holds the tower as it was named when the player pressed Export.
    const first = named("First Tower");
    const toasts = await lateSuccessToasts(first, (state) => {
      first.tower.towerName = "Renamed Mid Flight";
      state.current = named("Second Tower");
    });
    expect(toasts[1].text).toBe(`${LATE_PREFIX}First Tower${LATE_SUFFIX}`);
  });

  it("drops the naming clause when the name sanitizes away, rather than inventing one", async () => {
    // Control characters (one C0, one C1) and whitespace only. A placeholder
    // inside quote marks would read as a tower the player actually named that.
    const toasts = await lateSuccessToasts(named(" " + String.fromCharCode(0x07, 0x9b) + "  "));
    expect(toasts[1]).toEqual({ text: "The earlier export finished. Check where you saved it.", kind: "good" });
  });

  it("keeps a name readable through control characters and doubled spaces", async () => {
    const messy = "Sky" + String.fromCharCode(0x07) + "line   Heights ";
    const toasts = await lateSuccessToasts(named(messy));
    expect(quotedName(toasts[1].text)).toBe("Skyline Heights");
  });

  it("drops a bidi override so it cannot reverse the rest of the sentence", async () => {
    // U+202E is a format character, not a C0/C1 control, and nothing later in
    // the toast terminates an override, so one that survived the sanitizer
    // would render everything after the quoted name right to left.
    const toasts = await lateSuccessToasts(named(String.fromCharCode(0x202e) + "Something"));
    expect(toasts[1].text).toBe(`${LATE_PREFIX}Something${LATE_SUFFIX}`);
  });

  it("drops the naming clause for a name of only zero width spaces", async () => {
    // Two U+200B characters have `length` 2, so a name made of them alone
    // would otherwise take the NAMED branch and render as empty quote marks,
    // reading as a tower somebody actually called that.
    const toasts = await lateSuccessToasts(named(String.fromCharCode(0x200b, 0x200b)));
    expect(toasts[1]).toEqual({ text: "The earlier export finished. Check where you saved it.", kind: "good" });
  });

  it("REGRESSION: a ZWJ emoji name survives whole (do not strip the whole Cf category)", async () => {
    // A family emoji is spelled with U+200D joiners, the rename input's
    // maxlength admits one, and every other surface renders it whole. A
    // blanket format-character strip would split it into separate glyphs here
    // and nowhere else, which is a new defect traded for the bidi fix.
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const toasts = await lateSuccessToasts(named(family));
    expect(quotedName(toasts[1].text)).toBe(family);
  });

  it("keeps the word break when a newline separates the words", async () => {
    // A newline is a control AND whitespace. Stripping controls before
    // collapsing whitespace deletes it and joins the words into "SkyHigh".
    const toasts = await lateSuccessToasts(named("Sky\nHigh"));
    expect(quotedName(toasts[1].text)).toBe("Sky High");
  });

  it("keeps the word break when a tab separates the words", async () => {
    const toasts = await lateSuccessToasts(named("Sky\tHigh"));
    expect(quotedName(toasts[1].text)).toBe("Sky High");
  });

  it("a non-string name takes the fallback rather than throwing the export away", async () => {
    // Reachable: `serialization.ts` assigns `data.towerName` from the file with
    // no coercion, and `SaveGame.exportFilename` reads it through `|| ""`, so a
    // null name from a hand-edited save survives to the capture here. Without
    // the guard the player would get "Export failed" in place of an export
    // that actually landed on disk.
    const sim = Simulation.newGame(7);
    (sim.tower as unknown as { towerName: unknown }).towerName = null;
    const toasts = await lateSuccessToasts(sim);
    expect(toasts[1]).toEqual({ text: "The earlier export finished. Check where you saved it.", kind: "good" });
  });

  it("turns a double quote in the name into an apostrophe so the quoting cannot nest", async () => {
    const toasts = await lateSuccessToasts(named('Bob "The Builder" Tower'));
    expect(toasts[1].text).toBe(`${LATE_PREFIX}Bob 'The Builder' Tower${LATE_SUFFIX}`);
  });

  it("caps a hand-edited name at 28 code points without splitting an astral emoji", async () => {
    // Only reachable from a save edited outside the game: the rename input
    // stops at 28 and TDT import at 24. Each of these is a surrogate PAIR, so
    // a cut by string index would leave a lone surrogate behind.
    const tall = String.fromCodePoint(0x1f3e2);
    const toasts = await lateSuccessToasts(named(tall.repeat(40)));
    const quoted = quotedName(toasts[1].text);
    expect(Array.from(quoted)).toHaveLength(28);
    expect(quoted).toBe(tall.repeat(27) + String.fromCharCode(0x2026));
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(quoted)).toBe(false);
  });

  it("leaves a name of exactly 28 code points whole", async () => {
    const toasts = await lateSuccessToasts(named("a".repeat(28)));
    expect(quotedName(toasts[1].text)).toBe("a".repeat(28));
  });

  it("REGRESSION: an export that still holds the latch keeps the plain wording", async () => {
    // The new branch stays confined to the post-watchdog case: an ordinary
    // export says what it has always said, name or no name.
    const store = storeWithExport(() => Promise.resolve(true));
    injectedStore = store.port;
    await prepareSaveStore();
    const { ui, toasts } = fakeUi();

    await runExportFlow(flowDeps(ui, named("Skyline Heights")), () => {});
    expect(toasts).toEqual([STORED_TOAST]);
  });

  it("REGRESSION: run ids stay unique across a reset, so neither run reads the other's latch", async () => {
    // `latchOwner !== run` now decides wording as well as reentry, so a
    // recycled run id inverts both branches: the older run would claim the
    // in-latch sentence and free the newer run's latch on its way out, and the
    // newer run would then answer with the late wording. Dispatch by suggested
    // filename so neither run depends on microtask ordering.
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    const store = storeWithExport((_id, _scope, name) => (name.startsWith("first") ? first.promise : second.promise));
    injectedStore = store.port;
    await prepareSaveStore();
    const { ui, toasts } = fakeUi();

    const runA = runExportFlow(flowDeps(ui, named("First Tower")), () => {});
    resetExportFlowForTests();
    const runB = runExportFlow(flowDeps(ui, named("Second Tower")), () => {});

    first.resolve(true);
    await runA;
    second.resolve(true);
    await runB;
    expect(toasts).toEqual([{ text: `${LATE_PREFIX}First Tower${LATE_SUFFIX}`, kind: "good" }, STORED_TOAST]);
  });
});

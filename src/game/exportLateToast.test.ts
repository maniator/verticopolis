import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SaveStorePort } from "../platform/saveStore";
import {
  HUNG_TOAST,
  LATE_PREFIX,
  LATE_SUFFIX,
  LATE_UNNAMED_TOAST,
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
const { runExportFlow, resetExportFlowForTests, toastDisplayName, hasVisibleInk, EXPORT_WATCHDOG_MS } =
  await import("./exportFlow");

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
    expect(toasts[1]).toEqual(LATE_UNNAMED_TOAST);
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
    expect(toasts[1]).toEqual(LATE_UNNAMED_TOAST);
  });

  it("REGRESSION: a word joiner name takes the fallback, through the whole flow", async () => {
    // U+2060 is the non-breaking sibling of U+200B and reproduced the empty
    // quote marks after the round that added U+200B by hand. Driven end to end
    // rather than through the sanitizer alone, so the fallback is pinned at
    // the toast the player reads.
    const toasts = await lateSuccessToasts(named(String.fromCharCode(0x2060)));
    expect(toasts[1]).toEqual(LATE_UNNAMED_TOAST);
  });

  it("REGRESSION: a Hangul filler name takes the fallback, through the whole flow", async () => {
    // U+3164 is `Lo`, so no rule about format characters can reach it. It is
    // the character invisible display names are usually built from, and it is
    // the one that proves the rule is a visible-ink test rather than a list.
    const toasts = await lateSuccessToasts(named(String.fromCharCode(0x3164)));
    expect(toasts[1]).toEqual(LATE_UNNAMED_TOAST);
  });

  it("REGRESSION: a ZWJ emoji name survives whole, through the whole flow", async () => {
    // A family emoji is spelled with U+200D joiners, the rename input's
    // maxlength admits one, and every other surface renders it whole. The
    // strip takes the format-character category with the joiners spared for
    // exactly this; sparing nothing would split the name into separate glyphs
    // here and nowhere else, a new defect traded for the bidi fix.
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
    expect(toasts[1]).toEqual(LATE_UNNAMED_TOAST);
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

/**
 * The visible-ink rule, exercised on the sanitizer directly (GH #774).
 *
 * The wiring from this function to the toast is pinned by the flow-driven
 * cases above, the two headline characters included. These cases pin the
 * CLASS, which is why they go straight at the function: the sweep walks whole
 * Unicode categories, and driving a hundred thousand names through the flow
 * would be far too slow to keep in the suite.
 *
 * Three earlier rounds shipped a deny list of invisible characters and every
 * review found the list short, so what is under test here is a rule rather
 * than a set of remembered code points. Every invisible character is built
 * from its code point for the same reason the module writes them as escapes:
 * as literals they are invisible in a diff.
 */
describe("visible-ink rule (GH #774)", () => {
  const chars = (...points: number[]) => String.fromCodePoint(...points);

  /**
   * Inkless, restated here rather than imported from the module under test.
   * The restatement is the point: narrowing the shipped rule then shows up as
   * a failure, where a shared constant would narrow the expectation alongside
   * it and stay green. U+2800 is separate because it belongs to no category
   * of invisibles.
   */
  const INKLESS_CATEGORIES = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Z}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}]$/u;
  const isInkless = (char: string) => INKLESS_CATEGORIES.test(char) || char === chars(0x2800);
  const hasInk = (text: string) => Array.from(text).some((char) => !isInkless(char));

  /** Names built only from characters that print nothing. Each row is a way
   *  past some generation of the deny list this rule replaced, and the
   *  category in each label is why a format-character rule could not reach
   *  it. */
  const INKLESS_NAMES: [string, string][] = [
    ["a word joiner, U+2060 (Cf)", chars(0x2060)],
    ["a Hangul filler, U+3164 (Lo)", chars(0x3164)],
    ["a Hangul choseong filler, U+115F (Lo)", chars(0x115f)],
    ["a Hangul jungseong filler, U+1160 (Lo)", chars(0x1160)],
    ["a halfwidth Hangul filler, U+FFA0 (Lo)", chars(0xffa0)],
    ["a braille pattern blank, U+2800 (So)", chars(0x2800)],
    ["a variation selector, U+FE0F (Mn)", chars(0xfe0f)],
    ["a supplementary variation selector, U+E0100 (Mn)", chars(0xe0100)],
    ["combining marks, U+0301 U+0302 U+0303 (Mn)", chars(0x0301, 0x0302, 0x0303)],
    ["joiners, U+200D twice (Cf, and spared by the strip)", chars(0x200d, 0x200d)],
    ["a non-joiner, U+200C (Cf, and spared by the strip)", chars(0x200c)],
    ["an unpaired surrogate, U+D800 (Cs)", chars(0xd800)],
    ["a private use character, U+E000 (Co)", chars(0xe000)],
    ["an unassigned code point, U+0378 (Cn)", chars(0x0378)],
    ["exotic spaces, U+2003 U+3000 U+00A0 (Z)", chars(0x2003, 0x3000, 0x00a0)],
    ["a soft hyphen, U+00AD (Cf)", chars(0x00ad)],
    ["an ideographic space and a word joiner", chars(0x3000, 0x2060)],
  ];

  it.each(INKLESS_NAMES)("has no ink in a name of %s", (_label, name) => {
    expect(toastDisplayName(name)).toBe("");
  });

  it("keeps an ordinary name exactly as written", () => {
    // The rule may only reject a name that prints nothing. Names outside the
    // Latin alphabet are here because the ink test is written in Unicode
    // categories, where one wrong category silently blanks a real name.
    for (const name of ["Skyline Heights", "Tower 7", "Le Chateau", "Zhong Yang Ta", "Migdal"]) {
      expect(toastDisplayName(name)).toBe(name);
    }
    const cjk = chars(0x4e2d, 0x592e, 0x5854);
    expect(toastDisplayName(cjk)).toBe(cjk);
  });

  it("states 'renders nothing' on its own, past what the cleaning steps already remove", () => {
    // Three of the rule's categories cannot reach it through the sanitizer:
    // the control strip takes `\p{Cc}`, the format strip takes every `\p{Cf}`
    // but the two joiners, and every `\p{Z}` is JavaScript `\s`, so the
    // collapse and the trim take those. Dropping any of the three would be
    // invisible to a test that only drives the sanitizer. Pinned here so the
    // rule stays a complete statement of what prints nothing, and so a later
    // reordering of the cleaning steps cannot un-cover a category. U+FFF9 and
    // U+0600 earn their place twice over: they are the format characters that
    // Unicode does NOT also mark default ignorable, so they are the only ones
    // `\p{Cf}` alone answers for.
    const inkless = [0x0007, 0x009b, 0x200b, 0x2060, 0x202e, 0xfff9, 0x0600, 0x0020, 0x00a0, 0x3000, 0x2028];
    for (const cp of inkless) {
      expect(hasVisibleInk(chars(cp))).toBe(false);
    }
    expect(hasVisibleInk("A")).toBe(true);
    expect(hasVisibleInk("")).toBe(false);
  });

  it("counts a spacing combining mark as ink, since it advances the pen", () => {
    // States the one judgment call in the inkless set as behavior. `\p{Mn}`
    // and `\p{Me}` are inkless because they have no width of their own, while
    // `\p{Mc}` is left out: a Devanagari vowel sign shows, so a name that
    // carries nothing else is still a name.
    const vowelSign = chars(0x093e);
    expect(toastDisplayName(vowelSign)).toBe(vowelSign);
  });

  it("REGRESSION: a ZWJ emoji name survives whole, joiners included", () => {
    // The one carve-out in the format-character strip. A family emoji is
    // spelled with U+200D joiners, and every other surface renders it whole,
    // so stripping the category outright would break the name here alone.
    const family = chars(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(toastDisplayName(family)).toBe(family);
    const nurse = chars(0x1f469, 0x200d, 0x2695, 0xfe0f);
    expect(toastDisplayName(nurse)).toBe(nurse);
  });

  it("strips every one of the 12 bidi controls out of a name that does have ink", () => {
    // The ink test does not stand in for this. A name with real letters can
    // still carry an override, and nothing later in the toast terminates one,
    // so the tail of the sentence would render reversed. Enumerated from the
    // Unicode property so the guard cannot go stale against a remembered list.
    const controls: string[] = [];
    for (let cp = 0; cp <= 0xffff; cp++) {
      const char = chars(cp);
      if (/\p{Bidi_Control}/u.test(char)) controls.push(char);
    }
    expect(controls).toHaveLength(12);
    for (const control of controls) {
      const cleaned = toastDisplayName(`Sky${control}line`);
      expect(cleaned).toBe("Skyline");
      expect(/\p{Bidi_Control}/u.test(cleaned)).toBe(false);
    }
  });

  it("PROPERTY: every code point that prints nothing takes the fallback on its own", () => {
    // What would have caught all three deny-list rounds at once, and the
    // reason this round stopped extending a list. The sweep covers the whole
    // BMP plus the two supplementary ranges that carry invisibles: the tag and
    // variation selector block, and the start of private use area A.
    const survivors: string[] = [];
    let swept = 0;
    for (const [from, to] of [
      [0, 0xffff],
      [0xe0000, 0xe01ff],
      [0xf0000, 0xf00ff],
    ]) {
      for (let cp = from; cp <= to; cp++) {
        const char = chars(cp);
        if (!isInkless(char)) continue;
        swept++;
        if (toastDisplayName(char) !== "") survivors.push("U+" + cp.toString(16).toUpperCase());
      }
    }
    expect(survivors).toEqual([]);
    // Guards the sweep itself: a filter that matched nothing would pass above.
    expect(swept).toBeGreaterThan(10_000);
  });

  it("PROPERTY: an inkless code point next to a letter never costs the letter", () => {
    // The other half of the rule. An invisible character is a reason to drop
    // the naming clause, never a reason to refuse a name that has something to
    // show. The last entry is a bidi override, which the strip removes while
    // the letters around it stay.
    const samples = [0x2060, 0x3164, 0x2800, 0xfe0f, 0x0301, 0x200d, 0x00ad, 0x202e];
    for (const cp of samples) {
      expect(toastDisplayName(`A${chars(cp)}B`)).toContain("A");
      expect(toastDisplayName(`A${chars(cp)}B`)).toContain("B");
    }
  });

  it("never quotes a span with no ink in it, truncated or not", () => {
    // The guarantee the rule makes, over both branches of the cap. The second
    // name is the awkward one: its only letter sits past the 28 code point
    // cap, so what gets quoted is invisible characters plus U+2026, and the
    // ellipsis is what keeps the promise there.
    const names = [
      "Skyline Heights",
      chars(0xfe0f).repeat(40) + "A",
      "A" + chars(0x0301).repeat(60),
      chars(0x1f3e2).repeat(40),
    ];
    for (const name of names) {
      const cleaned = toastDisplayName(name);
      expect(cleaned).not.toBe("");
      expect(hasInk(cleaned)).toBe(true);
    }
  });
});

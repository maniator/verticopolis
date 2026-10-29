import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToRelay } from "./analyticsRelay";
import { gameplaySession, startGameplaySession } from "./analytics";
import {
  ENGINE_BUILDS,
  ENGINE_KINDS,
  ENGINE_STATUS_FIELDS,
  ENGINE_STATUS_TRIGGERS,
  MAX_ENGINE_STATUS_ROWS,
  engineKind,
  flushEngineStatus,
  noteEngineFallback,
  noteEngineSettled,
  noteEngineWriterLatched,
} from "./analyticsEngineStatus";
import { FALLBACK_REASONS, FALLBACK_STAGES } from "./wasmhost/engineBoot";
import { APP_VERSION } from "./appVersion";

/**
 * The reliability instrument's rows (`engine_status`, issue #1081): when they
 * go out, what they carry, the cap, and the summary that keeps a capped loop's
 * size (the #841 check).
 */

vi.mock("@vercel/speed-insights", () => ({ injectSpeedInsights: vi.fn() }));
vi.mock("./analyticsRelay", () => ({ sendToRelay: vi.fn() }));

const prod = "https://verticopolis.com/";
const localhost = "http://localhost:3000/";

type Row = Record<string, unknown>;
const last = (xs: Row[]): Row | undefined => xs[xs.length - 1];

/** Every `engine_status` row the relay saw, in order. */
function rows(): Row[] {
  return vi
    .mocked(sendToRelay)
    .mock.calls.filter(([name]) => name === "engine_status")
    .map(([, props]) => props as Row);
}

const wasmSettle = { build: "switchable", requested: "wasm", failure: null } as const;

describe("engine_status rows", () => {
  beforeEach(() => {
    window.location.href = prod;
    gameplaySession.reset();
    vi.mocked(sendToRelay).mockReset();
  });

  afterEach(() => {
    window.location.href = localhost;
  });

  it("sends one settle row per page life, with the build's version and commit", () => {
    noteEngineSettled(wasmSettle);
    noteEngineSettled({ build: "switchable", requested: "ts", failure: null });
    expect(rows()).toHaveLength(1);
    const [row] = rows();
    expect(row).toMatchObject({
      trigger: "settle",
      engine_requested: "wasm",
      engine: "wasm",
      build: "switchable",
      fallback_reason: "none",
      fallback_stage: "none",
      fallbacks: 0,
      writer_latched: false,
      version: APP_VERSION,
      sha: __APP_SHA__,
    });
    expect(typeof row.page_life).toBe("string");
    expect((row.page_life as string).length).toBeGreaterThan(8);
  });

  it("carries exactly the fields the data map lists", () => {
    noteEngineSettled(wasmSettle);
    // The reset cleared the common props (the platform buckets), so the row
    // holds the event's own fields and nothing else.
    // `engaged_by` rides on `engaged` rows only.
    // `size_gated` only on a page life the size gate held (#1197).
    expect(Object.keys(rows()[0]).sort()).toEqual(ENGINE_STATUS_FIELDS.filter((f) => f !== "engaged_by" && f !== "size_gated").sort());
  });

  it("says size_gated on every row of a page life the size gate held, and never otherwise", () => {
    noteEngineSettled({ ...wasmSettle, boot: "ts", sizeGated: true });
    expect(rows()[0]).toMatchObject({ engine_requested: "wasm", engine: "ts", fallback_reason: "none", fallbacks: 0, size_gated: true });
  });

  it("reads a boot failure from the settle snapshot, as one fallback", () => {
    noteEngineSettled({ build: "switchable", requested: "wasm", failure: { stage: "load", reason: "boot-timeout" } });
    expect(rows()[0]).toMatchObject({ engine: "ts-fallback", fallback_reason: "boot-timeout", fallback_stage: "load", fallbacks: 1 });
    gameplaySession.reset();
    noteEngineSettled({ build: "wasm-only", requested: "wasm", failure: { stage: "start", reason: "attach-refused" } });
    expect(rows()[1]).toMatchObject({ engine: "none", fallback_reason: "attach-refused", fallback_stage: "start", fallbacks: 1, build: "wasm-only" });
  });

  it("does not send or count a fallback that comes before the settle row, which already holds it", () => {
    noteEngineFallback({ reason: "attach-refused", stage: "start" });
    expect(rows()).toHaveLength(0);
    noteEngineSettled({ build: "switchable", requested: "wasm", failure: { stage: "start", reason: "attach-refused" } });
    expect(rows()).toEqual([expect.objectContaining({ trigger: "settle", fallbacks: 1 })]);
  });

  it("sends a row for each later fallback, with the running count", () => {
    noteEngineSettled(wasmSettle);
    noteEngineFallback({ reason: "attach-refused", stage: "adopt" });
    noteEngineFallback({ reason: "attach-refused", stage: "undo" });
    expect(rows().slice(1)).toEqual([
      expect.objectContaining({ trigger: "fallback", engine: "ts-fallback", fallback_reason: "attach-refused", fallback_stage: "adopt", fallbacks: 1 }),
      expect.objectContaining({ trigger: "fallback", engine: "ts-fallback", fallback_reason: "attach-refused", fallback_stage: "undo", fallbacks: 2 }),
    ]);
    // One page life: every row shares its id.
    expect(new Set(rows().map((r) => r.page_life)).size).toBe(1);
  });

  it("keeps a capped loop's size: the next hide sends the true count (the #841 check)", () => {
    noteEngineSettled(wasmSettle);
    for (let i = 0; i < 50; i++) noteEngineFallback({ reason: "attach-refused", stage: "adopt" });
    // The settle row plus the cap.
    expect(rows()).toHaveLength(1 + MAX_ENGINE_STATUS_ROWS);
    expect(last(rows())).toMatchObject({ fallbacks: MAX_ENGINE_STATUS_ROWS });
    flushEngineStatus();
    expect(last(rows())).toMatchObject({ trigger: "summary", fallbacks: 50 });
    // Nothing new since: a second hide sends nothing.
    flushEngineStatus();
    expect(rows()).toHaveLength(2 + MAX_ENGINE_STATUS_ROWS);
    // More drops, another summary at the next hide.
    noteEngineFallback({ reason: "attach-refused", stage: "undo" });
    flushEngineStatus();
    expect(last(rows())).toMatchObject({ trigger: "summary", fallbacks: 51, fallback_stage: "undo" });
  });

  it("drops repeats only: a new reason and the latch-off still go out past the cap", () => {
    noteEngineSettled(wasmSettle);
    for (let i = 0; i < 20; i++) noteEngineFallback({ reason: "attach-refused", stage: "adopt" });
    expect(rows()).toHaveLength(1 + MAX_ENGINE_STATUS_ROWS);
    noteEngineFallback({ reason: "package-mismatch", stage: "adopt" });
    noteEngineWriterLatched();
    noteEngineFallback({ reason: "package-mismatch", stage: "undo" });
    expect(rows().slice(1 + MAX_ENGINE_STATUS_ROWS)).toEqual([
      expect.objectContaining({ trigger: "fallback", fallback_reason: "package-mismatch", fallbacks: 21 }),
      expect.objectContaining({ trigger: "writer-latch", writer_latched: true, fallbacks: 21 }),
    ]);
    // Every reason the page life hit reached a row, and the repeat dropped
    // after them is reported at the hide.
    expect(new Set(rows().map((r) => r.fallback_reason))).toEqual(new Set(["none", "attach-refused", "package-mismatch"]));
    flushEngineStatus();
    expect(last(rows())).toMatchObject({ trigger: "summary", fallbacks: 22, fallback_stage: "undo" });
  });

  it("sends no summary when nothing was dropped", () => {
    noteEngineSettled(wasmSettle);
    noteEngineFallback({ reason: "attach-refused", stage: "adopt" });
    flushEngineStatus();
    expect(rows().map((r) => r.trigger)).toEqual(["settle", "fallback"]);
  });

  it("wires the summary to the tab hide and the page hide", () => {
    // Remove the listeners afterwards, so no later test runs them.
    const added: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = [];
    const spies = [window, document].map((t: EventTarget) => {
      const add = t.addEventListener.bind(t);
      return vi.spyOn(t, "addEventListener").mockImplementation((type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (listener) added.push([t, type, listener]);
        add(type, listener);
      });
    });
    startGameplaySession();
    noteEngineSettled(wasmSettle);
    for (let i = 0; i < MAX_ENGINE_STATUS_ROWS + 3; i++) noteEngineFallback({ reason: "attach-refused", stage: "adopt" });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      expect(last(rows())).toMatchObject({ trigger: "summary", fallbacks: MAX_ENGINE_STATUS_ROWS + 3 });
      noteEngineFallback({ reason: "attach-refused", stage: "adopt" });
      window.dispatchEvent(new Event("pagehide"));
      expect(last(rows())).toMatchObject({ trigger: "summary", fallbacks: MAX_ENGINE_STATUS_ROWS + 4 });
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
      for (const [t, type, listener] of added) t.removeEventListener(type, listener);
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("reports the writer latch-off once, or in the settle row when it came first", () => {
    noteEngineSettled(wasmSettle);
    noteEngineWriterLatched();
    noteEngineWriterLatched();
    expect(rows().slice(1)).toEqual([expect.objectContaining({ trigger: "writer-latch", writer_latched: true, fallbacks: 0 })]);
    gameplaySession.reset();
    noteEngineWriterLatched();
    expect(rows()).toHaveLength(2);
    noteEngineSettled(wasmSettle);
    expect(last(rows())).toMatchObject({ trigger: "settle", writer_latched: true });
  });

  it("mints a new page-life id per page life and keeps it in memory only", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    noteEngineSettled(wasmSettle);
    const first = rows()[0].page_life;
    gameplaySession.reset(); // a reload, as far as this module knows
    noteEngineSettled(wasmSettle);
    expect(rows()[1].page_life).not.toBe(first);
    for (const [, value] of setItem.mock.calls) {
      expect(value).not.toContain(first as string);
      expect(value).not.toContain(rows()[1].page_life as string);
    }
    setItem.mockRestore();
  });

  it("sends only codes from the closed lists", () => {
    noteEngineSettled({ build: "switchable", requested: "wasm-worker", failure: { stage: "load", reason: "package-mismatch" } });
    noteEngineFallback({ reason: "attach-refused", stage: "adopt" });
    noteEngineWriterLatched();
    for (const row of rows()) {
      expect(ENGINE_STATUS_TRIGGERS).toContain(row.trigger);
      expect(["ts", "wasm", "wasm-frame", "wasm-worker"]).toContain(row.engine_requested);
      expect(ENGINE_KINDS).toContain(row.engine);
      expect(ENGINE_BUILDS).toContain(row.build);
      expect(FALLBACK_REASONS).toContain(row.fallback_reason);
      expect(FALLBACK_STAGES).toContain(row.fallback_stage);
      expect(Number.isInteger(row.fallbacks)).toBe(true);
      expect(typeof row.writer_latched).toBe("boolean");
    }
  });

  it("sends nothing off a real deployment", () => {
    window.location.href = localhost;
    noteEngineSettled(wasmSettle);
    noteEngineFallback({ reason: "attach-refused", stage: "adopt" });
    expect(sendToRelay).not.toHaveBeenCalled();
  });
});

describe("engineKind", () => {
  it("names what runs from the build, the request and whether it fell back", () => {
    expect(engineKind("switchable", "ts", false)).toBe("ts");
    expect(engineKind("switchable", "wasm", false)).toBe("wasm");
    expect(engineKind("switchable", "wasm-frame", false)).toBe("wasm-frame");
    expect(engineKind("switchable", "wasm-worker", false)).toBe("wasm-worker");
    expect(engineKind("switchable", "wasm", true)).toBe("ts-fallback");
    expect(engineKind("switchable", "wasm-worker", true)).toBe("ts-fallback");
    expect(engineKind("wasm-only", "wasm", false)).toBe("wasm");
    expect(engineKind("wasm-only", "wasm", true)).toBe("none");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installErrorTracking, reportCrashException, resetErrorTrackingForTest } from "./analyticsErrors";
import { sendException } from "./analyticsRelay";
import { telemetryHostAllowed } from "./telemetry";
import { getCommonProps } from "./analytics";

// The error reporter posts $exception straight through the relay's sendException
// (relay-only, never the dual-write adapter), gated on the shared host predicate,
// and enriched with the boot common props. Stub all three so these tests assert
// the reporter's own logic (dedup, cap, shape, never-throw) without a real beacon,
// a real host, or the enrichment pipeline.
vi.mock("./analyticsRelay", () => ({ sendException: vi.fn() }));
vi.mock("./telemetry", () => ({ telemetryHostAllowed: vi.fn(() => true) }));
vi.mock("./analytics", () => ({ getCommonProps: vi.fn(() => ({ platform: "web", version: "9.9.9" })) }));

/** Dispatch a window `error` event with an optional Error and location. */
function fireError(init: Partial<ErrorEventInit> = {}): void {
  window.dispatchEvent(new ErrorEvent("error", init));
}

/** Dispatch a window `unhandledrejection` with the given reason. jsdom has no
 *  PromiseRejectionEvent constructor, so build a plain Event and attach reason. */
function fireRejection(reason: unknown): void {
  const ev = new Event("unhandledrejection") as PromiseRejectionEvent;
  Object.defineProperty(ev, "reason", { value: reason, configurable: true });
  window.dispatchEvent(ev);
}

/** The properties of the Nth (default first) sendException call. */
function sentProps(n = 0): Record<string, unknown> {
  return vi.mocked(sendException).mock.calls[n]?.[0] as Record<string, unknown>;
}
/** The single exception object inside a sent $exception_list. */
function sentException(n = 0): Record<string, unknown> {
  return (sentProps(n).$exception_list as Record<string, unknown>[])[0];
}

describe("cookieless error tracking", () => {
  beforeEach(() => {
    vi.mocked(sendException).mockReset();
    vi.mocked(telemetryHostAllowed).mockReturnValue(true);
    vi.mocked(getCommonProps).mockReturnValue({ platform: "web", version: "9.9.9" });
    resetErrorTrackingForTest();
    installErrorTracking();
  });

  afterEach(() => {
    resetErrorTrackingForTest();
  });

  it("reports an uncaught Error as a canonical $exception with type, value, and raw stack", () => {
    const err = new TypeError("cannot read x");
    err.stack = "TypeError: cannot read x\n    at boom (app.js:5:9)";
    fireError({ error: err, message: err.message, filename: "app.js", lineno: 5, colno: 9 });

    expect(sendException).toHaveBeenCalledTimes(1);
    const props = sentProps();
    // Common props ride along (platform / build version).
    expect(props).toMatchObject({ platform: "web", version: "9.9.9", handled: false });
    expect(sentException()).toMatchObject({
      type: "TypeError",
      value: "cannot read x",
      mechanism: { handled: false, synthetic: false },
      stacktrace: { type: "raw", frames: [] },
    });
    expect(props.$exception_stack_trace_raw).toContain("at boom (app.js:5:9)");
    expect(props).toMatchObject({ source: "app.js", lineno: 5, colno: 9 });
  });

  it("carries a top-level $exception_type for dashboard breakdowns", () => {
    fireError({ error: new TypeError("nope"), message: "nope" });
    // A top-level copy of the type, so a trends breakdown need not reach into
    // the nested $exception_list.
    expect(sentProps().$exception_type).toBe("TypeError");
  });

  it("does not send when the host gate is closed", () => {
    vi.mocked(telemetryHostAllowed).mockReturnValue(false);
    fireError({ error: new Error("nope"), message: "nope" });
    expect(sendException).not.toHaveBeenCalled();
  });

  it("deduplicates a repeated identical error to a single report", () => {
    const make = () => {
      const e = new Error("loop crash");
      e.stack = "Error: loop crash\n    at frame (loop.js:1:1)";
      return e;
    };
    for (let i = 0; i < 50; i++) fireError({ error: make(), message: "loop crash" });
    expect(sendException).toHaveBeenCalledTimes(1);
  });

  it("caps the number of distinct errors reported per session", () => {
    for (let i = 0; i < 25; i++) fireError({ error: new Error(`distinct ${i}`), message: `distinct ${i}` });
    expect(sendException).toHaveBeenCalledTimes(10); // MAX_ERRORS_PER_SESSION
  });

  it("reports an unhandled promise rejection carrying an Error", () => {
    const err = new RangeError("out of range");
    err.stack = "RangeError: out of range\n    at r (p.js:2:2)";
    fireRejection(err);
    expect(sendException).toHaveBeenCalledTimes(1);
    expect(sentException()).toMatchObject({ type: "RangeError", value: "out of range" });
  });

  it("reports a non-Error rejection reason as a stringified UnhandledRejection", () => {
    fireRejection("just a string");
    expect(sendException).toHaveBeenCalledTimes(1);
    expect(sentException()).toMatchObject({ type: "UnhandledRejection", value: "just a string" });
    expect(sentProps().$exception_stack_trace_raw).toBe("");
  });

  it("skips a resource-load error (no error object and no message)", () => {
    // An <img>/<script> 404 surfaces as an error event with neither an `error`
    // nor a message; it is not a JS exception.
    fireError({});
    expect(sendException).not.toHaveBeenCalled();
  });

  it("reports a cross-origin script error that carries only a message", () => {
    fireError({ message: "Script error.", filename: "", lineno: 0, colno: 0 });
    expect(sendException).toHaveBeenCalledTimes(1);
    expect(sentException()).toMatchObject({ type: "Error", value: "Script error." });
  });

  it("bounds an oversized message and stack before sending", () => {
    const err = new Error("x".repeat(5_000));
    err.stack = "y".repeat(9_000);
    fireError({ error: err, message: err.message });
    const value = sentException().value as string;
    const stack = sentProps().$exception_stack_trace_raw as string;
    expect(value.length).toBeLessThanOrEqual(503); // 500 + the "..." marker
    expect(stack.length).toBeLessThanOrEqual(2_003);
  });

  it("never throws out of the handler on a malformed rejection reason", () => {
    const nasty = {
      get message() {
        throw new Error("boom in getter");
      },
      toString() {
        throw new Error("boom in toString");
      },
    };
    expect(() => fireRejection(nasty)).not.toThrow();
    // It still reports something (the unstringifiable fallback), never crashing.
    expect(sendException).toHaveBeenCalledTimes(1);
    expect(sentException()).toMatchObject({ type: "UnhandledRejection" });
  });

  it("keeps two errors with the same long message but different throw sites distinct", () => {
    // Regression guard: the fingerprint is built from bounded PARTS so the
    // throw-site frame always survives. A single joined-then-clamped fingerprint
    // would cut the frame off for a long message and wrongly merge the two.
    const longMsg = "validation failed for payload ".repeat(30); // > 300 chars
    const a = new Error(longMsg);
    a.stack = `Error: ${longMsg}\n    at siteA (a.js:1:1)`;
    const b = new Error(longMsg);
    b.stack = `Error: ${longMsg}\n    at siteB (b.js:2:2)`;
    fireError({ error: a, message: longMsg });
    fireError({ error: b, message: longMsg });
    expect(sendException).toHaveBeenCalledTimes(2); // distinct throw sites, distinct reports
  });

  it("bounds the exception type so a hostile error.name cannot blow the body cap", () => {
    const err = new Error("boom");
    err.name = "N".repeat(9_000);
    fireError({ error: err, message: "boom" });
    const type = sentException().type as string;
    expect(type.length).toBeLessThanOrEqual(103); // MAX_TYPE_LEN + the "..." marker
  });

  it("still reports and dedups an Error whose message getter throws", () => {
    const make = () => {
      const e = new Error("x");
      Object.defineProperty(e, "message", {
        get() {
          throw new Error("getter boom");
        },
      });
      return e;
    };
    // describe() must not throw (else the cap/dedup never engage and it loops):
    // the same hostile error fired twice collapses to a single report.
    expect(() => {
      fireError({ error: make(), message: "x" });
      fireError({ error: make(), message: "x" });
    }).not.toThrow();
    expect(sendException).toHaveBeenCalledTimes(1);
  });

  describe("reportCrashException (WebGL crash to Error Tracking)", () => {
    it("emits a synthetic $exception for a WebGL context loss with crash flags", () => {
      reportCrashException({ kind: "webgl-context-lost", repeat: false, recoveryFailed: true, saveFlushed: true, behindSplash: false });
      expect(sendException).toHaveBeenCalledTimes(1);
      const props = sentProps();
      expect(sentException()).toMatchObject({
        type: "WebGLContextLost",
        value: "WebGL context lost (recovery failed)",
        mechanism: { handled: true, synthetic: true },
      });
      // Top-level type + stable fingerprint (one issue for all WebGL losses),
      // empty raw stack (synthetic), and the crash flags as context.
      expect(props).toMatchObject({
        $exception_type: "WebGLContextLost",
        $exception_fingerprint: "WebGLContextLost",
        $exception_stack_trace_raw: "",
        handled: true,
        crash_kind: "webgl-context-lost",
        recoveryFailed: true,
        saveFlushed: true,
        repeat: false,
        behindSplash: false,
      });
      // Common props ride along, like every event.
      expect(props).toMatchObject({ platform: "web", version: "9.9.9" });
    });

    it("groups repeated WebGL losses into one issue (dedup on the stable fingerprint)", () => {
      reportCrashException({ kind: "webgl-context-lost" });
      reportCrashException({ kind: "webgl-context-lost", repeat: true });
      expect(sendException).toHaveBeenCalledTimes(1);
    });

    it("does not report a crash exception on a dark host", () => {
      vi.mocked(telemetryHostAllowed).mockReturnValue(false);
      reportCrashException({ kind: "webgl-context-lost" });
      expect(sendException).not.toHaveBeenCalled();
    });

    it("never throws on malformed crash info", () => {
      expect(() => reportCrashException({} as unknown as { kind: string })).not.toThrow();
    });
  });

  it("registers its listeners only once across repeated install calls", () => {
    // Assert the idempotency guard DIRECTLY by counting addEventListener, not via
    // the send count: a repeated dispatch to duplicate listeners would still
    // collapse to one report through the fingerprint dedup, so a send-count
    // assertion passes even if the guard breaks. Start from a clean install state
    // so the count is from zero.
    resetErrorTrackingForTest();
    const addSpy = vi.spyOn(window, "addEventListener");
    installErrorTracking();
    installErrorTracking();
    installErrorTracking();
    const errorAdds = addSpy.mock.calls.filter(([type]) => type === "error").length;
    const rejectionAdds = addSpy.mock.calls.filter(([type]) => type === "unhandledrejection").length;
    expect(errorAdds).toBe(1); // three install calls, one listener each
    expect(rejectionAdds).toBe(1);
    addSpy.mockRestore();
  });
});

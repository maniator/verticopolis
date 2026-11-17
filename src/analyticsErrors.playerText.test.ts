import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installErrorTracking, resetErrorTrackingForTest } from "./analyticsErrors";
import { addPlayerTextSource, PLAYER_TEXT_PLACEHOLDER as P, rememberPlayerText, resetPlayerTextForTest } from "./analyticsPlayerText";
import { sendException } from "./analyticsRelay";

// #607: a `$exception` never carries player text the game knows about. The relay,
// the host gate and the common props are stubbed as in analyticsErrors.test.ts;
// the scrubber is the real one, since it is what these tests are about.
vi.mock("./analyticsRelay", () => ({ sendException: vi.fn() }));
vi.mock("./telemetry", () => ({ telemetryHostAllowed: vi.fn(() => true) }));
vi.mock("./analytics", () => ({ getCommonProps: vi.fn(() => ({ platform: "web" })) }));

function fireError(init: Partial<ErrorEventInit> = {}): void {
  window.dispatchEvent(new ErrorEvent("error", init));
}

function fireRejection(reason: unknown): void {
  const ev = new Event("unhandledrejection") as PromiseRejectionEvent;
  Object.defineProperty(ev, "reason", { value: reason, configurable: true });
  window.dispatchEvent(ev);
}

function sent(n = 0): Record<string, unknown> {
  return vi.mocked(sendException).mock.calls[n]?.[0] as Record<string, unknown>;
}

function value(n = 0): unknown {
  return (sent(n).$exception_list as { value: unknown }[])[0].value;
}

/** Every string the report sends, so a test can say a name is in none of them. */
function sentText(n = 0): string {
  return JSON.stringify(sent(n));
}

describe("$exception scrubs player text (#607)", () => {
  beforeEach(() => {
    vi.mocked(sendException).mockReset();
    resetPlayerTextForTest();
    resetErrorTrackingForTest();
    installErrorTracking();
  });

  afterEach(() => {
    resetErrorTrackingForTest();
    resetPlayerTextForTest();
  });

  it("replaces the open tower's name in the type, message, stack, source and fingerprint", () => {
    addPlayerTextSource(() => ["Harmony Tower"]);
    const err = new Error('A tower named "Harmony Tower" already exists.');
    err.name = "Harmony Tower Error";
    err.stack = `${err.name}: ${err.message}\n    at save (https://verticopolis.com/Harmony Tower.js:1:2)`;
    fireError({ error: err, filename: "https://verticopolis.com/Harmony Tower.js", lineno: 1, colno: 2 });

    expect(sendException).toHaveBeenCalledOnce();
    expect(sentText()).not.toMatch(/harmony/i);
    expect(value()).toBe(`A tower named "${P}" already exists.`);
    expect(sent().$exception_type).toBe(`${P} Error`);
    expect(sent().$exception_stack_trace_raw).toContain(`at save (https://verticopolis.com/${P}.js:1:2)`);
    expect(sent().source).toBe(`https://verticopolis.com/${P}.js`);
    expect(sent().$exception_fingerprint).toBe(`${P} Error|A tower named "${P}" already exists.|at save (https://verticopolis.com/${P}.js:1:2)`);
  });

  it("replaces remembered text in a rejection that is not an Error", () => {
    rememberPlayerText("Old Spire");
    fireRejection("could not open Old Spire");
    expect(value()).toBe(`could not open ${P}`);
  });

  it("blanks the save text a browser's JSON error echoes, in the message and the stack", () => {
    const err = new SyntaxError(`Unexpected token 'S', "Spire wit"... is not valid JSON`);
    err.stack = `SyntaxError: ${err.message}\n    at JSON.parse (<anonymous>)`;
    fireError({ error: err });
    expect(sentText()).not.toContain("Spire");
    expect(value()).toBe(`Unexpected token "${P}", "${P}"... is not valid JSON`);
    expect(sent().$exception_stack_trace_raw).toBe(`SyntaxError: ${value()}\n    at JSON.parse (<anonymous>)`);
  });

  it("replaces a name the 500-character clamp would cut in half", () => {
    addPlayerTextSource(() => ["Harmony Tower"]);
    // "Harmony Tower" starts at 495, so the clamp at 500 would leave "Harmo".
    fireError({ error: new Error(`${"x".repeat(494)} Harmony Tower`) });
    expect(sentText()).not.toContain("Harmo");
    expect(value()).toBe(`${"x".repeat(494)} ${P.slice(0, 5)}...`);
  });

  it("reads the sources once for a report that is sent, and never for a repeat it drops", () => {
    const source = vi.fn(() => ["Spire"]);
    addPlayerTextSource(source);
    const err = new Error("Spire broke");
    err.stack = "Error: Spire broke\n    at tick (app.js:1:1)";
    for (let i = 0; i < 5; i++) fireError({ error: err });
    expect(sendException).toHaveBeenCalledOnce();
    expect(source).toHaveBeenCalledOnce();
  });

  it("still reports when a source throws", () => {
    addPlayerTextSource(() => {
      throw new Error("engine gone");
    });
    addPlayerTextSource(() => ["Spire"]);
    fireError({ error: new Error("Spire broke") });
    expect(value()).toBe(`${P} broke`);
  });

  it("sends a message with no player text as it is", () => {
    addPlayerTextSource(() => ["Spire"]);
    fireError({ error: new TypeError("Cannot read properties of undefined (reading 'floors')") });
    expect(value()).toBe("Cannot read properties of undefined (reading 'floors')");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleIngest,
  MAX_BODY_BYTES,
  RateLimiter,
  READ_DEADLINE_MS,
  ReadDeadlineError,
  readCappedText,
  type IngestDeps,
} from "./analyticsIngest";

/**
 * The ingest read deadline (GH #1010): the byte cap bounds memory, and this
 * bounds time, so a body that drips in under the cap cannot hold the function
 * open until the platform timeout.
 */

/** A body stream that sends `chunks` one per pull, then stalls forever, and
 *  records whether the reader cancelled it. */
function drip(chunks: string[]) {
  const encoder = new TextEncoder();
  let sent = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent < chunks.length) controller.enqueue(encoder.encode(chunks[sent++]));
        // Otherwise never enqueue or close: the next read waits forever.
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { body, cancelled: () => cancelled };
}

function requestWith(body: ReadableStream<Uint8Array> | null): Request {
  return { method: "POST", headers: { get: () => null }, body } as unknown as Request;
}

function makeDeps(): IngestDeps & { fetchImpl: ReturnType<typeof vi.fn> } {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  return {
    key: "phc_test_key",
    host: "https://us.i.posthog.com",
    environment: "production",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    waitUntil: vi.fn(),
    now: () => 1_000,
    clientIp: "203.0.113.7",
    rateLimiter: new RateLimiter(),
  } as unknown as IngestDeps & { fetchImpl: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("readCappedText deadline (GH #1010)", () => {
  it("throws ReadDeadlineError and cancels the stream when the body stalls past the deadline", async () => {
    vi.useFakeTimers();
    const stream = drip(['{"event":"bo']);
    const read = readCappedText(requestWith(stream.body), MAX_BODY_BYTES);
    const settled = expect(read).rejects.toBeInstanceOf(ReadDeadlineError);
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS);
    await settled;
    expect(stream.cancelled()).toBe(true);
  });

  it("does not fire one millisecond early", async () => {
    vi.useFakeTimers();
    const stream = drip([]);
    let outcome = "pending";
    readCappedText(requestWith(stream.body), MAX_BODY_BYTES).then(
      () => (outcome = "resolved"),
      () => (outcome = "rejected"),
    );
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS - 1);
    expect(outcome).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe("rejected");
  });

  it("leaves no timer behind once a body finishes in time", async () => {
    vi.useFakeTimers();
    const text = await readCappedText(new Request("https://x.test/", { method: "POST", body: "{}" }), MAX_BODY_BYTES);
    expect(text).toBe("{}");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves no timer behind when the cap answers first", async () => {
    vi.useFakeTimers();
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    const text = await readCappedText(new Request("https://x.test/", { method: "POST", body: big }), MAX_BODY_BYTES);
    expect(text).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cuts off a steady drip: every chunk arrives in time, but the whole read does not", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let cancelled = false;
    // One byte a second, forever, under any idle timeout but past the whole-read deadline.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              if (!cancelled) controller.enqueue(encoder.encode(" "));
              resolve();
            }, 1_000);
          });
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const read = readCappedText(requestWith(body), MAX_BODY_BYTES);
    const settled = expect(read).rejects.toBeInstanceOf(ReadDeadlineError);
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS);
    await settled;
    expect(cancelled).toBe(true);
  });

  it("honors a caller's own deadline", async () => {
    vi.useFakeTimers();
    const read = readCappedText(requestWith(drip([]).body), MAX_BODY_BYTES, 50);
    const settled = expect(read).rejects.toBeInstanceOf(ReadDeadlineError);
    await vi.advanceTimersByTimeAsync(50);
    await settled;
  });
});

describe("handleIngest read deadline (GH #1010)", () => {
  it("answers 408 and forwards nothing when the body stalls past the deadline", async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const stream = drip(['{"event":', '"boot"']);
    const res = handleIngest(requestWith(stream.body), deps);
    await vi.advanceTimersByTimeAsync(READ_DEADLINE_MS);
    expect((await res).status).toBe(408);
    expect(stream.cancelled()).toBe(true);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("answers 400 for a stream that errors before the deadline", async () => {
    const deps = makeDeps();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("client went away"));
      },
    });
    expect((await handleIngest(requestWith(body), deps)).status).toBe(400);
  });
});

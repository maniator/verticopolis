import { describe, expect, it, vi } from "vitest";
import {
  buildCaptureBody,
  handleIngest,
  MAX_BODY_BYTES,
  originAllowed,
  RateLimiter,
  type IngestDeps,
} from "./analyticsIngest";

const HOST = "https://us.i.posthog.com";
const KEY = "phc_test_key";

/** A POST Request to the relay, with an optional raw (possibly invalid) body. */
function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://verticopolis.com/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
}

/** Deps wired to spies, with a fresh limiter so tests never share window state. */
function makeDeps(over: Partial<IngestDeps> = {}): IngestDeps & {
  fetchImpl: ReturnType<typeof vi.fn>;
  waitUntil: ReturnType<typeof vi.fn>;
} {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const waitUntil = vi.fn();
  return {
    key: KEY,
    host: HOST,
    environment: "production",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    waitUntil,
    now: () => 1_000,
    clientIp: "203.0.113.7",
    rateLimiter: new RateLimiter(),
    ...over,
  } as IngestDeps & { fetchImpl: ReturnType<typeof vi.fn>; waitUntil: ReturnType<typeof vi.fn> };
}

/** Parse the JSON body the relay forwarded to PostHog. */
function forwardedBody(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchImpl.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string);
}

describe("handleIngest", () => {
  it("rejects a non-POST method with 405 and never forwards", async () => {
    const deps = makeDeps();
    const res = await handleIngest(new Request("https://verticopolis.com/api/ingest"), deps);
    expect(res.status).toBe(405);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a cross-site Origin with 403 before doing any work", async () => {
    // `Origin` is a forbidden header to set on a real Request (the browser sets
    // it), so drive the guard with a minimal request. The json spy proves the
    // cross-site POST is rejected before the body is even parsed.
    const deps = makeDeps();
    const json = vi.fn();
    const req = {
      method: "POST",
      headers: { get: (n: string) => (n === "origin" ? "https://evil.example" : null) },
      json,
    } as unknown as Request;
    const res = await handleIngest(req, deps);
    expect(res.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("allows a same-origin POST whose Origin header is ours", async () => {
    const deps = makeDeps();
    const req = {
      method: "POST",
      headers: { get: (n: string) => (n === "origin" ? "https://verticopolis.com" : null) },
      json: async () => ({ event: "boot" }),
    } as unknown as Request;
    const res = await handleIngest(req, deps);
    expect(res.status).toBe(204);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("no-ops with 204 when the PostHog secrets are absent", async () => {
    for (const missing of [{ key: undefined }, { host: undefined }]) {
      const deps = makeDeps(missing);
      const res = await handleIngest(postRequest({ event: "boot" }), deps);
      expect(res.status).toBe(204);
      expect(deps.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("rejects an over-limit burst with 429 before forwarding", async () => {
    const deps = makeDeps({ rateLimiter: new RateLimiter(2, 60_000) });
    const first = await handleIngest(postRequest({ event: "boot" }), deps);
    const second = await handleIngest(postRequest({ event: "boot" }), deps);
    const third = await handleIngest(postRequest({ event: "boot" }), deps);
    expect([first.status, second.status, third.status]).toEqual([204, 204, 429]);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses the module's default limiter when none is injected", async () => {
    const deps = makeDeps({ rateLimiter: undefined, clientIp: "198.51.100.42" });
    const res = await handleIngest(postRequest({ event: "boot" }), deps);
    expect(res.status).toBe(204);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized body with 413 before parsing", async () => {
    const deps = makeDeps();
    // `content-length` is a forbidden header to set on a real Request (the
    // platform controls it, and Vercel always sends it), so drive the guard with
    // a minimal request exposing exactly the fields the handler reads. The
    // `json` spy proves the oversized body is rejected before it is parsed.
    const json = vi.fn().mockResolvedValue({ event: "boot" });
    const req = {
      method: "POST",
      headers: { get: (name: string) => (name === "content-length" ? String(MAX_BODY_BYTES + 1) : null) },
      json,
    } as unknown as Request;
    const res = await handleIngest(req, deps);
    expect(res.status).toBe(413);
    expect(json).not.toHaveBeenCalled();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unparseable body with 400", async () => {
    const deps = makeDeps();
    const res = await handleIngest(postRequest("{not valid json"), deps);
    expect(res.status).toBe(400);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-object body with 400", async () => {
    const deps = makeDeps();
    for (const body of [42, "a string", [1, 2], null]) {
      expect((await handleIngest(postRequest(body), deps)).status).toBe(400);
    }
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a missing, empty, or whitespace-only event name with 400", async () => {
    const deps = makeDeps();
    expect((await handleIngest(postRequest({ properties: {} }), deps)).status).toBe(400);
    expect((await handleIngest(postRequest({ event: "" }), deps)).status).toBe(400);
    expect((await handleIngest(postRequest({ event: "   " }), deps)).status).toBe(400);
    expect((await handleIngest(postRequest({ event: 7 }), deps)).status).toBe(400);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a present-but-non-object properties with 400", async () => {
    const deps = makeDeps();
    expect((await handleIngest(postRequest({ event: "boot", properties: "x" }), deps)).status).toBe(400);
    expect((await handleIngest(postRequest({ event: "boot", properties: [1] }), deps)).status).toBe(400);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards a valid event to PostHog capture with the key server-side", async () => {
    const deps = makeDeps();
    const res = await handleIngest(
      postRequest({ event: "star_reached", properties: { star: 3 }, session: "sess-1", ts: "2026-07-22T00:00:00.000Z" }),
      deps,
    );
    expect(res.status).toBe(204);
    // 204 returns immediately; the forward is handed to waitUntil, not awaited.
    expect(deps.waitUntil).toHaveBeenCalledTimes(1);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = deps.fetchImpl.mock.calls[0];
    expect(url).toBe("https://us.i.posthog.com/capture/");
    expect((init as RequestInit).method).toBe("POST");
    const sent = forwardedBody(deps.fetchImpl);
    expect(sent.api_key).toBe(KEY); // the key is added server-side, at the forward
    expect(sent.event).toBe("star_reached");
    expect(sent.timestamp).toBe("2026-07-22T00:00:00.000Z");
    expect(sent.properties).toMatchObject({
      star: 3,
      distinct_id: "sess-1",
      $process_person_profile: false,
      environment: "production",
    });
  });

  it("trims the event name before forwarding", async () => {
    const deps = makeDeps();
    await handleIngest(postRequest({ event: "  boot  " }), deps);
    expect(forwardedBody(deps.fetchImpl).event).toBe("boot");
  });

  it("normalizes a host with surrounding whitespace and trailing slashes", async () => {
    // Env vars often pick up stray whitespace from a copy/paste; without trimming
    // the forward URL would be invalid and the event silently dropped.
    const deps = makeDeps({ host: "  https://us.i.posthog.com//  " });
    await handleIngest(postRequest({ event: "boot" }), deps);
    expect(deps.fetchImpl.mock.calls[0][0]).toBe("https://us.i.posthog.com/capture/");
  });

  it("never lets the client override the server-authoritative fields", async () => {
    const deps = makeDeps({ environment: "preview" });
    await handleIngest(
      postRequest({
        event: "boot",
        session: "real-session",
        // A hostile client tries to spoof identity, flip the person-profile
        // posture, and mislabel the environment through its own props.
        properties: {
          distinct_id: "spoofed",
          $process_person_profile: true,
          environment: "production",
        },
      }),
      deps,
    );
    const sent = forwardedBody(deps.fetchImpl);
    expect(sent.properties).toMatchObject({
      distinct_id: "real-session",
      $process_person_profile: false,
      environment: "preview",
    });
  });

  it("does not echo the key and sets no cookie", async () => {
    const deps = makeDeps();
    const res = await handleIngest(postRequest({ event: "boot" }), deps);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe(""); // empty body, nothing to leak
  });

  it("swallows an async forward failure so PostHog being down never surfaces", async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockRejectedValueOnce(new Error("posthog down"));
    const res = await handleIngest(postRequest({ event: "boot" }), deps);
    expect(res.status).toBe(204);
    // The rejected forward promise handed to waitUntil is already caught.
    await expect(deps.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("swallows a synchronous forward throw so a bad host never 500s the request", async () => {
    const deps = makeDeps();
    deps.fetchImpl.mockImplementationOnce(() => {
      throw new TypeError("Invalid URL");
    });
    const res = await handleIngest(postRequest({ event: "boot" }), deps);
    expect(res.status).toBe(204); // the throw is caught, the 204 still returns
    expect(deps.waitUntil).not.toHaveBeenCalled();
  });

  it("logs a failed PostHog forward (non-2xx) to the server console, status only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const deps = makeDeps();
      // A wrong key returns a 401 that `fetch` resolves (does not reject), so this
      // is the only place it would otherwise fail silently.
      deps.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 401 }));
      await handleIngest(postRequest({ event: "boot" }), deps);
      await deps.waitUntil.mock.calls[0][0]; // let the forward settle
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain("401");
      expect(message).not.toContain(KEY); // never log the key
    } finally {
      warn.mockRestore();
    }
  });

  it("does not log when the PostHog forward succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const deps = makeDeps(); // default fetch resolves a 200
      await handleIngest(postRequest({ event: "boot" }), deps);
      await deps.waitUntil.mock.calls[0][0];
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("buildCaptureBody", () => {
  it("omits timestamp when the client sent none, letting PostHog default it", () => {
    const body = buildCaptureBody({ event: "boot" }, "production");
    expect("timestamp" in body).toBe(false);
    expect(body.properties.distinct_id).toBe("anon"); // no session -> anon bucket
  });

  it("omits an invalid timestamp and falls back to anon for an empty session", () => {
    const body = buildCaptureBody({ event: "boot", session: "", ts: "not-a-date" }, "production");
    expect("timestamp" in body).toBe(false);
    expect(body.properties.distinct_id).toBe("anon");
  });

  it("drops a non-object properties rather than spreading junk keys", () => {
    const body = buildCaptureBody({ event: "boot", properties: "junk" as unknown }, "production");
    expect(body.properties).toEqual({
      distinct_id: "anon",
      $process_person_profile: false,
      environment: "production",
    });
  });

  it("keeps client props and stamps the server fields last", () => {
    const body = buildCaptureBody(
      { event: "boot", session: "s1", ts: "2026-07-22T00:00:00.000Z", properties: { mode: "modern" } },
      "preview",
    );
    expect(body).toEqual({
      event: "boot",
      timestamp: "2026-07-22T00:00:00.000Z",
      properties: {
        mode: "modern",
        distinct_id: "s1",
        $process_person_profile: false,
        environment: "preview",
      },
    });
  });

  it("falls back to an unknown environment when VERCEL_ENV is absent", () => {
    const body = buildCaptureBody({ event: "boot" }, undefined);
    expect(body.properties.environment).toBe("unknown");
  });
});

describe("originAllowed", () => {
  it("allows the custom domain and our own subdomains in every environment", () => {
    expect(originAllowed("https://verticopolis.com", "production")).toBe(true);
    expect(originAllowed("https://verticopolis.com", "preview")).toBe(true);
    // A custom-suffix preview deployment (*.preview.verticopolis.com) is ours.
    expect(originAllowed("https://branch.preview.verticopolis.com", "production")).toBe(true);
    expect(originAllowed("https://branch.preview.verticopolis.com", "preview")).toBe(true);
    // The canonical absolute FQDN (trailing dot) is matched like the usual form.
    expect(originAllowed("https://verticopolis.com.", "production")).toBe(true);
  });

  it("trusts *.vercel.app only outside production", () => {
    // A preview deployment's own origin is <branch>.vercel.app: allowed there.
    expect(originAllowed("https://feature-branch.vercel.app", "preview")).toBe(true);
    expect(originAllowed("https://feature-branch.vercel.app", "development")).toBe(true);
    // In production the shared *.vercel.app suffix is NOT trusted: it is common to
    // every Vercel customer, so any site on it would otherwise pass.
    expect(originAllowed("https://someone-else.vercel.app", "production")).toBe(false);
    // An absent/empty VERCEL_ENV fails CLOSED: without knowing we are
    // non-production, the shared suffix is refused rather than trusted.
    expect(originAllowed("https://feature-branch.vercel.app", undefined)).toBe(false);
    expect(originAllowed("https://feature-branch.vercel.app", "")).toBe(false);
  });

  it("allows an absent Origin (non-browser client or curl smoke test)", () => {
    expect(originAllowed(null, "production")).toBe(true);
  });

  it("rejects a foreign, look-alike, or malformed Origin", () => {
    expect(originAllowed("https://evil.example", "production")).toBe(false);
    expect(originAllowed("https://verticopolis.com.evil.example", "production")).toBe(false);
    expect(originAllowed("https://verticopolis.com.evil.example", "preview")).toBe(false);
    expect(originAllowed("not a url", "preview")).toBe(false);
  });

  it("rejects a prefix-glued look-alike (the dot boundary matters)", () => {
    // The leading dot in `.verticopolis.com` is load-bearing: without it these
    // would wrongly pass. Lock the boundary so a future edit dropping the dot
    // fails here rather than silently accepting a look-alike origin.
    expect(originAllowed("https://evilverticopolis.com", "production")).toBe(false);
    expect(originAllowed("https://evilverticopolis.com", "preview")).toBe(false);
    expect(originAllowed("https://notverticopolis.com", "production")).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows up to the max per window, then blocks", () => {
    const limiter = new RateLimiter(3, 1_000);
    expect([0, 0, 0, 0].map(() => limiter.allow("ip", 100))).toEqual([true, true, true, false]);
  });

  it("resets once the window elapses", () => {
    const limiter = new RateLimiter(1, 1_000);
    expect(limiter.allow("ip", 0)).toBe(true);
    expect(limiter.allow("ip", 500)).toBe(false); // same window
    expect(limiter.allow("ip", 1_000)).toBe(true); // window rolled over
  });

  it("tracks each IP independently", () => {
    const limiter = new RateLimiter(1, 1_000);
    expect(limiter.allow("a", 0)).toBe(true);
    expect(limiter.allow("b", 0)).toBe(true);
    expect(limiter.allow("a", 0)).toBe(false);
  });

  it("bounds memory by evicting the least-recently-touched key (LRU)", () => {
    // Ceiling of 2 keys. "a" stays hot, so it must survive eviction while the
    // idle key is dropped, and the map never exceeds the cap.
    const limiter = new RateLimiter(3, 60_000, 2);
    limiter.allow("a", 0); // a: count 1, order [a]
    limiter.allow("a", 0); // a: count 2, touched -> still newest [a]
    limiter.allow("b", 0); // b: count 1, order [a, b]
    limiter.allow("a", 0); // a: count 3 (== max), touched -> order [b, a]
    limiter.allow("c", 0); // at cap: evict oldest "b", order [a, c]
    // "a" was hot, so it survived with its window intact and is now at the limit.
    expect(limiter.allow("a", 0)).toBe(false);
    // "b" was the idle key, so it was evicted and starts a fresh window.
    expect(limiter.allow("b", 0)).toBe(true);
  });
});

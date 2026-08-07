import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopCaptureBody,
  DESKTOP_DISTRIBUTION_CHANNELS,
  DESKTOP_ORIGIN,
  desktopOriginAllowed,
  handleDesktopIngest,
  handleIngest,
  MAX_BODY_BYTES,
  originAllowed,
  RATE_LIMIT_MAX,
  RateLimiter,
  type IngestDeps,
} from "./analyticsIngest";
import { DISTRIBUTION_CHANNEL_LABELS, PLATFORM_LABELS } from "./analyticsEnrichment";

/**
 * The desktop ingest route (`POST /api/ingest/desktop`, issue #781). Its
 * pipeline is shared with the web relay, so these tests cover the shared path
 * again on this route (a future change that forgot one route would pass
 * `analyticsIngest.test.ts` and fail here) plus the three things only this route
 * does: its own origin forms, the server-authored `platform` and
 * `distribution_channel`, and a `text/plain` body.
 */

const HOST = "https://us.i.posthog.com";
const KEY = "phc_test_key";

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
    clientIp: "203.0.113.9",
    rateLimiter: new RateLimiter(),
    ...over,
  } as IngestDeps & { fetchImpl: ReturnType<typeof vi.fn>; waitUntil: ReturnType<typeof vi.fn> };
}

/** A POST whose `Origin` is exactly `origin` (null for an absent header).
 *  `Origin` is a forbidden header to set on a real Request (the browser sets it),
 *  so the guard is driven with a minimal request exposing only what the handler
 *  reads. The `json` spy also proves what is rejected before the body is read. */
function originRequest(
  origin: string | null,
  body: unknown = { event: "boot" },
): Request & { json: ReturnType<typeof vi.fn> } {
  const json = vi.fn().mockResolvedValue(body);
  return {
    method: "POST",
    headers: { get: (name: string) => (name === "origin" ? origin : null) },
    json,
  } as unknown as Request & { json: ReturnType<typeof vi.fn> };
}

/** A real POST Request (absent Origin), so a real body and content type are
 *  parsed by the platform rather than by a stub. */
function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return new Request("https://verticopolis.com/api/ingest/desktop", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
}

/** The properties of the capture body the relay forwarded to PostHog. */
function forwardedProps(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchImpl.mock.calls[0][1] as RequestInit;
  return (JSON.parse(init.body as string) as { properties: Record<string, unknown> }).properties;
}

describe("desktopOriginAllowed", () => {
  it("accepts the shell's own origin", () => {
    expect(desktopOriginAllowed(DESKTOP_ORIGIN)).toBe(true);
    expect(DESKTOP_ORIGIN).toBe("app://game");
  });

  it("accepts the literal opaque origin string", () => {
    // A custom scheme can serialize as an opaque origin, and a `no-cors` post
    // lands here too, so "null" is a form the shell really sends.
    expect(desktopOriginAllowed("null")).toBe(true);
  });

  it("accepts an absent Origin header", () => {
    expect(desktopOriginAllowed(null)).toBe(true);
  });

  it("rejects every other origin, including our own web hosts", () => {
    for (const origin of [
      "https://verticopolis.com",
      "https://branch.preview.verticopolis.com",
      "https://feature-branch.vercel.app",
      "https://evil.example",
      "app://evil",
      "app://game/",
      "app://game.evil.example",
      "APP://GAME",
      "not a url",
      "", // an empty header is not an absent header
      "NULL",
    ]) {
      expect(desktopOriginAllowed(origin)).toBe(false);
    }
  });

  it("stays separate from the web guard, which still refuses the shell", () => {
    // The two predicates must never be folded together: if `originAllowed` ever
    // learned the shell's origin, widening the desktop route would widen the web
    // one. Checked in every environment posture the web guard branches on.
    for (const environment of ["production", "preview", "development", "", undefined]) {
      expect(originAllowed(DESKTOP_ORIGIN, environment)).toBe(false);
    }
    expect(originAllowed("null", "production")).toBe(false);
  });
});

describe("buildDesktopCaptureBody", () => {
  it("stamps platform and channel after the client props, keeping the shared fields", () => {
    const body = buildDesktopCaptureBody(
      { event: "boot", session: "s1", properties: { mode: "modern", distribution_channel: "steam" } },
      "preview",
    );
    expect(body.properties).toEqual({
      mode: "modern",
      distinct_id: "s1",
      $process_person_profile: false,
      $geoip_disable: true,
      environment: "preview",
      platform: "desktop",
      distribution_channel: "steam",
    });
  });

  it("reports unknown for an absent channel", () => {
    const body = buildDesktopCaptureBody({ event: "boot" }, "production");
    expect(body.properties.distribution_channel).toBe("unknown");
  });

  it("accepts each packaged storefront and nothing near it", () => {
    for (const channel of DESKTOP_DISTRIBUTION_CHANNELS) {
      const body = buildDesktopCaptureBody({ event: "boot", properties: { distribution_channel: channel } }, "test");
      expect(body.properties.distribution_channel).toBe(channel);
    }
    // A near miss (case, whitespace) and a non-string are all `unknown`; the
    // dimension only ever holds values this server named.
    for (const forged of ["STEAM", " steam", "steam ", "epic", "", 7, null, { steam: true }]) {
      const body = buildDesktopCaptureBody({ event: "boot", properties: { distribution_channel: forged } }, "test");
      expect(body.properties.distribution_channel).toBe("unknown");
    }
  });

  it("pins the stamped platform and the accepted storefronts against the client vocabulary", () => {
    // `platform` is a hardcoded literal here rather than a validated field, so
    // nothing else stops it drifting from `PlatformLabel` if the client union is
    // ever renamed or re-spelled; the dimension would then split into two values
    // with no failure anywhere.
    expect([...PLATFORM_LABELS] as unknown[]).toContain(
      buildDesktopCaptureBody({ event: "boot" }, "test").properties.platform,
    );

    // The server restates the pair rather than importing the client resolver (it
    // compiles into the Vercel function and stays free of the client tree), so a
    // storefront added to `DistributionChannelLabel` without being taught here
    // fails this rather than arriving as `unknown` for every session of that build.
    //
    // `surfaces` names the labels that are NOT storefronts, so every other label
    // in the client union has to appear in the server list. Compared as sorted
    // sets: both are vocabularies, and reordering either is not a defect.
    const surfaces = new Set(["web", "twa", "ios", "unknown"]);
    const storefronts = DISTRIBUTION_CHANNEL_LABELS.filter((label) => !surfaces.has(label));
    expect(
      [...new Set(storefronts)].sort(),
      "`DISTRIBUTION_CHANNEL_LABELS` and `DESKTOP_DISTRIBUTION_CHANNELS` disagree. If the new " +
        "label names a STOREFRONT a packaged build is stamped with, add it to " +
        "`DESKTOP_DISTRIBUTION_CHANNELS` in `analyticsIngest.ts`. If it names anything else (a " +
        "runtime surface, a marketing source), add it to `surfaces` in this test instead: " +
        "putting a non-storefront in the server list would make the desktop route accept it " +
        "from an untrusted body.",
    ).toEqual([...new Set(DESKTOP_DISTRIBUTION_CHANNELS)].sort());
  });
});

describe("handleDesktopIngest", () => {
  it("rejects a non-POST method with 405 and never forwards", async () => {
    const deps = makeDeps();
    const res = await handleDesktopIngest(new Request("https://verticopolis.com/api/ingest/desktop"), deps);
    expect(res.status).toBe(405);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards a POST from each accepted origin form", async () => {
    for (const origin of [DESKTOP_ORIGIN, "null", null]) {
      const deps = makeDeps();
      const res = await handleDesktopIngest(originRequest(origin), deps);
      expect(res.status).toBe(204);
      expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
      expect(deps.fetchImpl.mock.calls[0][0]).toBe("https://us.i.posthog.com/capture/");
    }
  });

  it("rejects a foreign Origin with 403 before the body is read", async () => {
    const deps = makeDeps();
    // Our own web origin is foreign HERE: this route serves the shell only.
    const req = originRequest("https://verticopolis.com");
    const res = await handleDesktopIngest(req, deps);
    expect(res.status).toBe(403);
    expect(req.json).not.toHaveBeenCalled();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("no-ops with 204 when the PostHog secrets are absent", async () => {
    for (const missing of [{ key: undefined }, { host: undefined }]) {
      const deps = makeDeps(missing);
      const res = await handleDesktopIngest(postRequest({ event: "boot" }), deps);
      expect(res.status).toBe(204);
      expect(deps.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("rejects an over-limit burst with 429 before forwarding", async () => {
    const deps = makeDeps({ rateLimiter: new RateLimiter(2, 60_000) });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await handleDesktopIngest(postRequest({ event: "boot" }), deps)).status);
    }
    expect(statuses).toEqual([204, 204, 429]);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("honors an injected limiter, which both handlers consult", async () => {
    // Both handlers read `deps.rateLimiter`, so one limiter and one IP counts
    // both routes' hits together. This pins the injection seam only. It is NOT
    // evidence of a shared production budget: each route is built as its own
    // Vercel function with its own module instance, so the singleton the real
    // deps fall through to is per route.
    const deps = makeDeps({ rateLimiter: new RateLimiter(1, 60_000) });
    expect((await handleIngest(postRequest({ event: "boot" }), deps)).status).toBe(204);
    expect((await handleDesktopIngest(postRequest({ event: "boot" }), deps)).status).toBe(429);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls through to the module's default limiter, which persists across requests", async () => {
    // Nothing injected, so every request lands on the module singleton. The
    // persistence is what makes this bite: a build that dropped the limiter, or
    // minted a fresh one per request, would answer 204 forever. An IP of its own
    // keeps this window clear of the rest of the file (which all inject).
    const clientIp = "198.51.100.77";
    const statuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i += 1) {
      const deps = makeDeps({ rateLimiter: undefined, clientIp });
      statuses.push((await handleDesktopIngest(postRequest({ event: "boot" }), deps)).status);
    }
    expect(statuses.slice(0, RATE_LIMIT_MAX)).toEqual(new Array<number>(RATE_LIMIT_MAX).fill(204));
    expect(statuses[RATE_LIMIT_MAX]).toBe(429);
  });

  it("rejects an oversized body with 413 before parsing", async () => {
    const deps = makeDeps();
    // `content-length` is a forbidden header to set on a real Request (the
    // platform controls it, and Vercel always sends it), so drive the guard with
    // a minimal request exposing exactly the fields the handler reads.
    const json = vi.fn().mockResolvedValue({ event: "boot" });
    const req = {
      method: "POST",
      headers: { get: (name: string) => (name === "content-length" ? String(MAX_BODY_BYTES + 1) : null) },
      json,
    } as unknown as Request;
    const res = await handleDesktopIngest(req, deps);
    expect(res.status).toBe(413);
    expect(json).not.toHaveBeenCalled();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unparseable or invalid body with 400", async () => {
    const deps = makeDeps();
    const bodies: unknown[] = [
      "{not valid json",
      42,
      [1, 2],
      null,
      { properties: {} },
      { event: "   " },
      { event: "boot", properties: "x" },
    ];
    for (const body of bodies) {
      expect((await handleDesktopIngest(postRequest(body), deps)).status).toBe(400);
    }
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("parses a text/plain body, the shape sendBeacon and no-cors send", async () => {
    // A string passed to `navigator.sendBeacon` is sent as `text/plain`, and a
    // `no-cors` fetch cannot set a JSON content type at all, so the route has to
    // parse by content rather than by header.
    const deps = makeDeps();
    const res = await handleDesktopIngest(
      postRequest({ event: "boot", properties: { distribution_channel: "itch" } }, { "content-type": "text/plain" }),
      deps,
    );
    expect(res.status).toBe(204);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    expect(forwardedProps(deps.fetchImpl)).toMatchObject({
      platform: "desktop",
      distribution_channel: "itch",
    });
  });

  it("stamps platform server-side over a forged client value", async () => {
    const deps = makeDeps();
    await handleDesktopIngest(
      postRequest({ event: "boot", properties: { platform: "web" } }),
      deps,
    );
    // A desktop post cannot label itself a web session and land in that slice.
    expect(forwardedProps(deps.fetchImpl).platform).toBe("desktop");
  });

  it("rewrites a forged distribution_channel to unknown", async () => {
    const deps = makeDeps();
    await handleDesktopIngest(
      postRequest({ event: "boot", properties: { distribution_channel: "web" } }),
      deps,
    );
    expect(forwardedProps(deps.fetchImpl).distribution_channel).toBe("unknown");
  });

  it("keeps the shared server-authored fields the web route already stamps", async () => {
    const deps = makeDeps({ environment: "preview" });
    await handleDesktopIngest(
      postRequest({
        event: "boot",
        session: "real-session",
        properties: {
          star: 3,
          distinct_id: "spoofed",
          $process_person_profile: true,
          $geoip_disable: false,
          environment: "production",
        },
      }),
      deps,
    );
    expect(forwardedProps(deps.fetchImpl)).toEqual({
      star: 3,
      distinct_id: "real-session",
      $process_person_profile: false,
      $geoip_disable: true,
      environment: "preview",
      platform: "desktop",
      distribution_channel: "unknown",
    });
  });

  it("returns 204 with no body and no cookie, and never echoes the key", async () => {
    const deps = makeDeps();
    const res = await handleDesktopIngest(postRequest({ event: "boot" }), deps);
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe("");
    expect(deps.waitUntil).toHaveBeenCalledTimes(1); // the forward is backgrounded
    const init = deps.fetchImpl.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).api_key).toBe(KEY); // added server-side
  });
});

describe("handleIngest (web route, unchanged by the desktop route)", () => {
  it("stamps neither platform nor distribution_channel", async () => {
    const deps = makeDeps();
    await handleIngest(
      postRequest({ event: "boot", properties: { platform: "web", distribution_channel: "steam" } }),
      deps,
    );
    // The web route passes the client's own dimensions through untouched: the
    // client resolves them there, and only the desktop route authors them.
    expect(forwardedProps(deps.fetchImpl)).toMatchObject({
      platform: "web",
      distribution_channel: "steam",
    });
  });
});

import { describe, expect, it } from "vitest";
import { buildCaptureBody, INGEST_PLATFORM_FALLBACK, INGEST_PLATFORM_LABELS } from "./analyticsIngest";
import { DISTRIBUTION_CHANNEL_LABELS, PLATFORM_LABELS } from "./analyticsEnrichment";

/** The pure capture-body builder, split from `analyticsIngest.test.ts` at the
 *  500-line guard. */
describe("buildCaptureBody", () => {
  it("restates the client's closed platform set exactly (GH #788)", () => {
    expect([...INGEST_PLATFORM_LABELS].sort()).toEqual([...PLATFORM_LABELS].sort());
    expect([...INGEST_PLATFORM_LABELS].sort()).toEqual([...DISTRIBUTION_CHANNEL_LABELS].sort());
    // The fallback must never be a real label, or a forged row would pass as one.
    expect((PLATFORM_LABELS as readonly string[]).includes(INGEST_PLATFORM_FALLBACK)).toBe(false);
  });

  it("checks each dimension on its own: a valid platform keeps it beside a forged channel", () => {
    const body = buildCaptureBody(
      { event: "boot", properties: { platform: "twa", distribution_channel: "steam" } },
      "production",
    );
    expect(body.properties.platform).toBe("twa");
    expect(body.properties.distribution_channel).toBe(INGEST_PLATFORM_FALLBACK);
  });

  it("forwards each known platform and distribution_channel label unchanged", () => {
    for (const label of INGEST_PLATFORM_LABELS) {
      const body = buildCaptureBody(
        { event: "boot", properties: { platform: label, distribution_channel: label } },
        "production",
      );
      expect(body.properties.platform).toBe(label);
      expect(body.properties.distribution_channel).toBe(label);
    }
  });

  it("REGRESSION (GH #788): a forged platform or distribution_channel becomes the fallback", () => {
    for (const forged of ["desktop", "steam", "WEB", "", 7, null, true, { x: 1 }, ["web"]]) {
      const body = buildCaptureBody(
        { event: "boot", properties: { platform: forged, distribution_channel: forged, kept: "yes" } },
        "production",
      );
      expect(body.properties.platform).toBe(INGEST_PLATFORM_FALLBACK);
      expect(body.properties.distribution_channel).toBe(INGEST_PLATFORM_FALLBACK);
      expect(body.properties.kept).toBe("yes");
    }
  });

  it("leaves an absent platform or distribution_channel absent", () => {
    const body = buildCaptureBody({ event: "boot", properties: { platform: "twa" } }, "production");
    expect(body.properties.platform).toBe("twa");
    expect("distribution_channel" in body.properties).toBe(false);
    const other = buildCaptureBody({ event: "boot", properties: { distribution_channel: "web" } }, "production");
    expect(other.properties.distribution_channel).toBe("web");
    expect("platform" in other.properties).toBe(false);
  });

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
      $geoip_disable: true,
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
        $geoip_disable: true,
        environment: "preview",
      },
    });
  });

  it("disables GeoIP so PostHog never geo-locates the relay's own egress IP", () => {
    const body = buildCaptureBody({ event: "boot" }, "production");
    expect(body.properties.$geoip_disable).toBe(true);
  });

  it("does not let the client re-enable GeoIP through its props", () => {
    // We never forward the player IP, so GeoIP must stay off regardless of a
    // crafted client body that tries to flip it back on.
    const body = buildCaptureBody(
      { event: "boot", properties: { $geoip_disable: false } as unknown as Record<string, unknown> },
      "production",
    );
    expect(body.properties.$geoip_disable).toBe(true);
  });

  it("falls back to an unknown environment when VERCEL_ENV is absent", () => {
    const body = buildCaptureBody({ event: "boot" }, undefined);
    expect(body.properties.environment).toBe("unknown");
  });
});

import type { EventProps } from "./analyticsAdapter";

/**
 * On-device, cookieless enrichment for the gameplay analytics events (S4). Every
 * value here is a COARSE, ANONYMOUS bucket computed once at boot from state the
 * device already holds: the URL the app launched with, the loaded tower's in-game age, and the autosave's write time. Nothing
 * here is an identifier, nothing is persisted, and nothing crosses a session or
 * a device, so this stays inside the migration's cookieless / banner-free
 * invariant. `analytics.ts` merges the result into every event.
 *
 * The Tier 3 persistent, save-derived `distinct_id` that would LEAVE the device
 * (true per-cohort return curves) is deliberately NOT here: it is a persistent
 * online identifier that re-triggers consent (GDPR/ePrivacy, Apple ATT) and is
 * parked at the E4 monetization gate (see the epic's S4 plan).
 */

/**
 * The RUNTIME SURFACE a session is played on (resolves AUD-036, closes #710):
 * the browser game, or the Android TWA, which loads the same live site with a
 * `?src=twa` start-URL marker. Closed set; {@link PLATFORM_LABELS} is its
 * runtime twin, pinned against this union in `analyticsEnrichment.test.ts`.
 */
export type PlatformLabel = "web" | "twa";

/** Every {@link PlatformLabel}, for the tests that pin the set closed. */
export const PLATFORM_LABELS = ["web", "twa"] as const;

/**
 * The COMMERCIAL CHANNEL a session arrived through, emitted as
 * `distribution_channel`. Every surface the browser game runs on is its own
 * channel, so the values mirror {@link PlatformLabel}; the dimension stays so
 * the dashboards that break down by it keep working.
 *
 * Named DISTRIBUTION channel because PostHog already ships a built-in
 * `$channel_type` ("Channel type": direct / organic / paid / referral), and a
 * bare `channel` would read as marketing attribution.
 */
export type DistributionChannelLabel = PlatformLabel;

/** Every {@link DistributionChannelLabel}; see {@link PLATFORM_LABELS}. */
export const DISTRIBUTION_CHANNEL_LABELS = PLATFORM_LABELS;

/**
 * Resolve the platform label from the launch URL's query string: the TWA
 * start-URL marker (`?src=twa`) reads `twa`, everything else `web`. Pure, so
 * it is unit-testable without faking the location.
 */
export function resolvePlatformLabel(search: string): PlatformLabel {
  try {
    if (new URLSearchParams(search).get("src") === "twa") return "twa";
  } catch {
    /* a malformed query string is not a TWA marker; fall through to web */
  }
  return "web";
}

/**
 * The live platform dimension: the launch URL's query string through
 * {@link resolvePlatformLabel}. The `?src=twa` marker rides the TWA's start-URL
 * launch navigation, which is exactly the boot moment this is computed at.
 * Best-effort: a missing `window` reads as `web`.
 */
export function platformLabel(): PlatformLabel {
  let search = "";
  try {
    search = window.location.search;
  } catch {
    /* no window (server-side / worker): treat as the plain web default */
  }
  return resolvePlatformLabel(search);
}

/** The live distribution-channel dimension. Takes the platform the caller
 *  already resolved, so the two dimensions are computed from one read and
 *  cannot disagree. */
export function distributionChannelLabel(platform: PlatformLabel): DistributionChannelLabel {
  return platform;
}

/**
 * Coarse tenure bucket from the loaded tower's in-game age in whole days (the
 * clock's `day`, 0 on a fresh tower). An anonymous on-device progression signal,
 * never an id. A missing, non-finite, or negative value reads as `unknown`.
 */
export function tenureBucket(day: number | undefined): string {
  if (day === undefined || !Number.isFinite(day) || day < 0) return "unknown";
  if (day < 1) return "d0";
  if (day < 7) return "d1-6";
  if (day < 30) return "d7-29";
  return "d30+";
}

/**
 * Coarse return-recency bucket (Tier 2) from the wall-clock milliseconds since
 * the last autosave write. Answers "came back within 1d / 7d / 30d" while the
 * interval is computed on-device and emitted only as a bucket: no timestamp and
 * no id leave the device, so the retention-shaped signal stays cookieless. A
 * missing, non-finite, or negative delta (no save, or a clock skew) reads as
 * `unknown`.
 */
export function recencyBucket(msSinceSave: number | undefined): string {
  if (msSinceSave === undefined || !Number.isFinite(msSinceSave) || msSinceSave < 0) return "unknown";
  const days = msSinceSave / 86_400_000;
  if (days < 1) return "1d";
  if (days < 7) return "7d";
  if (days < 30) return "30d";
  return "30d+";
}

/**
 * Coarse display-mode bucket: whether the app is running installed
 * (`standalone`) or in a browser tab (`browser`). An anonymous on-device
 * signal that lets the install-affordance's reach be read without any
 * player-facing telemetry (SPEC-pwa-install CAP-4). The impure standalone
 * probe (matchMedia / navigator.standalone) lives in `pwaInstall.ts`; this
 * takes the resolved boolean so it stays a pure, unit-testable mapping.
 */
export function displayModeBucket(standalone: boolean): string {
  return standalone ? "standalone" : "browser";
}

/**
 * Assemble the boot-time common props merged into every event. Pure: the boot
 * flow reads the live signals (`platform` and `distributionChannel` from the
 * build and the injected port, `onboarded` from the device, `tenureDay` off the
 * loaded tower, `savedAt` off the autosave, `standalone` off the display mode,
 * `now` the boot clock) and passes them in, so the field mapping and the recency
 * delta are unit-testable without the boot harness. `returning` is derived off
 * the onboarding-seen flag (the cookieless on-device returning signal, per the
 * SPEC).
 *
 * The two dimensions ride together because they answer two halves of one
 * question and are useless apart: a `desktop` platform with no channel cannot
 * say which store, and a `steam` channel with no platform loses the surface. The
 * boot flow resolves the channel FROM the platform
 * ({@link distributionChannelLabel}), so the pair cannot disagree.
 */
export function bootCommonProps(input: {
  platform: PlatformLabel;
  distributionChannel: DistributionChannelLabel;
  /** The build the CLIENT is running. It has to come from the client and cannot
   *  be stamped server-side like `environment`: the service worker precaches the
   *  bundle, so a returning player keeps running an older build until the worker
   *  updates, which is the whole reason the update prompt exists. A relay-stamped
   *  version would label those sessions with whatever release was deployed at the
   *  time, making an error from an already-fixed build read as a fresh
   *  regression. Untrusted, like every other client-supplied dimension here. */
  version: string;
  onboarded: boolean;
  tenureDay: number | undefined;
  savedAt: number | undefined;
  standalone: boolean;
  now: number;
}): EventProps {
  // A real save time is a positive epoch-ms stamp. A non-positive savedAt is a
  // forged or corrupt value (parseSavedAt admits the whole Date range, including
  // pre-epoch negatives), so treat it as absent: a bare `now - savedAt` on a
  // negative stamp would be an inflated positive delta that lands in a confident
  // "30d+" bucket, whereas a forgery must read as "unknown" (the same
  // forged-reads-as-absent posture the recency source claims).
  const msSinceSave = input.savedAt !== undefined && input.savedAt > 0 ? input.now - input.savedAt : undefined;
  return {
    platform: input.platform,
    distribution_channel: input.distributionChannel,
    version: input.version,
    returning: input.onboarded,
    tenure: tenureBucket(input.tenureDay),
    recency: recencyBucket(msSinceSave),
    display: displayModeBucket(input.standalone),
  };
}

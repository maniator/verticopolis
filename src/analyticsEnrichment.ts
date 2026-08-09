import { getPlatform } from "./platform";
import type { EventProps } from "./analyticsAdapter";

/**
 * On-device, cookieless enrichment for the gameplay analytics events (S4). Every
 * value here is a COARSE, ANONYMOUS bucket computed once at boot from state the
 * device already holds: the injected platform port, the URL the app launched
 * with, the loaded tower's in-game age, and the autosave's write time. Nothing
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
 * the plain web build, the Android TWA, the iOS Capacitor shell, and the
 * Electron desktop shell. It answers what is rendering the game. Where the copy
 * came from is the other dimension, {@link DistributionChannelLabel}, kept
 * separate so a new storefront can be added without touching this union, and so
 * a desktop breakdown by store is a filter rather than a re-labelling.
 *
 * Closed set. {@link PLATFORM_LABELS} is its runtime twin, pinned against this
 * union in `analyticsEnrichment.test.ts`.
 */
export type PlatformLabel = "web" | "twa" | "ios" | "desktop";

/** Every {@link PlatformLabel}, for the tests that pin the set closed. Kept
 *  beside the union so the two are read together; neither can grow without the
 *  other (the test checks both directions at compile time and at runtime). */
export const PLATFORM_LABELS = ["web", "twa", "ios", "desktop"] as const;

/**
 * The COMMERCIAL CHANNEL a session arrived through: the three web-and-mobile
 * surfaces carry their own name, a desktop build carries the storefront it was
 * packaged for, and `unknown` covers a desktop build whose shell named nothing
 * recognizable. Separate from {@link PlatformLabel} on purpose: `desktop` is one
 * runtime surface serving several stores, and one dimension cannot say both.
 *
 * Named DISTRIBUTION channel, and emitted as `distribution_channel`, because
 * PostHog already ships a built-in `$channel_type` ("Channel type": direct /
 * organic / paid / referral). A bare `channel` sits next to it in the property
 * picker and reads as marketing attribution, which is a different question from
 * which storefront the build came from. The prefix is the whole fix; the values
 * are unchanged.
 *
 * Closed set, like the platform union, with {@link DISTRIBUTION_CHANNEL_LABELS}
 * as its runtime twin.
 */
export type DistributionChannelLabel = "web" | "twa" | "ios" | "steam" | "itch" | "unknown";

/** Every {@link DistributionChannelLabel}; see {@link PLATFORM_LABELS}. */
export const DISTRIBUTION_CHANNEL_LABELS = ["web", "twa", "ios", "steam", "itch", "unknown"] as const;

declare const buildModeBrand: unique symbol;

/**
 * A Vite build mode, as a NOMINAL type. {@link resolvePlatformLabel} takes a
 * mode and a query string, both plain text at runtime, so typing both `string`
 * would let the two be swapped at the call site with no compile error: the
 * swapped call resolves `web` for every desktop and iOS session, and every test
 * here stays green because the runner's own mode is always "test". The brand is
 * what makes the two argument slots different types.
 *
 * Written as the modes this repo builds plus a branded fallback rather than a
 * closed union, so the RUNTIME contract does not narrow: a mode nothing here
 * names still resolves `web`, exactly as it did before. `import.meta.env.MODE`
 * is typed `string`, so the one live call site tags it through
 * {@link buildMode}; anything else reaching for the slot has to say so just as
 * deliberately, which is the whole point.
 */
export type BuildMode =
  | "production"
  | "development"
  | "test"
  | "native"
  | "desktop"
  | (string & { readonly [buildModeBrand]: never });

/** Tag a raw mode string as a {@link BuildMode}. The single narrow place the
 *  brand is applied, so a swapped argument has to be written here to compile. */
export function buildMode(mode: string): BuildMode {
  return mode as BuildMode;
}

/**
 * Resolve the platform label, keyed on the BUILD MODE first and the injected
 * wrapper flag only after it: mode `desktop` is the Electron shell, mode
 * `native` the iOS Capacitor shell, a port claiming `isNativeWrapper` under any
 * other mode is the iOS shell too (the only wrapper specified to inject one),
 * then the TWA start-URL marker (`?src=twa`, set by the Android wrapper's
 * manifest in the private distribution repo), and everything else is `web`.
 *
 * Mode first is what every other wrapped-build gate in `src/platform` does, and
 * it is what settles #710: the flag alone cannot tell the two wrapper shells
 * apart, so a desktop session that bound a port used to report `ios`, and a
 * desktop shell that binds NO port (its whole surface is available natively in
 * Electron, so it may not need one) would report `web`. The mode is decided
 * when the bundle is built, so it is right either way.
 *
 * The mode literals are compared here rather than run through `isWrappedMode`,
 * which deliberately answers wrapped-or-not and cannot separate the two shells.
 * That leaves a third copy of those literals in the repo, so the source-text
 * guard in `src/platform/platform.test.ts` pins all three copies against each
 * other: a wrapped mode added to the seam but not taught to this resolver would
 * report `web` for every session of that build, which is #710 one level up.
 * Pure, so the order is unit-testable without faking the build.
 */
export function resolvePlatformLabel(mode: BuildMode, isNativeWrapper: boolean, search: string): PlatformLabel {
  if (mode === "desktop") return "desktop";
  if (mode === "native") return "ios";
  if (isNativeWrapper) return "ios";
  try {
    if (new URLSearchParams(search).get("src") === "twa") return "twa";
  } catch {
    /* a malformed query string is not a TWA marker; fall through to web */
  }
  return "web";
}

/**
 * Resolve the distribution channel from the already-resolved platform plus the
 * injected port. Every non-desktop surface is its own channel; only a desktop
 * build has a storefront to name, and it names it through the port's optional
 * `distributionChannel` member (stamped by the shell at package time).
 *
 * That member is UNTRUSTED input from another repository, exactly like the rest
 * of the port, so it is sanitized here rather than at validation time: only the
 * two exact values pass, and everything else (a near miss like `"STEAM"` or a
 * stray space, a non-string, a member that is not there at all) reports
 * `unknown`. `isPlatformPort` checks the port's SHAPE and deliberately lets any
 * `distributionChannel` value through, because a bad one must not demote a
 * working shell to the browser port over a telemetry dimension. Reading the
 * member can itself throw (a hostile getter, a revoked Proxy), so the read is
 * guarded: a dimension is never worth throwing out of boot for.
 */
export function resolveDistributionChannel(
  platform: PlatformLabel,
  port: { readonly distributionChannel?: unknown },
): DistributionChannelLabel {
  if (platform !== "desktop") return platform;
  let named: unknown;
  try {
    named = port.distributionChannel;
  } catch {
    return "unknown";
  }
  // The comparison narrows `named` (typed `unknown`, since the shell's value is
  // not trusted) to the two accepted literals, so the match can be returned
  // directly rather than restated.
  return named === "steam" || named === "itch" ? named : "unknown";
}

/**
 * The live platform dimension. Reads the build mode and the injected wrapper
 * flag (cached in the platform seam) plus the launch URL's query string, then
 * delegates the ordering to {@link resolvePlatformLabel}. The `?src=twa` marker
 * rides the TWA's start-URL launch navigation, which is exactly the boot moment
 * this is computed at; a plain web session (and the marker-less native shell)
 * reads `web`/`ios` as expected. Best-effort: a missing `window` degrades to the
 * mode's answer with no marker.
 */
export function platformLabel(): PlatformLabel {
  let search = "";
  try {
    search = window.location.search;
  } catch {
    /* no window (server-side / worker): treat as the plain web default */
  }
  return resolvePlatformLabel(buildMode(import.meta.env.MODE), getPlatform().isNativeWrapper, search);
}

/** The live distribution-channel dimension: {@link resolveDistributionChannel}
 *  over the injected port. Takes the platform the caller already resolved, so
 *  the two dimensions are computed from one platform read and cannot disagree. */
export function distributionChannelLabel(platform: PlatformLabel): DistributionChannelLabel {
  return resolveDistributionChannel(platform, getPlatform());
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

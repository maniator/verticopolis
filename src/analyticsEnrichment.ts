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

/** The shipping surfaces this dimension names (resolves AUD-036): the iOS
 *  Capacitor shell, the Android TWA, and the plain web build. A desktop
 *  wrapper session that bound a port would report `ios`, a known gap held for
 *  the analytics story (issue #710); wrapped builds report nothing today. */
export type PlatformLabel = "web" | "twa" | "ios";

/**
 * Resolve the platform label from the two runtime signals, in priority order:
 * the wrapper flag wins (iOS is the only wrapper specified to inject a port;
 * see issue #710 for the desktop case), then
 * the TWA start-URL marker (`?src=twa`, set by the Android wrapper's manifest in
 * the private distribution repo), and everything else is `web`. Pure so the
 * order is unit-testable without faking the build mode or the launch URL.
 */
export function resolvePlatformLabel(isNativeWrapper: boolean, search: string): PlatformLabel {
  if (isNativeWrapper) return "ios";
  try {
    if (new URLSearchParams(search).get("src") === "twa") return "twa";
  } catch {
    /* a malformed query string is not a TWA marker; fall through to web */
  }
  return "web";
}

/**
 * The live platform dimension. Reads the injected wrapper flag (cached in the
 * platform seam) and the launch URL's query string, then delegates the ordering
 * to {@link resolvePlatformLabel}. The `?src=twa` marker rides the TWA's
 * start-URL launch navigation, which is exactly the boot moment this is computed
 * at; a plain web session (and the marker-less native shell) reads `web`/`ios`
 * as expected. Best-effort: a missing `window` degrades to `web`.
 */
export function platformLabel(): PlatformLabel {
  let search = "";
  try {
    search = window.location.search;
  } catch {
    /* no window (server-side / worker): treat as the plain web default */
  }
  return resolvePlatformLabel(getPlatform().isNativeWrapper, search);
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
 * flow reads the live signals (`platform` and `onboarded` from the device,
 * `tenureDay` off the loaded tower, `savedAt` off the autosave, `standalone`
 * off the display mode, `now` the boot clock) and passes them in, so the field
 * mapping and the recency delta are unit-testable without the boot harness.
 * `returning` is derived off the onboarding-seen flag (the cookieless on-device
 * returning signal, per the SPEC).
 */
export function bootCommonProps(input: {
  platform: PlatformLabel;
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
    returning: input.onboarded,
    tenure: tenureBucket(input.tenureDay),
    recency: recencyBucket(msSinceSave),
    display: displayModeBucket(input.standalone),
  };
}

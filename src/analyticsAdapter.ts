import { track, inject as injectWebAnalytics } from "@vercel/analytics";
import { injectSpeedInsights } from "@vercel/speed-insights";
import { sendToRelay } from "./analyticsRelay";

/**
 * The analytics transport seam: ONE module owns the vendor SDK imports and the
 * wire calls behind them, so the whole telemetry vocabulary sits on a single,
 * swappable transport. The typed event vocabulary, the host gate
 * (`telemetryHostAllowed`), and the never-throw best-effort guarantee all stay
 * with the callers in `analytics.ts` and `telemetry.ts`; this layer answers only
 * two vendor questions: "how does a typed custom event reach the provider" and
 * "how does the shared page-view plus Core Web Vitals inject reach the provider".
 *
 * Keeping both here is what makes the planned D-1 migration (Vercel Web Analytics
 * to a cookieless PostHog relay) a one-file change: no other module imports a
 * `@vercel/*` telemetry SDK, so swapping the provider is a new {@link
 * AnalyticsAdapter} plus one binding, with every call site untouched. A grep for
 * the vendor package outside this file should come back empty.
 */

/**
 * The primitive prop values a custom event may carry. This mirrors what the
 * vendor transport accepts and what the typed vocabulary in `analytics.ts`
 * produces, expressed here in vendor-neutral terms so no caller needs a
 * provider type.
 */
export type EventProps = Record<string, string | number | boolean | null>;

/**
 * The vendor-neutral transport every telemetry surface flows through. An adapter
 * only performs the wire calls; gating and error-swallowing are the caller's job
 * (and stay in one place there), so a stub can stand in for the whole surface in
 * a test without reproducing that logic.
 */
export interface AnalyticsAdapter {
  /** Send one already-typed custom event (name plus props). */
  send(event: string, props: EventProps): void;
  /** Inject the shared page-view and Core Web Vitals telemetry. */
  injectPageTelemetry(): void;
}

/**
 * The production adapter: Vercel Web Analytics (`track`, page-view `inject`) plus
 * Speed Insights, calling exactly what the pre-seam code called in the same
 * order, so behavior is byte-identical. This is the only place a `@vercel/*`
 * telemetry SDK is imported.
 */
export const vercelAdapter: AnalyticsAdapter = {
  send(event, props) {
    track(event, props);
  },
  injectPageTelemetry() {
    injectSpeedInsights();
    injectWebAnalytics();
  },
};

/**
 * The dual-write adapter for the migration's validation window (S3): every custom
 * event goes to BOTH the existing Vercel `track` and the new same-origin PostHog
 * relay (`sendToRelay`), so the two feeds can be compared before Vercel is retired
 * (S6). The two writes are independent: a throw in the Vercel path cannot suppress
 * the relay write (`sendToRelay` is itself never-throw). Page-view and Core Web
 * Vitals telemetry stays Vercel-only until that keep-or-drop call at cutover.
 */
export const dualWriteAdapter: AnalyticsAdapter = {
  send(event, props) {
    try {
      track(event, props);
    } catch {
      /* Vercel best-effort; keep the relay write independent of a Vercel hiccup */
    }
    sendToRelay(event, props);
  },
  injectPageTelemetry() {
    injectSpeedInsights();
    injectWebAnalytics();
  },
};

/**
 * The active adapter. Defaults to {@link dualWriteAdapter} for the S3 validation
 * window (both Vercel and the PostHog relay receive each event). A module-level
 * indirection so cutover (S6) is this one binding plus a relay-only adapter, and
 * so a test can drive the whole vocabulary through a stub (see {@link
 * setAnalyticsAdapter}) with no transport involved.
 */
let activeAdapter: AnalyticsAdapter = dualWriteAdapter;

/** The adapter every caller reaches telemetry through. */
export function analyticsAdapter(): AnalyticsAdapter {
  return activeAdapter;
}

/**
 * Swap the active adapter, returning the previous one so a caller can restore it.
 * The only intended non-test use is a future provider swap that sets its adapter
 * once at module load; tests use it to install a stub and put `vercelAdapter`
 * back afterward.
 */
export function setAnalyticsAdapter(adapter: AnalyticsAdapter): AnalyticsAdapter {
  // Wiring guard, not an emission path: a misconfigured swap (a null or a stub
  // missing a method) would otherwise install silently and, because every send
  // and inject is wrapped in a best-effort catch, kill telemetry for the rest of
  // the process with nothing surfaced. Fail loudly here at swap time instead. The
  // never-throw guarantee covers event emission, not this one configuration call.
  if (
    !adapter ||
    typeof adapter.send !== "function" ||
    typeof adapter.injectPageTelemetry !== "function"
  ) {
    throw new TypeError("setAnalyticsAdapter needs an adapter implementing send and injectPageTelemetry");
  }
  const previous = activeAdapter;
  activeAdapter = adapter;
  return previous;
}

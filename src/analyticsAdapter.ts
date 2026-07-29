import { injectSpeedInsights } from "@vercel/speed-insights";
import { sendToRelay } from "./analyticsRelay";

/**
 * The analytics transport seam: ONE module owns the vendor SDK imports and the
 * wire calls behind them, so the whole telemetry vocabulary sits on a single,
 * swappable transport. The typed event vocabulary, the host gate
 * (`telemetryHostAllowed`), and the never-throw best-effort guarantee all stay
 * with the callers in `analytics.ts` and `telemetry.ts`; this layer answers only
 * two vendor questions: "how does a typed custom event reach the provider" and
 * "how does the page-performance inject reach the provider".
 *
 * The D-1 migration (Vercel Web Analytics to the cookieless PostHog relay) is
 * complete: custom events go relay-only, and `@vercel/analytics` is gone from
 * the codebase. `@vercel/speed-insights` (Core Web Vitals) is KEPT by the
 * recorded swap-time decision in the migration spec: the cookieless setup ships
 * no posthog-js, so nothing else measures page performance. A grep for either
 * vendor package outside this file should come back empty.
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
 * The production adapter after cutover (S6): custom events post to the
 * same-origin PostHog relay (`sendToRelay`, itself never-throw), and the page
 * inject is Speed Insights only, since Vercel Web Analytics is retired. The
 * dual-write adapter that ran through the S3-S6 validation window is gone with
 * it.
 */
export const relayAdapter: AnalyticsAdapter = {
  send(event, props) {
    sendToRelay(event, props);
  },
  injectPageTelemetry() {
    injectSpeedInsights();
  },
};

/**
 * The active adapter. Defaults to {@link relayAdapter} (the post-cutover
 * production transport). A module-level indirection so a future provider swap is
 * one binding, and so a test can drive the whole vocabulary through a stub (see
 * {@link setAnalyticsAdapter}) with no transport involved.
 */
let activeAdapter: AnalyticsAdapter = relayAdapter;

/** The adapter every caller reaches telemetry through. */
export function analyticsAdapter(): AnalyticsAdapter {
  return activeAdapter;
}

/**
 * Swap the active adapter, returning the previous one so a caller can restore it.
 * The only intended non-test use is a future provider swap that sets its adapter
 * once at module load; tests use it to install a stub and put the default
 * adapter back afterward.
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

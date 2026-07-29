import { analyticsAdapter } from "./analyticsAdapter";
import { isWrappedMode } from "./platform";

/**
 * Shared page-view + Core Web Vitals inject for every deployed page: the game
 * boot (`bootstrap.ts`), the sprite gallery (`gallery.ts`), and the standalone
 * `/help` page (`helpPage.ts`). It reports page performance and page views
 * through the one analytics adapter (the page-level pair kept at the D-1
 * cutover: Vercel Speed Insights plus the Web Analytics page-view inject; the
 * custom-event side of Web Analytics is retired), but only where the Vercel
 * endpoints (`/_vercel/speed-insights/*` and `/_vercel/insights/*`) actually
 * exist: the production domain and Vercel preview deployments.
 *
 * Gating on the host keeps the injected scripts' 404s (and the console errors
 * they raise) out of localhost, the `vite preview` server the e2e console-error
 * guards run against, and the native Capacitor shell (whose origin is not on
 * this list, mirroring the service-worker registration's native gate). The
 * inject is wrapped so a telemetry hiccup can never throw past the caller and
 * block boot; every page treats it as best-effort.
 *
 * Factoring it here means the three pages report the same telemetry the same
 * way from one gate, so the pages can never drift out of parity with the game.
 */
/**
 * The one host gate every Vercel telemetry call shares: the page-view inject
 * below and the gameplay events in `analytics.ts`. True only where the Vercel
 * endpoints actually exist (`/_vercel/*`) and the same-origin `/api/ingest` relay
 * is served: the production domain, our own subdomains (a `*.preview.verticopolis.com`
 * preview deployment), and the raw `*.vercel.app` deploy URLs. False on localhost,
 * the `vite preview` server the e2e console-error guards run against, the native
 * Capacitor shell, and any server-side (no `window`) context. The page-view inject
 * and the gameplay events both gate on this one predicate, so those two client
 * surfaces never diverge from each other.
 *
 * IMPORTANT: keep this host set in step with `originAllowed` in
 * `analyticsIngest.ts` (the server-side same-origin guard on the relay): change
 * the two together, since the client emits from here and the server accepts there.
 * They agree on our own domain but are NOT identical predicates. The server is
 * environment-aware and refuses the shared `*.vercel.app` suffix in production; the
 * client cannot read `VERCEL_ENV`, so it trusts that suffix everywhere. The one
 * consequence: a production visit via the raw `*.vercel.app` deploy alias emits
 * from the client and is refused (403) by the relay. That is rare and accepted,
 * since production traffic comes from the custom domain.
 *
 * This is a functional gate (only where the endpoints are served), not a security
 * boundary: a non-Vercel look-alike such as `verticopolis.com.evil.example` falls
 * outside it (it does not end with `.verticopolis.com`).
 */
export function telemetryHostAllowed(mode: string = import.meta.env.MODE): boolean {
  // Wrapped builds (Capacitor, Electron) never report telemetry, whatever host
  // they are served from. The host check below already excludes every wrapper
  // origin in practice, but a wrapper shell could serve its bundle from a
  // hostname on this list (an app protocol host named after the production
  // domain), and that must not silently open the gate. Structural, per the
  // distribution plan: enabling desktop analytics is a reviewed change here,
  // never a wrapper-side hostname choice.
  if (isWrappedMode(mode)) return false;
  if (typeof window === "undefined") return false;
  // Strip a trailing dot so the canonical absolute FQDN (`verticopolis.com.`) is
  // matched like the usual form. Mirror this in `originAllowed`.
  const host = window.location.hostname.replace(/\.$/, "");
  return (
    host === "verticopolis.com" ||
    host.endsWith(".verticopolis.com") ||
    host.endsWith(".vercel.app")
  );
}

export function injectVercelTelemetry(): void {
  if (!telemetryHostAllowed()) return;
  try {
    analyticsAdapter().injectPageTelemetry();
  } catch {
    /* best-effort telemetry; never block the caller on it */
  }
}

import { analyticsAdapter } from "./analyticsAdapter";

/**
 * Shared page-view + Core Web Vitals inject for every deployed page: the game
 * boot (`bootstrap.ts`), the sprite gallery (`gallery.ts`), and the standalone
 * `/help` page (`helpPage.ts`). It reports Core Web Vitals and page views
 * through the one analytics adapter (today Vercel Speed Insights + Web
 * Analytics), but only where the Vercel endpoints (`/_vercel/speed-insights/*`
 * and `/_vercel/insights/*`) actually exist: the production domain and Vercel
 * preview deployments.
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
 * Capacitor shell, and any server-side (no `window`) context. Keeping every
 * telemetry surface on one predicate means they can never drift out of gate parity.
 *
 * IMPORTANT: this host set mirrors `originAllowed` in `analyticsIngest.ts` (the
 * server-side same-origin guard on the relay). Change the two together; the
 * client emits from here, the server accepts there, and a drift silently drops
 * events (client dark, or server 403). The server side additionally refuses the
 * shared `*.vercel.app` suffix in production, since it is common to every Vercel
 * customer; here on the client it is harmless because only our own deployments
 * ever serve this bundle.
 *
 * This is a functional gate (only where the endpoints are served), not a security
 * boundary: a non-Vercel look-alike such as `verticopolis.com.evil.example` falls
 * outside it (it does not end with `.verticopolis.com`).
 */
export function telemetryHostAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
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

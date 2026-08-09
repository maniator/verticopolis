import { analyticsAdapter } from "./analyticsAdapter";
import { isWrappedMode } from "./platform";
import { desktopAnalyticsAllowed } from "./desktopConsent";

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
 * The desktop surface is a THIRD pair on the same rule, and it is not this
 * host set: the desktop client's ingest URL constant (`DESKTOP_INGEST_URL` in
 * `analyticsRelay.ts`) pairs with `desktopOriginAllowed` on the server, which
 * guards `POST /api/ingest/desktop` and accepts only the shell's own origin, the
 * literal opaque `"null"`, and an absent header. Each pair moves together, and no
 * pair may be folded into another: the desktop route refuses every web host and
 * `originAllowed` refuses the shell's origin, so widening one route can never
 * widen the other. The desktop client's half of the gate is still THIS function,
 * answered by the consent state rather than by a hostname (see below).
 *
 * This is a functional gate (only where the endpoints are served), not a security
 * boundary: a non-Vercel look-alike such as `verticopolis.com.evil.example` falls
 * outside it (it does not end with `.verticopolis.com`). The same holds on the
 * server side of both pairs, and more weakly than it may read. `/api/ingest` and
 * `/api/ingest/desktop` are unauthenticated public endpoints: there is no token,
 * and an absent `Origin` header passes on both, so anyone with `curl` can
 * already post to them. The origin filters keep an ordinary page on a named host
 * out and no more than that: a sandboxed iframe's real origin is the literal
 * `"null"`, which the desktop guard accepts, and the relay parses the body text
 * without consulting `content-type`, so a `text/plain` POST is a simple request
 * that never preflights. A hostile page can drive its visitors' browsers into
 * the desktop route that way. What bounds abuse is the relay's per-IP rate
 * limiter (best-effort per function instance rather than a global quota) and its
 * 8 KiB body cap.
 */
export function telemetryHostAllowed(mode: string = import.meta.env.MODE): boolean {
  // Wrapped builds (Capacitor, Electron) are decided by the MODE, before any
  // hostname is read, and the reason is unchanged by the desktop epic: a wrapper
  // shell could serve its bundle from a hostname on the list below (an app
  // protocol host named after the production domain), and that must never
  // silently open the gate. Enabling a wrapped surface stays a reviewed change
  // in this repo rather than a wrapper-side hostname choice.
  //
  // What the desktop epic changed is WHICH reviewed answer this returns, not
  // where the decision is made. `desktopAnalyticsAllowed` is false for every
  // wrapped mode except `desktop`, so the iOS Capacitor shell stays
  // unconditionally dark exactly as before, and a desktop build answers with the
  // player's own consent state: nothing at all until the first-run notice
  // resolves, and nothing again the moment they turn it off in Settings. The
  // host set below is deliberately never consulted for a wrapped build, because
  // the desktop client posts to an absolute ingest URL rather than to a path on
  // whatever origin it happens to be served from.
  if (isWrappedMode(mode)) return desktopAnalyticsAllowed(mode);
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

export function injectVercelTelemetry(mode: string = import.meta.env.MODE): void {
  // The Vercel page-level pair is served by OUR deployment at `/_vercel/*`, so
  // it only exists on a page loaded from it. A wrapped shell loads from its own
  // app protocol, where those paths 404, and the desktop shell's injected CSP
  // allows exactly one outbound URL (the ingest route). Granting desktop consent
  // opens the GAMEPLAY events, which have an absolute URL to reach; this inject
  // has no such route, so it stays dark on every wrapped build regardless.
  // Checked here rather than folded into the gate because the two questions are
  // genuinely different: "may we report" versus "is this page served by us".
  if (isWrappedMode(mode)) return;
  if (!telemetryHostAllowed(mode)) return;
  try {
    analyticsAdapter().injectPageTelemetry();
  } catch {
    /* best-effort telemetry; never block the caller on it */
  }
}

import { trackEvent } from "./analyticsCore";

/**
 * The landing page view (approved 2026-11-13): where a page life came from, so
 * a launch post's traffic can be read next to what those players did. It goes
 * through the cookieless relay like every other event, under PostHog's own
 * `$pageview` name and property names, so PostHog's referrer and UTM
 * breakdowns read it as they are.
 *
 * Only the referrer's host travels, never its path or query (a search or a
 * private page could be in there), and only when it names a public site: an IP
 * address or a local machine name goes as {@link OTHER}. The landing path is
 * kept only when it is one of the game's own, since any path serves the game.
 * A UTM value is kept only when it is a short plain token with a letter in it.
 * Vercel Web Analytics keeps counting visits on its own (`analyticsAdapter.ts`).
 */

/** PostHog's value for a visit with no referrer. */
export const DIRECT = "$direct";

/** A referrer that is an IP address or a local machine name. */
export const OTHER = "$other";

/** The landing paths kept; any other path is sent as {@link OTHER_PATH}. */
export const GAME_PATHS: readonly string[] = ["/", "/index.html"];

/** The path sent for any landing path outside {@link GAME_PATHS}. */
export const OTHER_PATH = "/other";

/** The UTM parameters kept, by their query names. */
export const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign"] as const;

type UtmName = (typeof UTM_PARAMS)[number];

/** The `$pageview` fields. A UTM value is null when the link had none, or one
 *  that is not a short plain token. */
export type PageViewProps = { $referring_domain: string; $pathname: string } & { [K in UtmName]: string | null };

/** A UTM value worth keeping: letters, digits and a few separators, 64 at
 *  most, with at least one letter (so a phone number does not pass). */
const PLAIN_TOKEN = /^(?=.*[A-Za-z])[A-Za-z0-9._+-]{1,64}$/;

/** An IPv4 address (an IPv6 one has brackets in a URL's hostname). */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Endings of local network names. */
const LOCAL_SUFFIXES = [".local", ".lan", ".internal", ".home.arpa"];

/** A host that is not a public site: an IP address, a single-label name
 *  (`localhost`, a machine on the LAN) or a local network name. */
function isLocalHost(host: string): boolean {
  return IPV4.test(host) || host.startsWith("[") || !host.includes(".") || LOCAL_SUFFIXES.some((end) => host.endsWith(end));
}

/** The referrer's host, lowercased; {@link DIRECT} when there is none, it
 *  has no host or it does not parse; {@link OTHER} when it is local. */
function referringDomain(referrer: string): string {
  if (!referrer) return DIRECT;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/\.$/, ""); // `localhost.` is `localhost`
  } catch {
    return DIRECT;
  }
  if (!host) return DIRECT;
  return isLocalHost(host) ? OTHER : host;
}

/** The `$pageview` fields for a referrer and the page's own address. */
export function pageViewProps(referrer: string, href: string): PageViewProps {
  const url = new URL(href);
  const utm = {} as { [K in UtmName]: string | null };
  for (const name of UTM_PARAMS) {
    const value = url.searchParams.get(name);
    utm[name] = value !== null && PLAIN_TOKEN.test(value) ? value : null;
  }
  return { $referring_domain: referringDomain(referrer), $pathname: GAME_PATHS.includes(url.pathname) ? url.pathname : OTHER_PATH, ...utm };
}

/** Send the page life's landing view. Never throws: a page without a readable
 *  location sends nothing. */
export function trackPageView(): void {
  let props: PageViewProps;
  try {
    props = pageViewProps(document.referrer, location.href);
  } catch {
    return;
  }
  trackEvent("$pageview", props);
}

import { trackEvent } from "./analyticsCore";

/**
 * The landing page view (approved 2026-11-13): where a page life came from, so
 * a launch post's traffic can be read next to what those players did. It goes
 * through the cookieless relay like every other event, under PostHog's own
 * `$pageview` name and property names, so PostHog's referrer and UTM
 * breakdowns read it as they are.
 *
 * Only the referrer's host travels, never its path or query (a search or a
 * private page could be in there), and a UTM value is kept only when it is a
 * short plain token. Vercel Web Analytics keeps counting visits on its own
 * (`analyticsAdapter.ts`); this is the relay `$pageview` that module names as
 * the pre-agreed addition.
 */

/** PostHog's value for a visit with no referrer. */
export const DIRECT = "$direct";

/** The UTM parameters kept, by their query names. */
export const UTM_PARAMS = ["utm_source", "utm_medium", "utm_campaign"] as const;

type UtmName = (typeof UTM_PARAMS)[number];

/** The `$pageview` fields. A UTM value is null when the link had none, or one
 *  that is not a short plain token. */
export type PageViewProps = { $referring_domain: string; $pathname: string } & { [K in UtmName]: string | null };

/** The longest path kept; the game's own paths are far shorter. */
const MAX_PATH = 100;

/** A UTM value worth keeping: letters, digits and a few separators, 64 at most. */
const PLAIN_TOKEN = /^[A-Za-z0-9._+-]{1,64}$/;

/** The referrer's host, lowercased, or {@link DIRECT} when there is none or it
 *  does not parse. */
function referringDomain(referrer: string): string {
  if (!referrer) return DIRECT;
  try {
    return new URL(referrer).hostname.toLowerCase() || DIRECT;
  } catch {
    return DIRECT;
  }
}

/** The `$pageview` fields for a referrer and the page's own address. */
export function pageViewProps(referrer: string, href: string): PageViewProps {
  const url = new URL(href);
  const utm = {} as { [K in UtmName]: string | null };
  for (const name of UTM_PARAMS) {
    const value = url.searchParams.get(name);
    utm[name] = value !== null && PLAIN_TOKEN.test(value) ? value : null;
  }
  return { $referring_domain: referringDomain(referrer), $pathname: url.pathname.slice(0, MAX_PATH), ...utm };
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

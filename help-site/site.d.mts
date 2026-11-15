// Types for site.mjs, for the TypeScript test that reads it
// (src/tests/helpSite.test.ts).
export const HELP_ORIGIN: string;
export const HELP_BASE: string;
export const GAME_ORIGIN: string;
export const SITE_ORIGIN: string;
/** A link as the help pages write it (/ for the game, /help/... for the manual) as this build serves it. */
export function siteHref(href: string, base?: string, gameOrigin?: string): string;
export const ENGINE_DOCS: string;
export const GITHUB_ISSUES: string;
export const SPONSOR_URL: string;
export const sharedHead: { tag: string; attrs: Record<string, string> }[];
export type SidebarEntry =
  | { label: string; link: string; attrs?: Record<string, string> }
  | { slug: string }
  | { label: string; items: SidebarEntry[] };
export const sidebar: SidebarEntry[];
export function isSponsorLink(href: string): boolean;
export function sponsorTapListener(track: () => void): (e: MouseEvent) => void;
export function landingAction(pathname: string, referrer: string, origin: string, base?: string): "page_help" | "page_changelog" | null;
/** The page a help page view reports: "rooms/hotels", "home" or "other". */
export function helpPageDetail(pathname: string, base?: string): string;
/** Where each section of the old one-page /help went. */
export const OLD_ANCHORS: Record<string, string>;
export function oldAnchorRedirects(helpIds: Record<string, string>): string;
/** A help page's schema.org structured data (breadcrumbs plus a WebSite or Article). */
export function pageJsonLd(page: { slug: string; title: string; description: string; hasIndex?: string[] }): Record<string, unknown>;
/** A page's share card file name in help-site/public/cards/. */
export function cardFile(slug: string): string;
/** The full URL of a page's share card. */
export function cardUrl(slug: string): string;
/** A page's share card alt text. */
export function cardAlt(title: string): string;

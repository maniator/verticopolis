// Types for site.mjs, for the TypeScript test that reads it
// (src/tests/helpSite.test.ts).
export const HELP_BASE: string;
export const ENGINE_DOCS: string;
export const GITHUB_ISSUES: string;
export const OG_IMAGE_ALT: string;
export const sharedHead: { tag: string; attrs: Record<string, string> }[];
export type SidebarEntry =
  | { label: string; link: string; attrs?: Record<string, string> }
  | { slug: string }
  | { label: string; items: SidebarEntry[] };
export const sidebar: SidebarEntry[];
export function landingAction(pathname: string, referrer: string, origin: string): "page_help" | "page_changelog" | null;
/** The page a help page view reports: "rooms/hotels", "home" or "other". */
export function helpPageDetail(pathname: string): string;
/** Where each section of the old one-page /help went. */
export const OLD_ANCHORS: Record<string, string>;
export function oldAnchorRedirects(helpIds: Record<string, string>): string;
/** A help page's schema.org structured data (breadcrumbs plus a WebSite or Article). */
export function pageJsonLd(page: { slug: string; title: string; description: string; hasIndex?: string[] }): Record<string, unknown>;

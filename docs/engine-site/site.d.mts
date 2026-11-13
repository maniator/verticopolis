// Types for site.mjs, for the TypeScript guard that reads it
// (src/tests/engineDocsSite.guard.test.ts).
export interface MenuLink {
  label?: string;
  link?: string;
  slug?: string;
}
export interface MenuGroup {
  label: string;
  items: MenuLink[];
}
export function siteTitle(ref?: string): string;
export const GITHUB: string;
export const SHORT_TITLE: string;
export const RUST_REFERENCE: string;
export const sidebar: (MenuLink | MenuGroup)[];

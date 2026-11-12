// Types for rustdoc-chrome.mjs, for the TypeScript guard that reads it
// (src/tests/engineDocsSite.guard.test.ts).
import type { MenuGroup, MenuLink } from "../site.d.mts";
export function siteMenu(entries: (MenuLink | MenuGroup)[], titles: Map<string, string>): string;
export function chrome(ref: string): { head: string; before: string; after: string };

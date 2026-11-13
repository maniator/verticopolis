// Type surface for scripts/help-card-pages.mjs, for src/tests/helpSite.test.ts.

export interface HelpCardPage {
  slug: string;
  title: string;
  description: string;
}
export interface CardRecord {
  title: string;
  description: string;
}
export type CardManifest = Record<string, CardRecord>;
export declare const CARD_MANIFEST: string;
export declare const REGENERATE: string;
export function helpPages(): Promise<HelpCardPage[]>;
export function cardManifest(pages: HelpCardPage[], drawn: HelpCardPage[], previous?: CardManifest): CardManifest;
export function staleCards(pages: HelpCardPage[], manifest: CardManifest): string[];

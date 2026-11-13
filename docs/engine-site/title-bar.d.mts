// Types for title-bar.mjs, for the TypeScript tests that read it
// (src/tests/docsTitleBar.test.ts).
export const GAME: string;
export const GITHUB: string;
export const GITHUB_ICON: string;
export function escapeHtml(text: unknown): string;
export function twoLengths(full: string, short: string): string;
export function siteName(full: string, short: string): string;
export function barLinks(options?: { game?: string }): string;

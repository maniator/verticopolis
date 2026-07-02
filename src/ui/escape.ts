/**
 * Escape a string for interpolation into an HTML template — safe for both
 * text content and (quoted) attribute values, since it escapes the quote
 * characters too. The single shared helper for every innerHTML builder;
 * anything user-influenced (tower name, facility labels, imported saves)
 * must pass through it.
 */
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
}

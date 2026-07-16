/**
 * Build-time reader for the player-facing "What's new" notes. `emitVersionJson`
 * (vite.config.ts) calls this with the repo `CHANGELOG.md` and the build's
 * version, and writes the result into `dist/version.json` `notes`, which the
 * update prompt renders.
 *
 * The notes come from a file committed in the tree, not from git commit trailers:
 * the deploy builds from the merge commit on the default branch, whose message
 * carries no branch-commit trailers, so a committed changelog is what reliably
 * survives the merge. This runs only at build time (imported by vite.config.ts,
 * never by the app graph), so `marked` is a devDependency with no browser-bundle
 * or precache cost. It is kept pure (string in, string[] out) and unit-tested.
 *
 * What reaches the update modal is PLAIN TEXT extracted from the parsed markdown,
 * never rendered HTML: the modal is a reload-critical surface, so it keeps lit's
 * auto-escaping and never gains a markdown-to-HTML lane. The client also
 * re-sanitizes via `parseUpdateInfo`, so the caps here are belt-and-suspenders
 * that additionally keep `version.json` small.
 */
import { marked, type Token } from "marked";
import { MAX_NOTES, MAX_NOTE_LEN } from "./pwaUpdateInfo";

/**
 * Plain text of inline content: recurse through inline tokens (so `**bold**`
 * becomes `bold`, a `[label](url)` becomes `label` with the URL dropped). Tokens
 * that are not prose are skipped outright rather than flattened to literal text:
 * a nested `list` (a sub-bullet detail list must not bleed into its note), and
 * `html`/`image`/`code` (raw HTML or an image must not reach the modal even as
 * literal text, so lit's downstream escaping is a second line of defense, not the
 * only one).
 */
function plainText(tokens: Token[] | undefined): string {
  if (!tokens) return "";
  let out = "";
  for (const t of tokens) {
    if (t.type === "list" || t.type === "html" || t.type === "image" || t.type === "code") continue;
    if ("tokens" in t && t.tokens && t.tokens.length) out += plainText(t.tokens);
    else if ("text" in t && typeof t.text === "string") out += t.text;
  }
  return out;
}

/**
 * True when a `## <heading>` names `version`: the first whitespace-delimited
 * token, ignoring a leading `v` and surrounding `[ ]`, so `## 1.2.3`,
 * `## v1.2.3`, `## [1.2.3]`, and `## 1.2.3 - 2026-07-16` all match `1.2.3`,
 * while `## 1.2.30` does not.
 */
function headingNamesVersion(text: string, version: string): boolean {
  const token = text
    .trim()
    .split(/\s+/)[0]
    .replace(/^\[|\]$/g, "")
    .replace(/^v/i, "");
  return token === version;
}

/**
 * The bullet lines under the `## <version>` heading of a Keep-a-Changelog style
 * file, as plain text. Parsed with CommonMark (marked), so heading and list
 * detection is structural rather than regex-guessed. Returns the first list's
 * top-level items (nested sub-bullets ignored), each trimmed and capped to
 * {@link MAX_NOTE_LEN}, at most {@link MAX_NOTES}, or `[]` when the version has no
 * section or no bullets (an internal build with no player notes).
 */
export function notesForVersion(changelog: string, version: string): string[] {
  let inSection = false;
  for (const tok of marked.lexer(changelog)) {
    if (tok.type === "heading" && tok.depth === 2) {
      if (inSection) break; // reached the next version's section
      inSection = headingNamesVersion(tok.text, version);
      continue;
    }
    if (inSection && tok.type === "list") {
      const notes: string[] = [];
      for (const item of tok.items) {
        const text = plainText(item.tokens).trim();
        if (!text) continue;
        notes.push(text.length > MAX_NOTE_LEN ? text.slice(0, MAX_NOTE_LEN) : text);
        if (notes.length >= MAX_NOTES) break;
      }
      return notes;
    }
  }
  return [];
}

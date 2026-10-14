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
    if (t.type === "br") {
      out += " "; // a hard line break must not glue two words together
      continue;
    }
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
 * section or no bullets (an internal build with no player notes). `caps`
 * defaults to the update prompt's limits; the release workflow passes
 * `Infinity` for both so a release page carries every top-level bullet whole.
 */
export function notesForVersion(
  changelog: string,
  version: string,
  caps: { maxNotes: number; maxLen: number } = { maxNotes: MAX_NOTES, maxLen: MAX_NOTE_LEN },
): string[] {
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
        notes.push(text.length > caps.maxLen ? text.slice(0, caps.maxLen) : text);
        if (notes.length >= caps.maxNotes) break;
      }
      return notes;
    }
  }
  return [];
}

/** U+2060 WORD JOINER: invisible, and it splits a token GitHub would link. */
const JOIN = "\u2060";

/**
 * `text` with every character Markdown could read as formatting escaped with
 * a backslash, so a renderer shows the text literally: emphasis and code
 * markers, link and image brackets, raw HTML, entities, GitHub's
 * strikethrough, table pipes and math dollars, and heading hashes. A leading
 * `-` or `+`, or a leading number's `.` or `)`, is escaped too, so the text
 * never opens a list or a rule. Expects one line (callers collapse whitespace).
 *
 * GitHub also links some plain text after it renders the Markdown, where a
 * backslash no longer helps: `@name` mentions (which notify that person),
 * `#123` and `GH-123` references, `:emoji:` codes, bare `www.` and `https://` addresses and
 * commit hashes. Each of those gets an invisible word joiner (U+2060) inside
 * it, so the page shows the same characters without the link.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>~|&$#]/g, "\\$&")
    .replace(/^[-+]|^(\d+)([.)])/, (m, num?: string, mark?: string) => (num === undefined ? `\\${m}` : `${num}\\${mark}`))
    .replace(/([@#])(?=[\p{L}\p{N}_])|(:)(?=[\p{L}/]|[\p{N}+-][\w\\+-]*:)/gu, `$1$2${JOIN}`)
    .replace(/\b(GH-)(?=\d)/gi, `$1${JOIN}`)
    .replace(/\b(www)(?=\.)/gi, `$1${JOIN}`)
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])([0-9a-f]{4})(?=[0-9a-f]{3,}\b)/gi, `$1${JOIN}`);
}

/**
 * The release page's notes for `version`: one Markdown bullet per player note
 * ({@link notesForVersion} with the caps lifted), whitespace collapsed to one
 * line and the plain text escaped ({@link escapeMarkdown}), so a note shows on
 * the page exactly as the update prompt shows it. The atlas release workflow
 * (`.github/workflows/atlas-release.yml`) prints these lines. Empty when the
 * version has no player notes.
 */
export function releaseNoteLines(changelog: string, version: string): string[] {
  return notesForVersion(changelog, version, { maxNotes: Infinity, maxLen: Infinity }).map((n) => `- ${escapeMarkdown(n.replace(/\s+/g, " "))}`);
}

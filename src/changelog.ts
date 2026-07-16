/**
 * Build-time reader for the player-facing "What's new" notes. `emitVersionJson`
 * (vite.config.ts) calls this with the repo `CHANGELOG.md` and the build's
 * version, and writes the result into `dist/version.json` `notes`, which the
 * update prompt renders.
 *
 * The notes come from a file committed in the tree, not from git commit trailers:
 * the deploy builds from the merge commit on the default branch, whose message
 * carries no branch-commit trailers, so a committed changelog is what reliably
 * survives the merge. Kept pure (string in, string[] out) so it is unit-tested
 * without a build. The client re-sanitizes via `parseUpdateInfo`, so these caps
 * are belt-and-suspenders that also keep `version.json` small.
 */
import { MAX_NOTES, MAX_NOTE_LEN } from "./pwaUpdateInfo";

/**
 * Extract the top-level bullet lines under the `## <version>` heading of a
 * Keep-a-Changelog style file. Matching is on the first whitespace-delimited
 * token after `## `, with a leading `v` and surrounding `[ ]` ignored, so
 * `## 1.2.3`, `## v1.2.3`, `## [1.2.3]`, and `## 1.2.3 - 2026-07-16` all match
 * version `1.2.3`, while `## 1.2.30` does not. Only non-indented `-`, `*`, or `+`
 * bullets count (nested sub-bullets are ignored, so a detail list under one note
 * cannot crowd out later notes). Returns the trimmed bullets (each capped to
 * {@link MAX_NOTE_LEN}), at most {@link MAX_NOTES}, or `[]` when the version has
 * no section (an internal build with no player notes).
 */
export function notesForVersion(changelog: string, version: string): string[] {
  const notes: string[] = [];
  let inSection = false;
  for (const line of changelog.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      if (inSection) break; // reached the next version's section
      const token = heading[1]
        .trim()
        .split(/\s+/)[0]
        .replace(/^\[|\]$/g, "")
        .replace(/^v/i, "");
      inSection = token === version;
      continue;
    }
    if (!inSection) continue;
    const bullet = /^[-*+]\s+(.+?)\s*$/.exec(line);
    if (!bullet) continue;
    const text = bullet[1];
    notes.push(text.length > MAX_NOTE_LEN ? text.slice(0, MAX_NOTE_LEN) : text);
    if (notes.length >= MAX_NOTES) break;
  }
  return notes;
}

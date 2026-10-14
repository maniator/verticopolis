import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Links in an installed `node_modules` tree (#974): a hand-made link or an
 * unsaved `npm link` that neither package.json nor a lockfile names. A link's
 * target can sit inside the repository but outside `node_modules`, where the
 * notices would read its code as our own. Checks each package, each `@scope`
 * folder itself, and every nested `node_modules` below them. Dot entries
 * (`.bin`, `.package-lock.json`, `.vite`) are npm's and Vite's own and are
 * skipped. A missing tree passes. `label` is how the tree is named in the
 * problem lines.
 */
export function installedLinkProblems(dir: string, label = "node_modules"): string[] {
  const problems: string[] = [];
  // The tree itself as a link would make every package inside read as a real
  // folder. A missing tree installs nothing, so it has nothing to check.
  const root = entryKind(dir);
  if (root === "link") return [`${label} is a link`];
  if (root === "missing") return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [`${label} cannot be read, so it cannot be checked for linked packages`];
  }
  for (const name of names) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    const rel = `${label}/${name}`;
    let isLink: boolean;
    let isDir: boolean;
    try {
      const st = lstatSync(path);
      isLink = st.isSymbolicLink();
      isDir = st.isDirectory();
    } catch {
      problems.push(`${rel} cannot be read`);
      continue;
    }
    if (isLink) problems.push(`${rel} is a link`);
    else if (!isDir) continue;
    else if (name.startsWith("@")) problems.push(...installedLinkProblems(path, rel));
    else {
      const nested = join(path, "node_modules");
      const kind = entryKind(nested);
      if (kind === "link") problems.push(`${rel}/node_modules is a link`);
      else if (kind === "dir") problems.push(...installedLinkProblems(nested, `${rel}/node_modules`));
      else if (kind === "unreadable") problems.push(`${rel}/node_modules cannot be read, so it cannot be checked for linked packages`);
    }
  }
  return problems;
}

/** What sits at `path`: a link, a folder, nothing ("missing"), something it cannot read, or anything else (null). */
function entryKind(path: string): "link" | "dir" | "missing" | "unreadable" | null {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return "link";
    return st.isDirectory() ? "dir" : null;
  } catch (e) {
    return (e as { code?: unknown }).code === "ENOENT" ? "missing" : "unreadable";
  }
}

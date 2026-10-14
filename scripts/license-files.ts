/**
 * Read a package directory's license and notice files (#951, #955), shared by
 * the notices generator (npm packages) and the WASM build (Rust crates).
 * Returns every LICENSE/COPYING/NOTICE-style file in file-name order, joined
 * with a header per file when there is more than one, and whether any of them
 * carries license terms; an unreadable file is reported as a problem.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { byCodePoint, isLicenseFileName, isLicenseTextFileName, isNoticeFileName } from "../src/build/thirdPartyNotices.ts";

export function readLicenseFiles(dir: string): { licenseText: string; hasLicenseFile: boolean; problems: { file: string; reason: string }[] } {
  const problems: { file: string; reason: string }[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { licenseText: "", hasLicenseFile: false, problems: [{ file: dir, reason: "cannot be listed" }] };
  }
  const files = names
    .filter((n) => isLicenseFileName(n) || isNoticeFileName(n))
    .filter((n) => {
      try {
        return statSync(join(dir, n)).isFile();
      } catch {
        problems.push({ file: join(dir, n), reason: "cannot be read (a broken link?)" });
        return false;
      }
    })
    .sort(byCodePoint);
  const texts = new Map<string, string>();
  for (const n of files) {
    try {
      texts.set(n, readFileSync(join(dir, n), "utf8"));
    } catch {
      problems.push({ file: join(dir, n), reason: "cannot be read" });
    }
  }
  const readable = files.filter((n) => texts.has(n));
  return {
    problems,
    // An empty LICENSE, or a COPYRIGHT line alone, does not count as license text.
    hasLicenseFile: readable.some((n) => isLicenseTextFileName(n) && texts.get(n)!.trim() !== ""),
    licenseText: readable.map((n) => (readable.length > 1 ? `--- ${n} ---\n\n` : "") + texts.get(n)!.trimEnd()).join("\n\n"),
  };
}

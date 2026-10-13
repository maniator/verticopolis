/**
 * The third-party record for the engine's WASM package (#955): every crate
 * the wasm32 build compiles in, plus the Rust standard library, each with its
 * declared license and its license and notice files. `scripts/wasm-build.ts`
 * writes it beside the package as THIRD-PARTY.json, and
 * `scripts/gen-third-party-notices.ts` lists it whenever the engine ships, so
 * a site build needs no Rust toolchain to attribute the engine.
 *
 * The crate list is `cargo metadata` resolved for the same target and
 * features as the build (see `shippedCrates`). Throws, naming every crate at
 * fault, on a missing license file or a license outside the allowlist, so
 * an unattributable engine never gets packaged.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { noticeProblem, shippedCrates, type CargoMetadata, type NoticePackage } from "../src/build/thirdPartyNotices.ts";
import { readLicenseFiles } from "./license-files.ts";

/** The record's file name inside the package directory. */
export const ENGINE_THIRD_PARTY = "THIRD-PARTY.json";

/** The text of an HTML page, for the toolchain's copyright notice. */
function htmlText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|h[1-6]|li|div|tr|pre|ul|ol|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The standard library the toolchain links into every Rust binary, from the toolchain's own copyright notice. */
function standardLibrary(crate: string): NoticePackage {
  const rustc = (args: string[]) => execFileSync("rustc", args, { cwd: crate, encoding: "utf8" }).trim();
  const version = /^rustc (\d+\.\d+\.\d+)/.exec(rustc(["--version"]))?.[1];
  if (!version) throw new Error("rustc --version printed no version");
  const doc = join(rustc(["--print", "sysroot"]), "share", "doc", "rust");
  const files = ["COPYRIGHT-library.html", "licenses/MIT.txt", "licenses/Apache-2.0.txt"].map((f) => join(doc, f));
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length > 0) throw new Error(`the Rust toolchain ships no ${missing.join(", ")}; the standard library cannot be attributed`);
  const [copyright, mit, apache] = files.map((f) => readFileSync(f, "utf8"));
  return {
    name: "Rust standard library",
    version,
    license: "MIT OR Apache-2.0",
    kind: "crate",
    licenseText: [`--- COPYRIGHT-library ---\n\n${htmlText(copyright)}`, `--- MIT ---\n\n${mit.trimEnd()}`, `--- Apache-2.0 ---\n\n${apache.trimEnd()}`].join("\n\n"),
  };
}

/** The record for the crate at `crate` (its directory), built for wasm32 with `features`. */
export function engineThirdParty(crate: string, features: string): NoticePackage[] {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown", "--features", features], {
      cwd: crate,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  ) as CargoMetadata;
  const out: NoticePackage[] = [];
  const problems: string[] = [];
  for (const p of shippedCrates(meta)) {
    const dir = dirname(p.manifest_path);
    const read = readLicenseFiles(dir);
    problems.push(...read.problems);
    let { licenseText, hasLicenseFile } = read;
    // A crate may name its license file in Cargo.toml instead of using a
    // conventional name; that file counts too.
    if (p.license_file) {
      const named = join(dir, p.license_file);
      if (!existsSync(named)) problems.push(`${p.name}@${p.version}: license-file ${p.license_file} does not exist`);
      else {
        const text = readFileSync(named, "utf8").trimEnd();
        if (!licenseText.includes(text)) licenseText = [licenseText, `--- ${p.license_file} ---\n\n${text}`].filter(Boolean).join("\n\n");
        hasLicenseFile ||= text.trim() !== "";
      }
    }
    const pkg = { name: p.name, version: p.version, license: p.license ?? null, licenseText, hasLicenseFile };
    const problem = noticeProblem(pkg);
    if (problem) problems.push(problem);
    else out.push({ name: p.name, version: p.version, license: p.license!, licenseText, kind: "crate" });
  }
  if (problems.length > 0) throw new Error(`the WASM engine cannot be attributed: ${problems.join("; ")}`);
  out.push(standardLibrary(crate));
  return out;
}

/**
 * The third-party record for the engine's WASM package (#955): every crate
 * the wasm32 build compiles in, plus the Rust standard library, each with its
 * declared license and its license and notice files. `scripts/wasm-build.ts`
 * writes it beside the package as THIRD-PARTY.json, and
 * `scripts/gen-third-party-notices.ts` lists it whenever the engine ships, so
 * a site build needs no Rust toolchain to attribute the engine.
 *
 * The record is `{ sources, crates }`: `sources` is the package's BUILD.json
 * source hash, so the notices generator can refuse a record left over from
 * another build. The crate list is `cargo metadata` resolved for the same target and
 * features as the build (see `shippedCrates`). Throws, naming every crate at
 * fault, on a missing license file or a license outside the allowlist, so
 * an unattributable engine never gets packaged.
 *
 * Keep this file ERASABLE (see screenshot-env.ts) so `node` runs it directly.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, isAbsolute, sep } from "node:path";
import { cargoTreePackages, htmlText, noticeProblem, shippedCrates, type CargoMetadata, type NoticePackage } from "../src/build/thirdPartyNotices.ts";
import { readLicenseFiles } from "./license-files.ts";

/** The record's file name inside the package directory. */
export const ENGINE_THIRD_PARTY = "THIRD-PARTY.json";

/** Where the toolchain keeps the standard library's copyright notice and license texts (the rustup layout). */
function toolchainDocs(crate: string): { version: string; files: string[] } {
  // The compiler cargo itself uses: $RUSTC when set, else rustc on PATH.
  const rustc = (args: string[]) => execFileSync(process.env.RUSTC || "rustc", args, { cwd: crate, encoding: "utf8" }).trim();
  const printed = rustc(["--version"]);
  // A stable release only: a beta or nightly ("1.97.0-nightly") links a different standard library.
  const version = /^rustc (\d+\.\d+\.\d+)(?: |$)/.exec(printed)?.[1];
  if (!version) throw new Error(`rustc --version printed "${printed}", which is not a stable release`);
  const doc = join(rustc(["--print", "sysroot"]), "share", "doc", "rust");
  return { version, files: STD_FILES.map((f) => join(doc, f)) };
}

/**
 * The standard library's notice and the license texts for the parts that
 * reach wasm32: the Rust Project's own MIT OR Apache-2.0, the Unicode tables
 * in core (Unicode-3.0), and foldhash in std's hash map (Zlib, whose notice
 * the copyright page carries in full). Parts the page lists under other
 * licenses (an SGX ABI, a Fuchsia mutex) build only for those targets.
 */
const STD_FILES = ["COPYRIGHT-library.html", "licenses/MIT.txt", "licenses/Apache-2.0.txt", "licenses/Unicode-3.0.txt"];
const STD_LICENSE = "(MIT OR Apache-2.0) AND Unicode-3.0 AND Zlib";

/**
 * Refuse a toolchain the record cannot be built from, before any compiling:
 * any release other than the crate's `rust-version` at `.0` (the record names
 * the standard library it links and carries its copyright page, so every
 * build, local, CI or deploy, must link the same one), or one without the
 * rustup doc layout.
 */
export function checkToolchain(crate: string, rustVersion: string): void {
  const { version, files } = toolchainDocs(crate);
  // rust-version names a minor release; its .0 is the one CI and the deploy
  // install (scripts/build-engine-wasm.sh).
  const want = rustVersion.split(".").length === 2 ? `${rustVersion}.0` : rustVersion;
  if (version !== want) {
    throw new Error(`rustc ${version} is not ${want}, the release the engine's notices record is built with; run: rustup toolchain install ${want} --target wasm32-unknown-unknown, then build with RUSTUP_TOOLCHAIN=${want}`);
  }
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length > 0) throw new Error(`the Rust toolchain ships no ${missing.join(", ")}, so the standard library cannot be attributed; install Rust with rustup`);
}

/** The standard library the toolchain links into every Rust binary, from the toolchain's own copyright notice. */
function standardLibrary(crate: string): NoticePackage & { hasLicenseFile: true } {
  const { version, files } = toolchainDocs(crate);
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length > 0) throw new Error(`the Rust toolchain ships no ${missing.join(", ")}; the standard library cannot be attributed`);
  const [copyright, ...licenses] = files.map((f) => readFileSync(f, "utf8"));
  const empty = files.filter((_, i) => (i === 0 ? copyright : licenses[i - 1]).trim() === "");
  if (empty.length > 0) throw new Error(`the Rust toolchain's ${empty.join(", ")} is empty; the standard library cannot be attributed`);
  return {
    name: "Rust standard library",
    version,
    license: STD_LICENSE,
    kind: "crate",
    hasLicenseFile: true,
    licenseText: [
      `--- COPYRIGHT-library ---\n\n${htmlText(copyright)}`,
      ...licenses.map((text, i) => `--- ${STD_FILES[i + 1].replace(/^licenses\/|\.txt$/g, "")} ---\n\n${text.trimEnd()}`),
    ].join("\n\n"),
  };
}

/** The record for the crate at `crate` (its directory), built for wasm32 with `features`. */
export function engineThirdParty(crate: string, features: string): (NoticePackage & { hasLicenseFile: true })[] {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--locked", "--format-version", "1", "--filter-platform", "wasm32-unknown-unknown", "--features", features], {
      cwd: crate,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }),
  ) as CargoMetadata;
  const out: (NoticePackage & { hasLicenseFile: true })[] = [];
  const problems: string[] = [];
  const linked = cargoTreePackages(
    execFileSync("cargo", ["tree", "--locked", "-e", "normal", "--target", "wasm32-unknown-unknown", "--features", features, "--prefix", "none", "--format", "{p}"], {
      cwd: crate,
      encoding: "utf8",
    }),
  );
  const crates = shippedCrates(meta, linked);
  if (crates.length === 0) throw new Error("cargo tree and cargo metadata agree on no crate the WASM engine compiles in; check their output");
  for (const p of crates) {
    const dir = dirname(p.manifest_path);
    const read = readLicenseFiles(dir);
    problems.push(...read.problems.map((f) => `${p.name}@${p.version}: ${f.file} ${f.reason}`));
    let { licenseText, hasLicenseFile } = read;
    // A crate may name its license file in Cargo.toml instead of using a
    // conventional name; that file counts too.
    if (p.license_file) {
      const named = join(dir, p.license_file);
      let text: string | undefined;
      try {
        // Resolved through links, so a link inside the crate cannot reach outside it.
        const inside = relative(realpathSync(dir), realpathSync(named));
        if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
          problems.push(`${p.name}@${p.version}: license-file ${p.license_file} is outside the crate`);
        } else {
          text = readFileSync(named, "utf8").trimEnd();
        }
      } catch (err) {
        problems.push(`${p.name}@${p.version}: license-file ${p.license_file} cannot be read (${(err as NodeJS.ErrnoException).code ?? err})`);
      }
      if (text !== undefined) {
        if (!licenseText.includes(text)) licenseText = [licenseText, `--- ${p.license_file} ---\n\n${text}`].filter(Boolean).join("\n\n");
        hasLicenseFile ||= text.trim() !== "";
      }
    }
    const pkg = { name: p.name, version: p.version, license: p.license ?? null, licenseText, hasLicenseFile };
    const problem = noticeProblem(pkg);
    if (problem) problems.push(problem);
    else out.push({ name: p.name, version: p.version, license: p.license!, licenseText, kind: "crate", hasLicenseFile: true });
  }
  const std = standardLibrary(crate);
  const stdProblem = noticeProblem(std);
  if (stdProblem) problems.push(stdProblem);
  if (problems.length > 0) throw new Error(`the WASM engine cannot be attributed: ${problems.join("; ")}`);
  out.push(std);
  return out;
}

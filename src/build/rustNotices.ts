/**
 * The game's half of the WASM engine's third-party notices (#955): the check
 * of the record every engine build writes beside the package
 * (`THIRD-PARTY.json`), which `scripts/gen-third-party-notices.ts` folds into
 * the notices the game ships. The crate walk over `cargo metadata` and the
 * reading of the Rust toolchain's copyright page live with the engine, in
 * Verticopolis/engine (`src/build/rustNotices.ts`).
 *
 * Keep this file ERASABLE (no enums, namespaces or parameter properties) so
 * `node` can run the scripts that import it directly.
 */
import { noticeProblem, type NoticePackage } from "./thirdPartyNotices.ts";

/** The record's file name inside the engine package. */
export const ENGINE_THIRD_PARTY = "THIRD-PARTY.json";

/** The standard library entry's name and license for wasm32, as the engine's record writes them. */
export const STD_NAME = "Rust standard library";
export const STD_LICENSE = "(MIT OR Apache-2.0) AND Unicode-3.0 AND Zlib";

/**
 * Code ported into the engine from an npm package (#1356). The engine's
 * record must carry the package's notice,
 * marked `kind: "port"`. Paths are relative to the crate directory, and the
 * license text is vendored beside the port (`notice`), so the engine build
 * needs no `node_modules`. The engine's `scripts/engine-third-party.ts` writes the entry,
 * `engineRecordPackages` refuses a record without it, and the notices
 * generator refuses a `node_modules` copy at another version than the port.
 */
export const ENGINE_PORTS: readonly EnginePort[] = [
  { name: "fflate", version: "0.8.3", license: "MIT", source: "src/fflate.rs", notice: "src/fflate" },
];

export interface EnginePort {
  name: string;
  version: string;
  license: string;
  source: string;
  notice: string;
}

/** Each port whose npm package `npm ci` installed at another version than the
 *  one the port follows: the web game and the engine would then write
 *  different `.vctower` bytes (`installed` is null when the package is absent). */
export function portVersionProblems(
  ports: readonly EnginePort[],
  installed: (name: string) => string | null,
): string[] {
  return ports.flatMap((p) => {
    const v = installed(p.name);
    return v === p.version
      ? []
      : [
          `the engine ports ${p.name} ${p.version}, and npm installs ${v ?? "no copy"}: port that version or update ENGINE_PORTS`,
        ];
  });
}

/**
 * The packages in the engine's third-party record (`THIRD-PARTY.json`, which
 * every engine build writes beside the WASM package, #955), checked the way
 * npm packages are, plus every reason the record cannot be trusted. The
 * record must name the package's own `BUILD.json` source hash and the SHA-256
 * of the `.wasm` that ships beside it, so a record left over from another
 * build, or a `.wasm` copied in from one, is refused.
 */
export function engineRecordPackages(
  record: unknown,
  shipped: { sources: unknown; wasm: string | null; ports?: readonly string[] },
): { packages: NoticePackage[]; problems: string[] } {
  const problems: string[] = [];
  const packages: NoticePackage[] = [];
  const r = (typeof record === "object" && record !== null ? record : {}) as {
    sources?: unknown;
    wasm?: unknown;
    crates?: unknown;
  };
  if (typeof r.sources !== "string" || r.sources === "" || r.sources !== shipped.sources) {
    problems.push(
      "the record was not written by the build of the engine that ships (its source hash differs from BUILD.json)",
    );
  }
  if (shipped.wasm === null) problems.push("the engine package ships no verticopolis_engine_bg.wasm");
  else if (r.wasm !== shipped.wasm)
    problems.push("the record was not written for the .wasm that ships (its SHA-256 differs)");

  if (!Array.isArray(r.crates) || r.crates.length === 0)
    return { packages, problems: [...problems, "the record lists no crates"] };
  for (const entry of r.crates as unknown[]) {
    const e = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const crate = {
      name: str(e.name),
      version: str(e.version),
      license: str(e.license) ?? null,
      licenseText: str(e.licenseText),
    };
    const kind = e.kind === "crate" || e.kind === "port" ? e.kind : null;
    const problem =
      noticeProblem({ ...crate, hasLicenseFile: e.hasLicenseFile === true }) ??
      (kind ? null : `${crate.name}@${crate.version} is not marked as a crate or a port`);
    if (problem) problems.push(problem);
    else
      packages.push({
        name: crate.name!,
        version: crate.version!,
        license: crate.license!,
        licenseText: crate.licenseText!,
        kind: kind!,
      });
  }
  for (const name of shipped.ports ?? []) {
    if (!packages.some((p) => p.kind === "port" && p.name === name))
      problems.push(`the record does not list ${name}, whose code the engine ports`);
  }
  const std = packages.filter((p) => p.name === STD_NAME);
  if (std.length === 0) problems.push("the record does not list the Rust standard library");
  else if (std.length > 1) problems.push("the record lists the Rust standard library more than once");
  else if (std[0].license !== STD_LICENSE)
    problems.push(`the record's Rust standard library declares ${std[0].license}, not ${STD_LICENSE}`);
  if (!packages.some((p) => p.kind === "crate" && p.name !== STD_NAME))
    problems.push("the record lists no crate besides the Rust standard library");
  return { packages, problems };
}

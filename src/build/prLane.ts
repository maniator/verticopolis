/**
 * Which Test CI jobs a pull request needs, from the paths it changes
 * (`scripts/pr-lane.ts` runs this in the `changes` job of test.yml).
 *
 * Every changed path gets one kind, and the kinds decide the lane:
 *
 * - `shared`: anything the web game, its tests or its tooling build from,
 *   plus the files both sides share (package and lock files, the Cargo
 *   files, the JavaScript binding in `engine-rs/src/wasm*`, the
 *   conformance suite, this workflow). One shared path runs everything.
 * - `rust`: the rest of `engine-rs/`. The Rust engine workflow tests it,
 *   and Test CI still runs its browser, parity and integration checks, so
 *   only the plain unit run (which the unitWasm parity leg repeats with
 *   the engine package), lint, typecheck and the build are skipped.
 * - `prose`: docs, planning files, root markdown and `.changes` notes.
 *   Guard tests read them (the backlog mirror, the changelog, the change
 *   notes), and the build reads CHANGELOG.md, so the unit tests and the
 *   build still run, without coverage, lint or typecheck.
 * - `meta`: CI metadata no test or build reads. It runs nothing.
 *
 * A rename lists its old path too, so moving a file out of a shared path
 * still counts as shared. An empty list runs everything.
 */

export type PathKind = "shared" | "rust" | "prose" | "meta";

/** `full` runs every job; `rust` and `prose` are the narrower lanes. */
export type Lane = "full" | "rust" | "prose";

export interface PrLane {
  /** The browser, parity and engine package jobs run (application inputs changed). */
  readonly code: boolean;
  /** The test job has anything to run (anything but CI metadata changed). */
  readonly tests: boolean;
  readonly lane: Lane;
}

/** Every job, for main, the merge queue, a release branch and any doubt. */
export const FULL_LANE: PrLane = { code: true, tests: true, lane: "full" };

/** Files under `engine-rs/` that the web game or its tooling also depend on. */
function isSharedEnginePath(path: string): boolean {
  return (
    /^engine-rs\/(consumer\/)?Cargo\.(toml|lock)$/.test(path) ||
    // The JavaScript binding: src/wasm.rs, src/wasm/ and the wasm_* port surface.
    path.startsWith("engine-rs/src/wasm")
  );
}

function isCiMetadata(path: string): boolean {
  return (
    (path.startsWith(".github/workflows/") && path !== ".github/workflows/test.yml") ||
    path.startsWith(".github/ISSUE_TEMPLATE/") ||
    path === ".github/dependabot.yml" ||
    path === ".pr_agent.toml" ||
    path.startsWith("docs/ci/")
  );
}

export function pathKind(path: string): PathKind {
  if (isCiMetadata(path)) return "meta";
  // The help media the app builds in.
  if (path.startsWith("docs/screenshots/")) return "shared";
  if (path.startsWith("docs/") || path.startsWith("_bmad-output/") || path.startsWith(".changes/")) return "prose";
  if (path.startsWith("engine-rs/")) return isSharedEnginePath(path) ? "shared" : "rust";
  if (path.includes("/")) return "shared";
  if (path.endsWith(".md")) return "prose";
  return "shared";
}

export function prLane(paths: readonly string[]): PrLane {
  const kinds = new Set(paths.filter((path) => path !== "").map(pathKind));
  if (kinds.size === 0 || kinds.has("shared")) return FULL_LANE;
  if (kinds.has("rust")) return { code: true, tests: true, lane: "rust" };
  return { code: false, tests: kinds.has("prose"), lane: "prose" };
}

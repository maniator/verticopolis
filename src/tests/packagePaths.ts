/**
 * Where the installed Verticopolis packages live, for the tests and scripts
 * that read their files rather than import their modules: the engine's
 * JSON fixtures, the engine tooling build that the Node suites drive, and
 * the conformance data the referee replays.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = (pkg: string): string => dirname(require.resolve(`${pkg}/package.json`));

/** `@verticopolis/engine`, the player build the game ships. */
export const ENGINE_ROOT = root("@verticopolis/engine");
/** The engine's JSON fixtures (the catalogs, the view layout). */
export const ENGINE_FIXTURES = resolve(ENGINE_ROOT, "fixtures");
/** `@verticopolis/engine/tooling`, the build with the tier 3 ops. */
export const ENGINE_TOOLING_ROOT = resolve(ENGINE_ROOT, "tooling");
/** `@verticopolis/engine/conformance`: scenarios, pinned hashes, fixtures. */
export const CONFORMANCE_ROOT = resolve(ENGINE_ROOT, "conformance");

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** A file a scenario or a fuzz entry names. Their data names fixtures as
 *  `conformance/...`, the engine repository's own folder, which the game
 *  reads from the installed conformance package; any other path is read from
 *  this repository. */
export function conformanceFile(path: string): string {
  return path.startsWith("conformance/")
    ? resolve(CONFORMANCE_ROOT, path.slice("conformance/".length))
    : resolve(REPO, path);
}

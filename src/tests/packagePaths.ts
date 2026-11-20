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

/** `@verticopolis/components`, as installed. */
export const COMPONENTS_ROOT = root("@verticopolis/components");
/** The components' stylesheets as the package ships them: `styles.css` and
 *  `styles/`, laid out as they were under `src/` before the split. */
export const COMPONENT_STYLES = resolve(COMPONENTS_ROOT, "lib");
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

const SRC = resolve(REPO, "src");
/** The `src/` folders that moved to the components package, by their old name. */
const MOVED =
  /^(render|presentation|audio|styles)\/|^ui\/(movableWindow|menuBar|uiModal|modalPrecedence|icons|iconPaths\.generated|format|escape|overviewMapInput|desk\/desk(Window|Geometry))|^styles\.css$/;

/**
 * A file a test reads by its path under `src/`. A file that moved to the
 * components package is read from the package as it ships: a stylesheet
 * as it was, a TypeScript module as its compiled `.js` (the code with its
 * types stripped).
 */
export function srcFile(rel: string): string {
  if (!MOVED.test(rel)) return resolve(SRC, rel);
  return resolve(COMPONENT_STYLES, rel.endsWith(".d.ts") ? rel : rel.replace(/\.ts$/, ".js"));
}

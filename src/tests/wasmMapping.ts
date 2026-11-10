// Plain Node runs the `vitestProjects.ts` child, which imports this file, and
// Node finds a relative import only by its full name. Keep this file's imports
// to `node:` modules, or name a relative one with its `.ts` extension: an
// import without one passes typecheck and lint, and stops the child.
import { execFile } from "node:child_process";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

/** How many of its twin's test files each hosted WASM project leaves out
 *  ({@link wasmMapping}). */
export interface WasmMapping {
  readonly integration: number;
  readonly unit: number;
}

/** Each count the register's section 7 gives, as the code holds it: the
 *  hosted projects' left-out files, the exclusion ratchet's `itTypeScriptOnly` marks and
 *  `atEngineFrameCadence` calls with the files holding each and its
 *  `onWasmParityProject` branches, the files on the TypeScript engine
 *  ratchet and the test files among them, and the converted suites. */
export interface SevenCounts extends WasmMapping {
  readonly marks: number;
  readonly markFiles: number;
  readonly cadence: number;
  readonly cadenceFiles: number;
  readonly branches: number;
  readonly tsEngine: number;
  readonly tsEngineTests: number;
  readonly converted: number;
}

const EXCLUSIONS = "src/tests/parity/exclusions.ratchet.txt";
const TS_ENGINE = "src/tests/tsEngineTests.ratchet.txt";
const CONVERTED = "src/tests/portKit/converted.txt";

/** Where section 7 gives each count, what it counts, and the file that holds
 *  it. A pattern with two groups gives a split, whose parts must add up to
 *  the count, and "no" reads as 0. Each WASM project's count is read only
 *  beside the project's name: another number or a code span between them
 *  reads as no count, so one project's figure never stands for the other's. */
export const SEVEN_COUNTS: readonly (readonly [keyof SevenCounts, RegExp, string, string])[] = [
  ["integration", /`wasmParityProjects`\s+leaves\s+(?:out\s+)?(\d+)\b[^.\d`]*`integrationWasm`/, "integration test files `wasmParityProjects` leaves out of `integrationWasm`", "Vitest's discovery"],
  ["unit", /`unitWasm`[^.\d`]*\b(\d+)\s+unit\s+test\s+files\b/, "`unitWasm` unit test files", "Vitest's discovery"],
  ["marks", /\b(\d+)\s+`itTypeScriptOnly`\s+marks\b/, "`itTypeScriptOnly` marks", EXCLUSIONS],
  ["markFiles", /`itTypeScriptOnly`\s+marks\s+in\s+(\d+)\s+files\b/, "files with `itTypeScriptOnly` marks", EXCLUSIONS],
  ["cadence", /\b(\d+)\s+`atEngineFrameCadence`\s+calls\b/, "`atEngineFrameCadence` calls", EXCLUSIONS],
  ["cadenceFiles", /`atEngineFrameCadence`\s+calls\s+in\s+(\d+)\s+files\b/, "files with `atEngineFrameCadence` calls", EXCLUSIONS],
  ["branches", /\b(no|\d+)\s+`onWasmParityProject`\s+branches\b/, "`onWasmParityProject` branches", EXCLUSIONS],
  ["marks", /\*\*(\d+)\s+tests\*\*[\s\S]*?\*\*(\d+)\s+tests\*\*/, "marks in the two groups", EXCLUSIONS],
  ["tsEngineTests", /\((\d+)\s+test\s+files\s+and\s+\d+\s+fixtures\b/, "test files", TS_ENGINE],
  ["tsEngine", /\((\d+)\s+test\s+files\s+and\s+(\d+)\s+fixtures\b/, "test files and fixtures", TS_ENGINE],
  ["tsEngine", /`src\/tests\/tsEngineTests\.ratchet\.txt`\s+lists\s+(\d+)\s+files\b/, "files", TS_ENGINE],
  ["converted", /`src\/tests\/portKit\/converted\.txt`\s+lists\s+(\d+)\s+suites\b/, "suites", CONVERTED],
];

const lines = (text: string): string[] => text.split("\n").filter((l) => l.trim() !== "" && !l.trimStart().startsWith("#"));
/** Each exclusion ratchet line's count of `name`, NaN where the line lacks
 *  it (the ratchet's own parser requires every field), so a renamed field
 *  fails the count instead of reading as 0. */
const field = (read: (rel: string) => string, name: string): number[] =>
  lines(read(EXCLUSIONS)).map((l) => Number(new RegExp(`\\b${name}=(\\d+)`).exec(l)?.[1] ?? NaN));

/** The files the exclusion ratchet gives `itTypeScriptOnly` marks, by their
 *  names less `.integration.test.ts` or `.test.ts`, as section 7's groups name them. */
export function markedStems(read: (rel: string) => string): string[] {
  const marks = field(read, "itTypeScriptOnly");
  const marked = lines(read(EXCLUSIONS)).filter((_, i) => marks[i] > 0);
  return marked.map((l) => posix.basename(l.trim().split(/\s+/)[0]).replace(/(\.integration)?\.test\.ts$/, ""));
}

/** {@link SevenCounts} from the files `read` returns by repository path and
 *  the hosted WASM projects' {@link wasmMapping}. */
export function sevenCounts(read: (rel: string) => string, mapping: WasmMapping): SevenCounts {
  const list = (rel: string): string[] => lines(read(rel));
  const [marks, cadence, branches] = [field(read, "itTypeScriptOnly"), field(read, "atEngineFrameCadence"), field(read, "onWasmParityProject")];
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  return {
    ...mapping,
    marks: sum(marks),
    markFiles: marks.filter((n) => n > 0).length,
    cadence: sum(cadence),
    cadenceFiles: cadence.filter((n) => n > 0).length,
    branches: sum(branches),
    tsEngine: list(TS_ENGINE).length,
    tsEngineTests: list(TS_ENGINE).filter((l) => /\.test\.ts$/.test(l.trim().split(/\s+/)[0])).length,
    converted: list(CONVERTED).length,
  };
}

/** A test project as Vitest resolves it for a run ({@link vitestProjects}):
 *  its name and the test files Vitest finds for it, as repository paths,
 *  with the ones it would run as type tests apart. */
export interface ProjectFiles {
  readonly name: string;
  readonly files: readonly string[];
  readonly typecheckFiles: readonly string[];
}

/** Each hosted WASM project and the plain project whose tests it hosts. */
const TWINS = { unitWasm: "unit", integrationWasm: "integration" } as const;

/** What starts the line `vitestProjects.ts` prints its projects on. */
export const PROJECTS_LINE = "vitest projects: ";

/** How long the child may take to resolve the projects: a run takes a few
 *  seconds, so this only stops a hung one. It is killed outright, since
 *  Vitest listens for the signal a timeout sends by default. */
const CHILD_TIMEOUT_MS = 120_000;
/** The script the child runs. */
const CHILD_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "vitestProjects.ts");
/** How much the child may print: its line lists every project's test files,
 *  well under this. */
const CHILD_OUTPUT_BYTES = 64 * 1024 * 1024;

const run = promisify(execFile);

/** Whether a variable is one Vitest sets in a test worker and a shell that
 *  starts `vitest run` does not: its own (the `VITEST` ones, the worker and
 *  pool ids among them, and `FORCE_TTY`) and the ones Vite gives a test's
 *  `import.meta.env`. A `test.env` entry or a `VITE_` key from a `.env` file
 *  would pass through; the repository has neither. */
export const workerOnly = (key: string): boolean => key.startsWith("VITEST") || ["MODE", "DEV", "PROD", "SSR", "BASE_URL", "FORCE_TTY"].includes(key);

/** Whether `value` is a list of strings. */
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");

/** What a failed child run says: why, and the end of what it printed. */
const childFailed = (why: string, stdout: string, stderr: string): Error =>
  new Error(`vitestProjects.ts ${why}; stdout ended ${JSON.stringify(stdout.slice(-2000))}, stderr ended ${JSON.stringify(stderr.slice(-2000))}`);

/** A child run Node rejects: one it could not start or that overflowed its
 *  output (a code by name), one that timed out, or one that exited badly. */
export interface ChildRejection {
  readonly code?: number | string | null;
  readonly signal?: string | null;
  readonly killed?: boolean;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** The error for a child run Node rejects ({@link ChildRejection}) after
 *  waiting up to `timeoutMs`. */
export function childRejected(e: ChildRejection, timeoutMs = CHILD_TIMEOUT_MS): Error {
  const output = [e.stdout ?? "", e.stderr ?? ""] as const;
  if (typeof e.code === "string") return childFailed(`failed with ${e.code}`, ...output);
  if (e.killed) return childFailed(`did not finish in ${timeoutMs / 1000} s`, ...output);
  return childFailed(`exited with ${e.signal ?? `code ${e.code}`}`, ...output);
}

/** The projects on the child's last {@link PROJECTS_LINE}, each checked for
 *  the {@link ProjectFiles} shape. The child prints that line after Vitest
 *  closes, so a line a plugin prints earlier is passed over. A missing line
 *  or a bad entry throws, with the end of what the child printed. */
export function parseProjects(stdout: string, stderr = ""): ProjectFiles[] {
  const fail = (why: string): never => {
    throw childFailed(why, stdout, stderr);
  };
  const line = stdout.split("\n").reverse().find((l) => l.startsWith(PROJECTS_LINE)) ?? fail("printed no projects line");
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(PROJECTS_LINE.length));
  } catch {
    return fail("printed a projects line that is not JSON");
  }
  if (!Array.isArray(parsed)) return fail("printed projects that are not a list");
  return parsed.map((p: unknown, i): ProjectFiles => {
    const q = p as Partial<Record<keyof ProjectFiles, unknown>> | null;
    if (typeof q?.name !== "string" || !isStrings(q.files) || !isStrings(q.typecheckFiles)) {
      return fail(`printed project ${i + 1}, which lacks a name, a list of files or a list of type test files`);
    }
    return { name: q.name, files: q.files, typecheckFiles: q.typecheckFiles };
  });
}

/** The test projects Vitest resolves for a bare `vitest run` in `root` under
 *  `VC_REQUIRE_WASM=1`, the switch CI and `npm run test:wasm:parity` set to
 *  add the hosted WASM projects. `vitestProjects.ts` asks Vitest in a child Node process, so
 *  Vitest finds the config and applies all of it (plugins, modes, roots,
 *  in-source tests) as it does for a run, and the switch never reaches this
 *  process. The flags an npm script passes are not part of it. The child gets
 *  this process's environment less the variables Vitest and Vite give a
 *  test worker ({@link workerOnly}). `TEST` and `NODE_ENV` pass through, and
 *  the child sets them as `vitest run` does.
 *  The self-tests pass another `script` and `timeoutMs`. */
export async function vitestProjects(root: string, script = CHILD_SCRIPT, timeoutMs = CHILD_TIMEOUT_MS): Promise<ProjectFiles[]> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !workerOnly(key)));
  const options = { cwd: root, env: { ...env, VC_REQUIRE_WASM: "1" }, timeout: timeoutMs, killSignal: "SIGKILL" as const, maxBuffer: CHILD_OUTPUT_BYTES };
  const { stdout, stderr } = await run(process.execPath, [script], options).catch((e: ChildRejection) => {
    throw childRejected(e, timeoutMs);
  });
  return parseProjects(stdout, stderr);
}

/** How many test files the hosted WASM projects leave out, from the
 *  projects Vitest resolves ({@link vitestProjects}). A hosted project should
 *  run the test files its twin runs, less the converted suites (which start both engines
 *  themselves) and the files it leaves out itself. So it must run no file
 *  its twin does not run, and no converted suite: otherwise a file would run
 *  on the WASM engine alone, or a converted suite a second time, and no count
 *  would move. Every converted suite must be a file one of the twins runs,
 *  or the second rule could pass on a name that matches nothing. The files a
 *  hosted project's twin runs that it does not, past the converted suites,
 *  are its own: `unit` counts them for `unitWasm`, and `integration` for
 *  `integrationWasm`. So a hosted project that leaves out more or fewer
 *  files, by a pattern, an include, a plugin or anything else, moves a
 *  count, while a change that leaves the same files out (two patterns
 *  merged into one, say) moves none. Swapping a left-out file for another
 *  keeps the counts too; the reasons beside the patterns are what a
 *  reviewer reads then. A file its twin leaves out as well moves none,
 *  since each count is measured against the twin. A paired project
 *  with type tests fails, since the counts model none, and so does any
 *  project past the four, which could run the files a count calls left out. */
export function wasmMapping(projects: readonly ProjectFiles[], converted: readonly string[]): WasmMapping {
  const modeled = new Set<string>([...Object.keys(TWINS), ...Object.values(TWINS)]);
  const extra = projects.map((p) => p.name).filter((name) => !modeled.has(name));
  if (extra.length > 0) throw new Error(`Vitest resolves projects the counts do not model: ${JSON.stringify(extra)}`);
  const named = (name: string): ProjectFiles => {
    const p = projects.find((q) => q.name === name);
    if (!p) throw new Error(`Vitest resolves no ${name} project`);
    if (p.typecheckFiles.length > 0) throw new Error(`Vitest runs type tests for ${name}, which the counts do not model: ${JSON.stringify(p.typecheckFiles)}`);
    return p;
  };
  const suites = new Set(converted);
  const twinRun = new Set(Object.values(TWINS).flatMap((twin) => named(twin).files));
  const unknown = [...suites].filter((f) => !twinRun.has(f));
  if (unknown.length > 0) throw new Error(`converted suites that neither ${Object.values(TWINS).join(" nor ")} runs: ${JSON.stringify(unknown)}`);
  const own = (hosted: keyof typeof TWINS): number => {
    const [p, twin] = [named(hosted), named(TWINS[hosted])];
    const [runs, twinRuns] = [new Set(p.files), new Set(twin.files)];
    const alone = [...runs].filter((f) => !twinRuns.has(f));
    if (alone.length > 0) throw new Error(`${hosted} runs ${JSON.stringify(alone)}, which ${twin.name} does not`);
    const twice = [...runs].filter((f) => suites.has(f));
    if (twice.length > 0) throw new Error(`${hosted} runs converted suites, which start both engines themselves: ${JSON.stringify(twice)}`);
    return [...twinRuns].filter((f) => !runs.has(f) && !suites.has(f)).length;
  };
  return { integration: own("integrationWasm"), unit: own("unitWasm") };
}

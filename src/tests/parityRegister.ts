import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import ts from "typescript";
import { repoRel, repoRoot, sourceFiles } from "./guardFiles";
import { NOT_FRONTEND, isTestFile, resolveRelative, scanRuntimeImports } from "./importScan";
import { SEVEN_COUNTS, markedStems, sevenCounts, type SevenCounts, type WasmMapping } from "./wasmMapping";

/**
 * The 3.0 feature parity register (#1561) stays tied to the code. The register
 * is a dated snapshot, but some of its parts would go stale silently, so CI
 * checks them on every commit:
 *
 * - section 3 has exactly one row per `EnginePort` member, so a new engine read
 *   or command cannot ship without a parity class and evidence;
 * - section 2a has exactly one row per file on the frontend's TypeScript engine
 *   import ratchet, so a new runtime import has to say whether it decides gameplay;
 * - section 2c names every file under the host and save directories that
 *   imports the TypeScript engine at run time, in a row or in its prose
 *   (whether the file ships, and so needs a row, is the review's call), and
 *   has no row for a file that no longer does; an import there that the scan
 *   cannot read (a computed specifier) fails unless {@link URL_LOADERS}
 *   names its file and how many it has, since it could hide one;
 * - section 7 counts the test files the hosted WASM projects leave out, as
 *   Vitest resolves them (`integrationWasm` and `unitWasm`; see
 *   `wasmMapping`), and what the exclusion lists hold
 *   (the TypeScript-only marks, cadence calls and branches, the TypeScript
 *   engine ratchet and the converted suites), as {@link SEVEN_COUNTS} lists,
 *   so none of them changes unseen, and its two groups of marks name exactly
 *   the files that hold them;
 * - sections 1, 3, 4, 5, 6 and 8 each carry a Class column, sections 1, 3, 4,
 *   5 and 6 an Evidence column and sections 2a and 2c a Disposition column;
 *   every class and disposition is one of the register's own words, and no
 *   cell is blank (a Notes cell may be);
 * - a `proven same` row sits in a table with an Evidence column, and its
 *   evidence cites a test file (in backticks, so the path check follows it),
 *   a conformance scenario by id, the scenarios as a set, or one of the
 *   register's own sections beside another `proven same` row's name whose
 *   own evidence comes to a test that way (so two rows citing each other
 *   ground neither);
 *   every scenario either document names by id exists, and every section the
 *   register cites by number is one of its own;
 * - every backticked repository path either document cites starts at a known
 *   root and exists, and so does every Markdown link target inside the
 *   repository; the register names a source file or document only by its
 *   path (a file at the repository root, or the text of a link into the
 *   repository, is its own path), and a bare name in
 *   the exception register, a dated snapshot that is not rewritten, names a
 *   file somewhere in the repository;
 * - the `EX-n` it names and the exception register's entries are the same set.
 *
 * It checks the structure only: whether a row's evidence proves its class is
 * the review's job. `audit` returns the problems as text, so the self-tests in
 * `parityRegister.guard.test.ts` can feed it a stale register and see each
 * check fire.
 */

const REGISTER = "_bmad-output/planning-artifacts/release-3.0-parity-register.md";
const EXCEPTIONS = "_bmad-output/planning-artifacts/release-3.0-exception-register.md";
const IMPORT_RATCHET = "src/tests/frontendEngineImports.ratchet.txt";
const PORT = "src/simport/enginePort.ts";

const CLASSES: ReadonlySet<string> = new Set([
  "proven same",
  "known divergence",
  "intentionally different (approved)",
  "untested",
  "retired",
]);
const DISPOSITIONS: ReadonlySet<string> = new Set([
  "keep (presentation)",
  "move to Rust",
  "delete with the TypeScript engine",
  "tooling only",
]);
/** The sections whose table must carry a Class column. */
const CLASSED_SECTIONS = ["1. ", "3. ", "4. ", "5. ", "6. ", "8. "] as const;
/** The sections whose table must carry an Evidence column. Section 8 says
 *  where each item is handled instead, so a `proven same` row cannot sit there. */
const EVIDENCE_SECTIONS = ["1. ", "3. ", "4. ", "5. ", "6. "] as const;
/** The sections whose table must carry a Disposition column. */
const DISPOSITION_SECTIONS = ["2a. ", "2c. "] as const;

/** The roots a cited repository path starts with. */
const PATH_ROOTS = ["src/", "e2e/", "engine-rs/", "conformance/", "scripts/", "docs/", "_bmad-output/", ".github/"];
/** A source file or document named without its directory, which the path check could not follow. */
const BARE_SOURCE = /^[\w.-]+\.(ts|rs|tsx|json|toml|txt|md)$/;
/** A file path with a directory, which must then start at one of {@link PATH_ROOTS}. */
const FILE_PATH = /^[\w.-]+(\/[\w.*-]+)+\.\w+$/;
/** A conformance scenario id (`amenities-modern`), a family of them
 *  (`player-edits-*`), or a fixture's scenario (`fixture-split-tower`). */
const SCENARIO_NAME = /^([a-z0-9]+(-[a-z0-9]+)*-(classic|modern|\*)|fixture-[a-z0-9]+(-[a-z0-9]+)*)$/;
/** A test file, as a `proven same` row's evidence cites it in backticks. */
const TEST_FILE = /\.(test|spec)\.ts$|_tests\.rs$|\/tests\.rs$|^engine-rs\/tests\//;
/** Evidence that stands on the scenarios as a set. */
const SCENARIO_SET = /\bscenarios' checkpoints\b|`conformance\/scenarios\/`/;
/** What separates the numbers in one section citation (a dash marks a
 *  range). Any run of white space counts as a space, around an en dash too,
 *  since the register is wrapped and a citation can break across lines; a
 *  hyphen takes a line break before it only with no space after it, since a
 *  hyphen and a space opening a line are a list item's marker. */
const SECTION_SEPARATOR = String.raw`,\s+and\s+|,\s+or\s+|,\s+|\s+and\s+|\s+or\s+|\s+to\s+|\s+through\s+|\s*\u2013\s*|[^\S\n]*-\s*|\s+-(?=\S)`;
/** The sections the register cites by number: `section 2a`, `Section 2's`,
 *  `sections 1, 4, 5 and 6`, `sections 1, 4, or 6`, `sections 1 to 6`,
 *  `sections 1 through 6`, `section 3 or 4`, `sections 1\u20136`. Another document's section (`the story's section 11`,
 *  `the stories' section 11`, `sections 1 and 2 of the web plan`) is not one,
 *  and the match may not stop short of a list's end. */
const SECTION_CITATION = new RegExp(
  String.raw`(?<!(?:['\u2019]s|s['\u2019])\s+)\bsections?\s+(\d+[a-z]?(?:(?:${SECTION_SEPARATOR})\d+[a-z]?)*)(?![a-z0-9]|\s+of\b|(?:${SECTION_SEPARATOR})\d)`,
  "gi",
);
const SECTION_LIST = new RegExp(SECTION_SEPARATOR, "i");
/** The register's own section numbers, from its headings (`## 1. `, `### 2a. `). */
const SECTION_HEADING = /^#{2,3} (\d+[a-z]?)\. /gm;
/** The host files that load a module by a URL known only at run time, how
 *  many such imports each has, and what they load. Each loads the Rust engine
 *  package's glue from where the package is served, so no TypeScript engine
 *  module can come in that way; another computed import there fails. */
export const URL_LOADERS: ReadonlyMap<string, { readonly imports: number; readonly what: string }> = new Map([
  ["src/wasmhost/engineLoad.ts", { imports: 1, what: "the engine package's glue, on the development route" }],
  ["src/wasmhost/loadEngineModule.ts", { imports: 1, what: "the engine package's glue, from the served package" }],
]);
/** The host and save code the frontend import ratchet leaves to section 2c:
 *  what the frontend guard skips, less the engine and the test tree. */
export const HOST_DIRS = NOT_FRONTEND.filter((dir) => dir !== "src/engine/" && dir !== "src/tests/");

const read = (rel: string): string => readFileSync(resolve(repoRoot, rel), "utf8");

export interface Table {
  readonly heading: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** A row's cells. A `\|` inside a cell is a literal pipe, as in GitHub's tables. */
export function cells(line: string): string[] {
  const ESCAPED = "\u0000";
  return line
    .trim()
    .split("\\|")
    .join(ESCAPED)
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.split(ESCAPED).join("|").trim());
}

const SEPARATOR = /^\|( *:?-+:? *\|)+$/;

/** Every Markdown table in `text`, under the nearest `##` or `###` heading above it. */
export function tables(text: string): Table[] {
  const out: Table[] = [];
  let heading = "";
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{2,3} /.test(line)) heading = line.replace(/^#+ /, "");
    const separator = lines[i + 1];
    if (!line.startsWith("|") || separator === undefined || !SEPARATOR.test(separator.trim())) continue;
    const columns = cells(line);
    const rows: string[][] = [];
    for (i += 2; i < lines.length && lines[i].startsWith("|"); i++) rows.push(cells(lines[i]));
    i--;
    out.push({ heading, columns, rows });
  }
  return out;
}

/** The member names of `EnginePort`: its own and those of every interface it
 *  extends, each once. A member with no plain name fails, since the register
 *  could not give it a row. */
export function portMembers(source: string): string[] {
  const file = ts.createSourceFile(PORT, source, ts.ScriptTarget.Latest, true);
  const interfaces = new Map<string, ts.InterfaceDeclaration[]>();
  file.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, [...(interfaces.get(n.name.text) ?? []), n]);
  });
  const names = new Set<string>();
  const seen = new Set<string>();
  const collect = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const decls = interfaces.get(name);
    if (!decls) throw new Error(`${PORT} has no interface ${name}`);
    for (const decl of decls) {
      for (const m of decl.members) {
        if (!m.name || !(ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))) {
          throw new Error(`${name} has a member with no plain name: ${m.getText(file)}`);
        }
        names.add(m.name.text);
      }
      for (const clause of decl.heritageClauses ?? []) {
        for (const t of clause.types) collect(t.expression.getText(file));
      }
    }
  };
  collect("EnginePort");
  return [...names];
}

/** The files on the import ratchet: the first word of each line that is not a comment. */
export function ratchetFiles(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => l.split(/\s+/)[0]);
}

/** The repository paths `text` cites, repo-relative: backticked paths under a
 *  known root (without a trailing `:line`, `:a-b` or `#anchor`), and Markdown
 *  link targets (inline, in angle brackets or as a reference definition, with
 *  or without a title in any of its three forms), resolved from `fromDir`.
 *  Web links are not paths. */
export function citedPaths(text: string, fromDir: string): string[] {
  const out = new Set<string>();
  const clean = (p: string): string => p.replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, "");
  for (const m of text.matchAll(/`([^`\s]+)`/g)) {
    const p = clean(m[1]);
    // Normalized, so a path that climbs out of its root shows as outside.
    if (PATH_ROOTS.some((root) => p.startsWith(root))) out.add(posix.normalize(p));
  }
  const inline = [...text.matchAll(/\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)].map((m) => m[1] ?? m[2]);
  const defined = [...text.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)].map((m) => m[1] ?? m[2]);
  for (const target of [...inline, ...defined]) {
    if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
    const p = clean(target);
    out.add(posix.normalize(p.startsWith("/") ? p.slice(1) : `${fromDir}/${p}`));
  }
  return [...out].sort();
}

/** Whether `evidence` cites a test file in backticks, a scenario by id, the
 *  scenarios as a set, or one of the register's own sections beside the name
 *  of a grounded `proven same` row (one of `grounded`) other than the row's
 *  own (`own`), which the reader can follow there to its tests. */
export function citesTest(evidence: string, grounded: ReadonlySet<string> = new Set(), own?: string): boolean {
  const backticked = [...evidence.matchAll(/`([^`\s]+)`/g)].map((m) => m[1].replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, ""));
  return (
    backticked.some((p) => TEST_FILE.test(p)) ||
    scenarioNames(evidence).length > 0 ||
    SCENARIO_SET.test(evidence) ||
    (citedSections(evidence).length > 0 && backticked.some((name) => name !== own && grounded.has(name)))
  );
}

/** The section numbers `text` cites, each once. */
export function citedSections(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(SECTION_CITATION)) for (const n of m[1].split(SECTION_LIST)) out.add(n.toLowerCase());
  return [...out].sort();
}

/** Backticked bare source/document names; local Markdown link text is
 * omitted because its target is validated separately. */
export function bareSources(text: string): string[] {
  const linksHome = (target: string | undefined): boolean => target !== undefined && !/^[a-z]+:/i.test(target) && !target.startsWith("#");
  const named = [...text.matchAll(/(\[?)`([^`\s]+)`(?:\]\(([^)\s]+))?/g)].filter((m) => !(m[1] && linksHome(m[3])))
    .map((m) => m[2].replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, ""));
  return [...new Set(named.filter((p) => BARE_SOURCE.test(p)))].sort();
}

/** Backticked file paths that start at none of the known roots, so the path
 *  check would not follow them. */
export function strayPaths(text: string): string[] {
  const paths = [...text.matchAll(/`([^`\s]+)`/g)].map((m) => m[1].replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, ""));
  return [...new Set(paths.filter((p) => FILE_PATH.test(p) && !PATH_ROOTS.some((root) => p.startsWith(root))))].sort();
}

/** The backticked conformance scenario ids and families `text` names. */
export function scenarioNames(text: string): string[] {
  return [...new Set([...text.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).filter((n) => SCENARIO_NAME.test(n)))].sort();
}

/** The prose and tables under the heading that starts with `start`, up to the next heading. */
export function sectionText(text: string, start: string): string {
  const lines = text.split("\n");
  const from = lines.findIndex((l) => /^#{2,3} /.test(l) && l.replace(/^#+ /, "").startsWith(start));
  if (from < 0) return "";
  const to = lines.findIndex((l, i) => i > from && /^#{2,3} /.test(l));
  return lines.slice(from, to < 0 ? undefined : to).join("\n");
}

export const sorted = (xs: Iterable<string>): string[] => [...xs].sort();

/** Each set difference, as text. */
function sameSet(what: string, have: Iterable<string>, want: Iterable<string>): string[] {
  const h = new Set(have);
  const w = new Set(want);
  return [
    ...sorted([...w].filter((x) => !h.has(x))).map((x) => `${what}: no row for ${x}`),
    ...sorted([...h].filter((x) => !w.has(x))).map((x) => `${what}: a row for ${x}, which is gone`),
  ];
}

export interface AuditInput {
  readonly register: string;
  readonly exceptions: string;
  readonly members: readonly string[];
  readonly ratchet: readonly string[];
  /** The non-test files under {@link HOST_DIRS} that import the TypeScript engine at run time. */
  readonly hostImporters: readonly string[];
  /** The imports under {@link HOST_DIRS} the scan could not read, as `file:line`. */
  readonly hostUnreadable: readonly string[];
  /** {@link sevenCounts}: what the code holds of each count section 7 gives. */
  readonly sevenCounts: SevenCounts;
  /** {@link markedStems}: the files with TypeScript-only marks, which section 7's two groups name. */
  readonly markedStems: readonly string[];
  /** The base names of the repository's files, for the exception register's bare names and section 7's group names. */
  readonly basenames: ReadonlySet<string>;
  /** The conformance scenario ids. */
  readonly scenarios: readonly string[];
  readonly exists: (repoPath: string) => boolean;
}

/** Every way `register` has drifted from the code, as text; empty when it has not. */
export function audit(input: AuditInput): string[] {
  const problems: string[] = [];
  const all = tables(input.register);
  const found = new Map<string, Table | undefined>();
  const one = (start: string): Table | undefined => {
    if (!found.has(start)) {
      const under = all.filter((t) => t.heading.startsWith(start));
      if (under.length !== 1) problems.push(`expected one table under "${start}", found ${under.length}`);
      found.set(start, under.length === 1 ? under[0] : undefined);
    }
    return found.get(start);
  };
  const needs = (sections: readonly string[], column: string): void => {
    for (const start of sections) {
      const t = one(start);
      if (t && !t.columns.includes(column)) problems.push(`"${t.heading}" has no ${column} column`);
    }
  };
  const firstQuoted = (t: Table, column: string): string[] => {
    const at = t.columns.indexOf(column);
    if (at < 0) {
      problems.push(`"${t.heading}" has no ${column} column`);
      return [];
    }
    return t.rows.map((r) => /`([^`]+)`/.exec(r[at] ?? "")?.[1] ?? `(no name in "${r[at]}")`);
  };
  const listed = (what: string, names: string[]): string[] => {
    const twice = sorted(new Set(names.filter((n, i) => names.indexOf(n) !== i)));
    problems.push(...twice.map((n) => `${what}: ${n} has more than one row`));
    return names;
  };

  const members = one("3. ");
  if (members) problems.push(...sameSet("section 3", listed("section 3", firstQuoted(members, "Member")), input.members));
  const imports = one("2a. ");
  if (imports) problems.push(...sameSet("section 2a", listed("section 2a", firstQuoted(imports, "File")), input.ratchet));
  const hosts = one("2c. ");
  if (hosts) {
    const rows = listed("section 2c", firstQuoted(hosts, "File"));
    const named = new Set(citedPaths(sectionText(input.register, "2c. "), dirname(REGISTER)));
    problems.push(...sorted(input.hostImporters.filter((f) => !named.has(f))).map((f) => `section 2c: ${f} imports the TypeScript engine at run time and is not named`));
    problems.push(...sorted(rows.filter((f) => !input.hostImporters.includes(f))).map((f) => `section 2c: a row for ${f}, which imports no engine module at run time`));
  }
  const fileOf = (at: string): string => at.replace(/:\d+$/, "");
  const loaders = new Map<string, number>();
  for (const at of input.hostUnreadable) loaders.set(fileOf(at), (loaders.get(fileOf(at)) ?? 0) + 1);
  problems.push(
    ...input.hostUnreadable
      .filter((at) => !URL_LOADERS.has(fileOf(at)))
      .map((at) => `section 2c: ${at} imports something the scan cannot read, which could hide an engine import`),
  );
  for (const file of sorted([...loaders.keys()].filter((f) => URL_LOADERS.has(f)))) {
    const found = loaders.get(file);
    const expected = URL_LOADERS.get(file)?.imports;
    if (found !== expected) problems.push(`section 2c: URL_LOADERS expects ${expected} import(s) the scan cannot read in ${file}, and it has ${found}, which could hide an engine import`);
  }
  problems.push(...sorted([...URL_LOADERS.keys()].filter((f) => !loaders.has(f))).map((f) => `URL_LOADERS lists ${f}, which loads nothing by a computed URL`));
  const seven = sectionText(input.register, "7. ");
  for (const [key, pattern, what, source] of SEVEN_COUNTS) {
    const parts = pattern.exec(seven)?.slice(1);
    const [given, have] = [parts?.reduce((n, p) => n + (p === "no" ? 0 : Number(p)), 0), input.sevenCounts[key]];
    if (given === undefined) problems.push(`section 7: the register gives no count of the ${what}, and ${source} lists ${have}`);
    else if (Number(given) !== have) problems.push(`section 7: counts ${given} ${what}, and ${source} lists ${have}`);
  }
  const grouped = new Set([...(seven.match(/^- \*\*\d+\s+tests\*\*.*(?:\r?\n {2}.*)*/gm) ?? []).join("\n").matchAll(/`(\w+)`/g)].map((m) => m[1]));
  problems.push(...input.markedStems.filter((s) => !grouped.has(s)).map((s) => `section 7: neither group names \`${s}\`, which has TypeScript-only marks`));
  const unmarked = [...grouped].filter((s) => !input.markedStems.includes(s) && [`${s}.integration.test.ts`, `${s}.test.ts`].some((f) => input.basenames.has(f)));
  problems.push(...unmarked.map((s) => `section 7: a group names \`${s}\`, which has no TypeScript-only marks`));

  needs(CLASSED_SECTIONS, "Class");
  needs(EVIDENCE_SECTIONS, "Evidence");
  needs(DISPOSITION_SECTIONS, "Disposition");
  const firstName = (row: readonly string[]): string | undefined => /`([^`]+)`/.exec(row[0] ?? "")?.[1];
  // A row is grounded when its evidence comes to a test, directly or through
  // grounded rows; growing the set to a fixed point grounds no cycle.
  const provenRows = all.flatMap((t) => {
    const [classAt, evidenceAt] = [t.columns.indexOf("Class"), t.columns.indexOf("Evidence")];
    return classAt < 0 || evidenceAt < 0 ? [] : t.rows.filter((r) => r[classAt] === "proven same").map((r) => ({ name: firstName(r), evidence: r[evidenceAt] ?? "" }));
  });
  const grounded = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const { name, evidence } of provenRows) {
      if (name === undefined || grounded.has(name) || !citesTest(evidence, grounded, name)) continue;
      grounded.add(name);
      grew = true;
    }
  }
  for (const t of all) {
    const classAt = t.columns.indexOf("Class");
    const evidenceAt = t.columns.indexOf("Evidence");
    const dispositionAt = t.columns.indexOf("Disposition");
    for (const row of t.rows) {
      const label = `"${t.heading}", row ${row[0]}`;
      if (classAt < 0 && row.some((cell) => CLASSES.has(cell))) problems.push(`${label}: a class in a table with no Class column`);
      if (row.length !== t.columns.length) problems.push(`${label}: ${row.length} cells for ${t.columns.length} columns`);
      row.forEach((cell, i) => {
        if (cell === "" && t.columns[i] !== "Notes") problems.push(`${label}: blank ${t.columns[i]}`);
      });
      if (classAt >= 0 && !CLASSES.has(row[classAt])) problems.push(`${label}: class "${row[classAt]}"`);
      if (classAt >= 0 && row[classAt] === "proven same") {
        const evidence = evidenceAt >= 0 ? row[evidenceAt] ?? "" : undefined;
        if (evidence === undefined) problems.push(`${label}: proven same, in a table with no Evidence column`);
        else if (!citesTest(evidence, grounded, firstName(row))) {
          problems.push(`${label}: proven same, but the evidence cites no test, scenario or section`);
        }
      }
      if (dispositionAt >= 0 && !DISPOSITIONS.has(row[dispositionAt])) problems.push(`${label}: disposition "${row[dispositionAt]}"`);
    }
  }

  const registerDir = dirname(REGISTER);
  for (const [doc, text] of [[REGISTER, input.register], [EXCEPTIONS, input.exceptions]] as const) {
    for (const p of citedPaths(text, registerDir)) {
      if (p === ".." || p.startsWith("../")) problems.push(`${doc} links to ${p}, outside the repository`);
      else if (!input.exists(p)) problems.push(`${doc} cites ${p}, which does not exist`);
    }
    problems.push(...strayPaths(text).map((p) => `${doc} cites ${p}, outside the roots the path check follows`));
  }
  problems.push(...bareSources(input.register).filter((p) => !input.exists(p)).map((p) => `${REGISTER} names ${p} without its path`));
  problems.push(...bareSources(input.exceptions).filter((p) => !input.basenames.has(p)).map((p) => `${EXCEPTIONS} names ${p}, which no file in the repository is called`));
  for (const [doc, text] of [[REGISTER, input.register], [EXCEPTIONS, input.exceptions]] as const) {
    for (const name of scenarioNames(text)) {
      const id = new RegExp(`^${name.replace(/\*/g, "[a-z0-9-]+")}$`);
      if (!input.scenarios.some((s) => id.test(s))) problems.push(`${doc} names scenario ${name}, which does not exist`);
    }
  }
  const sections = new Set([...input.register.matchAll(SECTION_HEADING)].map((m) => m[1]));
  problems.push(...citedSections(input.register).filter((n) => !sections.has(n)).map((n) => `${REGISTER} cites section ${n}, which it does not have`));

  const entries = new Set([...input.exceptions.matchAll(/^## (EX-\d+):/gm)].map((m) => m[1]));
  const named = new Set([...input.register.matchAll(/\bEX-\d+\b/g)].map((m) => m[0]));
  problems.push(...sorted([...named].filter((ex) => !entries.has(ex))).map((ex) => `${ex} is not in the exception register`));
  problems.push(...sorted([...entries].filter((ex) => !named.has(ex))).map((ex) => `${ex} has no row in the register`));
  return problems;
}

/** The non-test files under {@link HOST_DIRS} with a runtime import of
 *  `src/engine/`, and the imports there the scan could not read. */
function hostEngineImports(): { importers: string[]; unreadable: string[] } {
  const engine = (rel: string, spec: string): boolean => {
    const target = resolveRelative(rel, spec);
    return target === "src/engine" || target?.startsWith("src/engine/") === true;
  };
  const importers: string[] = [];
  const unreadable: string[] = [];
  const files = HOST_DIRS.flatMap((dir) => sourceFiles(dir, [".ts", ".tsx"]).map(repoRel)).filter((rel) => !rel.endsWith(".d.ts") && !isTestFile(rel));
  for (const rel of files) {
    const scan = scanRuntimeImports(rel, read(rel));
    if (scan.imports.some((i) => engine(rel, i.spec))) importers.push(rel);
    unreadable.push(...scan.unreadable);
  }
  return { importers: importers.sort(), unreadable: unreadable.sort() };
}

/** The base names of the files git tracks, and of any new file it does not
 *  ignore, so a name in a file not yet added passes before `git add` and a
 *  file git ignores (a build output, a local scratch file) never counts. The
 *  buffer leaves room for a working tree with many untracked files. */
function repoBasenames(): Set<string> {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // A tracked file deleted and not yet staged is still listed; it names nothing.
  return new Set(out.split("\0").filter((f) => f !== "" && existsSync(resolve(repoRoot, f))).map((f) => posix.basename(f)));
}

/** The register, the exception register and the code as they stand, with the
 *  hosted WASM projects' counts from the projects Vitest resolves. */
export const live = (mapping: WasmMapping): AuditInput => {
  const host = hostEngineImports();
  return {
    register: read(REGISTER),
    exceptions: read(EXCEPTIONS),
    members: portMembers(read(PORT)),
    ratchet: ratchetFiles(read(IMPORT_RATCHET)),
    hostImporters: host.importers,
    hostUnreadable: host.unreadable,
    sevenCounts: sevenCounts(read, mapping),
    markedStems: markedStems(read),
    basenames: repoBasenames(),
    scenarios: readdirSync(resolve(repoRoot, "conformance/scenarios")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -".json".length)),
    exists: (p) => existsSync(resolve(repoRoot, p)),
  };
};

import { describe, expect, it } from "vitest";
import { HOST_DIRS, URL_LOADERS, audit, citedPaths, live, portMembers, sorted, tables, type AuditInput } from "./parityRegister";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { repoRoot } from "./guardFiles";
import { convertedSuites } from "./portKit/convertedList";
import { PROJECTS_LINE, childRejected, markedStems, parseProjects, sevenCounts, vitestProjects, wasmMapping, workerOnly, type ProjectFiles, type SevenCounts } from "./wasmMapping";

/** The 3.0 parity register's guard (#1561): what it checks, and why, is in
 *  `parityRegister.ts`; these run the audit on the register as it stands and
 *  feed it stale registers to see each check fire. */

/** The test projects Vitest resolves for a run with the hosted WASM projects
 *  on, and the test files it finds for each ({@link vitestProjects}). */
const resolved = await vitestProjects(repoRoot);

/** The hosted WASM projects' counts, from the projects Vitest resolves. */
const mapping = wasmMapping(resolved, convertedSuites());

describe("the 3.0 parity register stays tied to the code (#1561)", () => {
  it("matches EnginePort, the import ratchet, its own vocabulary, the files it cites and the exception register", () => {
    expect(audit(live(mapping))).toEqual([]);
  });
});

describe("the parity register audit catches a stale register", () => {
  const base = live(mapping);
  const tick = "| `tick` | lifecycle | proven same |";
  const problems = (edit: Partial<AuditInput>): string[] => audit({ ...base, ...edit });

  it("a member with no row, and a row for a member that is gone", () => {
    expect(problems({ members: [...base.members, "newRead"] })).toContain("section 3: no row for newRead");
    expect(problems({ members: base.members.filter((m) => m !== "tick") })).toContain("section 3: a row for tick, which is gone");
  });

  it("a file on the ratchet with no row", () => {
    expect(problems({ ratchet: [...base.ratchet, "src/game/newImport.ts"] })).toContain("section 2a: no row for src/game/newImport.ts");
  });

  it("a made-up class, a blank cell and a short row", () => {
    expect(base.register).toContain(tick);
    expect(problems({ register: base.register.replace(tick, "| `tick` | lifecycle | sort of same |") }).join("\n")).toContain('class "sort of same"');
    expect(problems({ register: base.register.replace(tick, "| `tick` | lifecycle |  |") }).join("\n")).toContain("blank Class");
    expect(problems({ register: base.register.replace(/\| `tick` \| lifecycle \| proven same \|[^\n]*/, "| `tick` | lifecycle |") }).join("\n")).toContain("2 cells for 4 columns");
  });

  it("a missing path, a bare file name, a broken link and an unknown exception", () => {
    const extra = (s: string) => problems({ register: `${base.register}\n${s}\n` }).join("\n");
    expect(extra("`src/tests/gone.test.ts`")).toContain("cites src/tests/gone.test.ts, which does not exist");
    expect(extra("`cardKit.ts`")).toContain("names cardKit.ts without its path");
    expect(extra("[gone](gone.md)")).toContain("cites _bmad-output/planning-artifacts/gone.md, which does not exist");
    expect(extra("EX-99")).toContain("EX-99 is not in the exception register");
  });

  it("a host or save file with a runtime engine import that section 2c does not name, and a 2c row for one that has none", () => {
    expect(base.hostImporters).toEqual(expect.arrayContaining(["src/storage/SaveGame.ts", "src/wasmhost/wasmHost.ts"]));
    expect(problems({ hostImporters: [...base.hostImporters, "src/storage/newLoader.ts"] })).toContain(
      "section 2c: src/storage/newLoader.ts imports the TypeScript engine at run time and is not named",
    );
    expect(problems({ hostImporters: base.hostImporters.filter((f) => f !== "src/storage/SaveGame.ts") })).toContain(
      "section 2c: a row for src/storage/SaveGame.ts, which imports no engine module at run time",
    );
  });

  it("a host import the scan cannot read, unless a listed loader makes it, and a listed loader that makes none", () => {
    expect(base.hostUnreadable.length).toBeGreaterThan(0);
    expect(base.hostUnreadable.every((at) => URL_LOADERS.has(at.replace(/:\d+$/, "")))).toBe(true);
    expect(problems({ hostUnreadable: [...base.hostUnreadable, "src/storage/newLoader.ts:3"] })).toContain(
      "section 2c: src/storage/newLoader.ts:3 imports something the scan cannot read, which could hide an engine import",
    );
    expect(problems({ hostUnreadable: base.hostUnreadable.filter((at) => !at.startsWith("src/wasmhost/engineLoad.ts:")) })).toContain(
      "URL_LOADERS lists src/wasmhost/engineLoad.ts, which loads nothing by a computed URL",
    );
    // A listed loader's file may not gain another computed import unseen.
    const expected = URL_LOADERS.get("src/wasmhost/engineLoad.ts")?.imports ?? 0;
    expect(problems({ hostUnreadable: [...base.hostUnreadable, "src/wasmhost/engineLoad.ts:999"] })).toContain(
      `section 2c: URL_LOADERS expects ${expected} import(s) the scan cannot read in src/wasmhost/engineLoad.ts, and it has ${expected + 1}, which could hide an engine import`,
    );
  });

  it("reads the test projects and files Vitest resolves for a run with the hosted WASM projects on", () => {
    // The four paired projects, each with the test files Vitest finds for it,
    // as repository paths, and no type tests.
    const paired = ["unit", "integration", "unitWasm", "integrationWasm"].map((name) => resolved.find((p) => p.name === name));
    for (const p of paired) {
      expect(p?.files.length).toBeGreaterThan(0);
      expect(p?.typecheckFiles).toEqual([]);
    }
    const inRepo = (f: string) => !f.includes("\\") && !isAbsolute(f) && !f.startsWith("../") && existsSync(join(repoRoot, f));
    expect(paired.flatMap((p) => (p?.files ?? []).filter((f) => !inRepo(f)))).toEqual([]);
    // The child's line is found past anything else it prints, and is held to
    // the shape; each failure names what went wrong and quotes the output.
    const one = { name: "unit", files: ["u/a.test.ts"], typecheckFiles: [] };
    expect(parseProjects(`warning\n${PROJECTS_LINE}${JSON.stringify([one])}\nbye\n`)).toEqual([one]);
    // A line a plugin prints first is passed over: the child prints its own last.
    expect(parseProjects(`${PROJECTS_LINE}resolving\n${PROJECTS_LINE}${JSON.stringify([one])}\n`)).toEqual([one]);
    const refused = (stdout: string, why: string) =>
      expect(() => parseProjects(stdout, "err")).toThrow(new Error(`vitestProjects.ts ${why}; stdout ended ${JSON.stringify(stdout)}, stderr ended "err"`));
    refused(JSON.stringify([one]), "printed no projects line");
    refused(`${PROJECTS_LINE}[{`, "printed a projects line that is not JSON");
    refused(`${PROJECTS_LINE}{}`, "printed projects that are not a list");
    for (const bad of [null, { ...one, name: 1 }, { ...one, files: "u/a.test.ts" }, { ...one, files: ["u/a.test.ts", 1] }, { ...one, typecheckFiles: undefined }]) {
      refused(`${PROJECTS_LINE}${JSON.stringify([one, bad])}`, "printed project 2, which lacks a name, a list of files or a list of type test files");
    }
    // A child run Node rejects says why, with the end of its output.
    const rejected = (why: string) => new Error(`vitestProjects.ts ${why}; stdout ended "out", stderr ended "err"`);
    expect(childRejected({ killed: true, code: null, signal: "SIGKILL", stdout: "out", stderr: "err" })).toEqual(rejected("did not finish in 120 s"));
    expect(childRejected({ killed: false, code: 1, signal: null, stdout: "out", stderr: "err" })).toEqual(rejected("exited with code 1"));
    expect(childRejected({ killed: false, code: null, signal: "SIGSEGV", stdout: "out", stderr: "err" })).toEqual(rejected("exited with SIGSEGV"));
    expect(childRejected({ killed: true, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "out", stderr: "err" })).toEqual(rejected("failed with ERR_CHILD_PROCESS_STDIO_MAXBUFFER"));
    // The child drops the variables Vitest and Vite give a test worker.
    expect(["VITEST", "VITEST_POOL_ID", "VITEST_WORKER_ID", "MODE", "DEV", "PROD", "SSR", "BASE_URL", "FORCE_TTY"].filter((k) => !workerOnly(k))).toEqual([]);
    expect(["PATH", "HOME", "VC_REQUIRE_WASM", "CI"].filter(workerOnly)).toEqual([]);
  });

  it("starts its child without a test worker's variables, kills one that hangs, and is not held by a handle a plugin leaves open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vitest-projects-"));
    try {
      // The child sees no test worker's variables, and the WASM switch.
      const echo = join(dir, "echo.mjs");
      const named = "[process.env.VITEST_WORKER_ID, process.env.MODE, process.env.VC_REQUIRE_WASM].join()";
      writeFileSync(echo, `process.stdout.write(${JSON.stringify(PROJECTS_LINE)} + JSON.stringify([{ name: ${named}, files: [], typecheckFiles: [] }]));`);
      expect(await vitestProjects(dir, echo)).toEqual([{ name: ",,1", files: [], typecheckFiles: [] }]);
      // One that ignores the signal a timeout sends by default is still
      // stopped. Its loop ends by itself, so a guard that fails to stop it
      // leaves nothing running. Only the message's start is matched, since
      // Node can print to stderr first (under a debugger, say).
      const hang = join(dir, "hang.mjs");
      writeFileSync(hang, 'process.on("SIGTERM", () => {}); for (const end = Date.now() + 20_000; Date.now() < end; );');
      await expect(vitestProjects(dir, hang, 1000)).rejects.toThrow(/^vitestProjects\.ts did not finish in 1 s; stdout ended ""/);
      // The real child, on a config whose plugin keeps a timer running,
      // still exits once it has printed its line, and the config sees the
      // `VITEST` and `TEST` that `vitest run` sets.
      const config = "{ test: { name: [process.env.VITEST, process.env.TEST].join() }, plugins: [{ name: \"open\", configResolved() { setInterval(() => {}, 1000); } }] }";
      writeFileSync(join(dir, "vitest.config.mjs"), `export default ${config};`);
      expect(await vitestProjects(dir, undefined, 25_000)).toEqual([{ name: "true,true", files: [], typecheckFiles: [] }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("a section 7 count of the WASM projects' test files or the exclusion lists that is missing or stale", () => {
    // The counts read the projects Vitest resolves: the files each hosted
    // project's twin runs and it does not, past the converted suites.
    const project = (name: string, files: string[]): ProjectFiles => ({ name, files, typecheckFiles: [] });
    const projects = (edit: Record<string, Partial<ProjectFiles>> = {}): ProjectFiles[] =>
      [
        project("unit", ["u/a.test.ts", "u/b.test.ts", "u/c.test.ts", "u/suite.test.ts"]),
        project("integration", ["i/a.integration.test.ts", "i/b.integration.test.ts", "i/c.integration.test.ts", "suite"]),
        project("unitWasm", ["u/a.test.ts", "u/b.test.ts"]),
        project("integrationWasm", ["i/c.integration.test.ts"]),
      ].map((p) => ({ ...p, ...edit[p.name] }));
    const counted = (ps: ProjectFiles[], suites = ["suite", "u/suite.test.ts"]) => wasmMapping(ps, suites);
    expect(counted(projects())).toEqual({ integration: 2, unit: 1 });
    // A hosted project that leaves out more of its twin's files, by any
    // means, moves its count.
    expect(counted(projects({ unitWasm: { files: ["u/a.test.ts"] } }))).toEqual({ integration: 2, unit: 2 });
    expect(counted(projects({ integrationWasm: { files: [] } }))).toEqual({ integration: 3, unit: 1 });
    // It may run no file its twin does not run, and no converted suite (named
    // once however often the converted list names it); each hosted project is
    // held to both.
    expect(() => counted(projects({ unitWasm: { files: ["u/a.test.ts", "u/b.test.ts", "u/d.test.ts", "i/a.integration.test.ts"] } }))).toThrow(
      new Error('unitWasm runs ["u/d.test.ts","i/a.integration.test.ts"], which unit does not'),
    );
    expect(() => counted(projects({ integrationWasm: { files: ["i/c.integration.test.ts", "i/d.integration.test.ts"] } }))).toThrow(
      new Error('integrationWasm runs ["i/d.integration.test.ts"], which integration does not'),
    );
    expect(() => counted(projects({ integrationWasm: { files: ["i/c.integration.test.ts", "suite"] } }), ["suite", "suite"])).toThrow(
      new Error('integrationWasm runs converted suites, which start both engines themselves: ["suite"]'),
    );
    expect(() => counted(projects({ unitWasm: { files: ["u/a.test.ts", "u/suite.test.ts"] } }))).toThrow(
      new Error('unitWasm runs converted suites, which start both engines themselves: ["u/suite.test.ts"]'),
    );
    // Every converted suite must be a file a twin runs.
    expect(() => counted(projects(), ["suite", "gone.integration.test.ts"])).toThrow(
      new Error('converted suites that neither unit nor integration runs: ["gone.integration.test.ts"]'),
    );
    // Each of the four must be there, with no type tests, and no other project.
    expect(() => counted(projects().filter((p) => p.name !== "integrationWasm"))).toThrow(new Error("Vitest resolves no integrationWasm project"));
    expect(() => counted([...projects(), project("integrationWasmReferees", ["i/a.integration.test.ts"])])).toThrow(
      new Error('Vitest resolves projects the counts do not model: ["integrationWasmReferees"]'),
    );
    expect(() => counted(projects({ unit: { typecheckFiles: ["u/a.test-d.ts"] } }))).toThrow(
      new Error('Vitest runs type tests for unit, which the counts do not model: ["u/a.test-d.ts"]'),
    );
    const { integration, unit: files, marks, converted, tsEngineTests } = base.sevenCounts;
    const recount = (edit: Partial<SevenCounts>) => problems({ sevenCounts: { ...base.sevenCounts, ...edit } });
    expect(recount({ integration: integration + 1 })).toContain(
      `section 7: counts ${integration} integration test files \`wasmParityProjects\` leaves out of \`integrationWasm\`, and Vitest's discovery lists ${integration + 1}`,
    );
    expect(recount({ unit: files + 1 })).toContain(`section 7: counts ${files} \`unitWasm\` unit test files, and Vitest's discovery lists ${files + 1}`);
    // The exclusion lists' counts are held to the lists the same way.
    expect(recount({ marks: marks + 1 })).toContain(
      `section 7: counts ${marks} \`itTypeScriptOnly\` marks, and src/tests/parity/exclusions.ratchet.txt lists ${marks + 1}`,
    );
    expect(recount({ converted: converted - 1 })).toContain(`section 7: counts ${converted} suites, and src/tests/portKit/converted.txt lists ${converted - 1}`);
    expect(problems({ register: base.register.replace(/`src\/tests\/portKit\/converted\.txt` lists/, "`src/tests/portKit/converted.txt` holds") })).toContain(
      `section 7: the register gives no count of the suites, and src/tests/portKit/converted.txt lists ${converted}`,
    );
    expect(recount({ branches: 1 })).toContain("section 7: counts 0 `onWasmParityProject` branches, and src/tests/parity/exclusions.ratchet.txt lists 1");
    // A split's parts must add up to the count it splits.
    expect(problems({ register: base.register.replace(/\*\*(\d+) tests\*\*/, (_, n: string) => `**${Number(n) + 1} tests**`) })).toContain(
      `section 7: counts ${marks + 1} marks in the two groups, and src/tests/parity/exclusions.ratchet.txt lists ${marks}`,
    );
    // The ratchet's test files are held apart from its fixtures, so a true-up
    // cannot lower the wrong half.
    expect(problems({ register: base.register.replace(`(${tsEngineTests} test files`, `(${tsEngineTests + 1} test files`) })).toContain(
      `section 7: counts ${tsEngineTests + 1} test files, and src/tests/tsEngineTests.ratchet.txt lists ${tsEngineTests}`,
    );
    // The two groups name exactly the files that hold marks.
    expect(base.markedStems).toHaveLength(base.sevenCounts.markFiles);
    expect(problems({ markedStems: [...base.markedStems, "fooBar"] })).toContain("section 7: neither group names `fooBar`, which has TypeScript-only marks");
    expect(problems({ markedStems: base.markedStems.filter((s) => s !== "phase2") })).toContain(
      "section 7: a group names `phase2`, which has no TypeScript-only marks",
    );
    // A unit test on the ratchet with cadence calls only, and a CRLF register.
    expect(problems({ register: base.register.replace("`phase2`", "`rentalCrowd`") })).toContain(
      "section 7: a group names `rentalCrowd`, which has no TypeScript-only marks",
    );
    expect(problems({ register: base.register.replace(/\n/g, "\r\n") }).filter((p) => p.includes("group"))).toEqual([]);
    // The lists read past comments, blank lines, CRLF and a trailing reason.
    const lists: Record<string, string> = {
      "src/tests/parity/exclusions.ratchet.txt": "# head\n\nsrc/x/a.integration.test.ts itTypeScriptOnly=2 atEngineFrameCadence=0 onWasmParityProject=0\r\nb.ts itTypeScriptOnly=0 atEngineFrameCadence=3 onWasmParityProject=1 # itTypeScriptOnly=7\n",
      "src/tests/tsEngineTests.ratchet.txt": "# head\r\n\r\nsrc/a.test.ts x\r\n  # note\r\nsrc/b.ts\n",
      "src/tests/portKit/converted.txt": "# head\nsrc/c.test.ts\n",
    };
    const fake = (rel: string): string => lists[rel] ?? readFileSync(resolve(repoRoot, rel), "utf8");
    expect(sevenCounts(fake, mapping)).toMatchObject({
      marks: 2, markFiles: 1, cadence: 3, cadenceFiles: 1, branches: 1, tsEngine: 2, tsEngineTests: 1, converted: 1,
    });
    expect(markedStems(fake)).toEqual(["a"]);
    // A line without a field reads as no count at all, so a renamed field fails.
    lists["src/tests/parity/exclusions.ratchet.txt"] = "a.ts itTypeScriptOnly=1 atEngineFrameCadence=0\n";
    expect(sevenCounts(fake, mapping).branches).toBeNaN();
    const count = new RegExp(`\`wasmParityProjects\`\\s+leaves\\s+${integration}\\s+of\\s+them`);
    expect(base.register).toMatch(count);
    expect(problems({ register: base.register.replace(count, "`wasmParityProjects` leaves some of them") })).toContain(
      `section 7: the register gives no count of the integration test files \`wasmParityProjects\` leaves out of \`integrationWasm\`, and Vitest's discovery lists ${integration}`,
    );
    // The count is read only beside the project it is for: a sentence that
    // names it after the other project's figure gives it no count.
    const missing = `section 7: the register gives no count of the integration test files \`wasmParityProjects\` leaves out of \`integrationWasm\`, and Vitest's discovery lists ${integration}`;
    expect(problems({ register: base.register.replace("its `integrationWasm` project", "the unit project") })).toContain(missing);
    const both = base.register.replace(count, `\`wasmParityProjects\` leaves 4 unit test files out of its \`unitWasm\` project and ${integration} of them`);
    expect(both).not.toBe(base.register);
    expect(problems({ register: both })).toContain(missing);
    const unitCount = new RegExp(`\\b${files}\\s+unit\\s+test\\s+files\\b`);
    expect(base.register).toMatch(unitCount);
    expect(problems({ register: base.register.replace(unitCount, "some unit test files") }).join("\n")).toContain("no count of the `unitWasm` unit test files");
  });

  it("names: a root file and a link's text are paths, a link climbs out of the register's folder, and the exception register's bare names exist", () => {
    const extra = (s: string) => problems({ register: `${base.register}\n${s}\n` }).join("\n");
    expect(extra("`vite.config.ts`")).not.toContain("without its path");
    expect(extra("[`cardKit.ts`](../../src/game/cardKit.ts)")).not.toContain("cardKit.ts");
    expect(extra("[`gone.ts`](../../src/game/gone.ts)")).toContain("cites src/game/gone.ts, which does not exist");
    expect(citedPaths("[x](../../src/a.ts)", "_bmad-output/planning-artifacts")).toEqual(["src/a.ts"]);
    // A link's title does not hide its target, a link may not leave the
    // repository, and a web link's text is a bare name like any other.
    for (const title of ['"the card"', "'the card'", "(the card)"]) {
      expect(extra(`[x](../../src/game/gone.ts ${title})`), title).toContain("cites src/game/gone.ts, which does not exist");
    }
    expect(extra("[x](../../../outside.md)")).toContain("links to ../outside.md, outside the repository");
    expect(extra("[x](../../..)")).toContain("links to .., outside the repository");
    expect(extra("[x](<../../src/game/gone.ts>)")).toContain("cites src/game/gone.ts, which does not exist");
    expect(extra("[x][gone]\n\n[gone]: ../../src/game/gone.ts")).toContain("cites src/game/gone.ts, which does not exist");
    expect(extra("`docs/../../outside.md`")).toContain("links to ../outside.md, outside the repository");
    expect(extra("[x](/docs/../../outside.md)")).toContain("links to ../outside.md, outside the repository");
    expect(extra('[x]( ../../src/game/gone.ts "t" )')).toContain("cites src/game/gone.ts, which does not exist");
    expect(extra("[`cardKit.ts`](https://example.com/cardKit.ts)")).toContain("names cardKit.ts without its path");
    for (const suffix of [":12", "#test-case"]) {
      const missing = `missing.test.ts${suffix}`;
      expect(extra("`" + missing + "`")).toContain("names missing.test.ts without its path");
      // A missing test named as proven-same evidence must also be caught.
      const tickRow = /\| `tick` \| lifecycle \| proven same \|[^\n]*/.exec(base.register)![0];
      const broken = tickRow.replace("src/tests/integration/tsEngine.golden.integration.test.ts", missing);
      expect(broken).not.toBe(tickRow);
      expect(problems({ register: base.register.replace(tickRow, broken) })).toContain(
        "_bmad-output/planning-artifacts/release-3.0-parity-register.md names missing.test.ts without its path",
      );
    }
    const exceptions = (s: string) => problems({ exceptions: `${base.exceptions}\n${s}\n` }).join("\n");
    expect(exceptions("`gone.md`")).toContain("release-3.0-exception-register.md names gone.md, which no file in the repository is called");
    expect(exceptions("`CLAUDE.md` and `tally.rs`")).not.toContain("which no file in the repository is called");
  });

  it("a proven same row with no test, an unknown scenario and a path outside the known roots", () => {
    const row = /\| `tick` \| lifecycle \| proven same \|[^\n]*/;
    expect(problems({ register: base.register.replace(row, "| `tick` | lifecycle | proven same | it works |") }).join("\n")).toContain(
      "proven same, but the evidence cites no test, scenario or section",
    );
    const extra = (s: string) => problems({ register: `${base.register}\n${s}\n` }).join("\n");
    expect(extra("the `gone-modern` scenario")).toContain("names scenario gone-modern, which does not exist");
    expect(extra("the `gone-*` scenarios")).toContain("names scenario gone-*, which does not exist");
    expect(extra("the `player-edits-*` scenarios")).not.toContain("names scenario");
    expect(extra("`tools/probe.ts:12`")).toContain("cites tools/probe.ts, outside the roots the path check follows");
    expect(extra("`sim/gripe`")).not.toContain("outside the roots");
  });

  it("a made-up disposition, a duplicate row and a 2a row for a file that is gone", () => {
    // Use a real importer from the current ratchet rather than pinning a
    // particular file: the runtime-import inventory should be able to shrink.
    const importer = base.ratchet.find((f) => base.register.includes(`| \`${f}\` |`));
    if (!importer) throw new Error("no frontend import row to mutate");
    const row = base.register.split("\n").find((line) => line.startsWith(`| \`${importer}\` |`));
    if (!row) throw new Error(`missing frontend import row for ${importer}`);
    const cells = row.split("|");
    cells[4] = " maybe later ";
    expect(problems({ register: base.register.replace(row, cells.join("|")) }).join("\n")).toContain(
      'disposition "maybe later"',
    );
    const tickRow = /\| `tick` \| lifecycle \| proven same \|[^\n]*/.exec(base.register)![0];
    expect(problems({ register: base.register.replace(tickRow, `${tickRow}\n${tickRow}`) })).toContain("section 3: tick has more than one row");
    expect(problems({ ratchet: base.ratchet.filter((f) => f !== importer) })).toContain(
      `section 2a: a row for ${importer}, which is gone`,
    );
  });

  it("a table that loses its Class, Evidence or Disposition column, a proven same row with nowhere to cite, and a section with two tables", () => {
    const savesHeader = "| Feature | Class | Evidence | Notes |\n| --- | --- | --- | --- |\n| New tower in each mode |";
    expect(base.register).toContain(savesHeader);
    const without = (header: string) => problems({ register: base.register.replace(savesHeader, header) }).join("\n");
    expect(without(savesHeader.replace("| Class |", "| Kind |"))).toContain('"4. Saves, files and recovery" has no Class column');
    const noEvidence = without(savesHeader.replace("| Evidence |", "| Tests |"));
    expect(noEvidence).toContain('"4. Saves, files and recovery" has no Evidence column');
    expect(noEvidence).toContain("proven same, in a table with no Evidence column");
    const filesHeader = "| File | Runs in the shipped game | Decides gameplay | Disposition | Owner |";
    expect(problems({ register: base.register.replace(filesHeader, filesHeader.replace("Disposition", "Plan")) }).join("\n")).toContain(
      '"2a. Frontend runtime imports of the TypeScript engine" has no Disposition column',
    );
    const handled = "| A number past the double range in a save | known divergence | EX-3 |";
    expect(base.register).toContain(handled);
    expect(problems({ register: base.register.replace(handled, handled.replace("known divergence", "proven same")) }).join("\n")).toContain(
      "proven same, in a table with no Evidence column",
    );
    const sub = `${base.register}\n### 4z. Extra\n\n| Feature | Status | Notes |\n| --- | --- | --- |\n| A thing | proven same | it works |\n`;
    expect(problems({ register: sub }).join("\n")).toContain('"4z. Extra", row A thing: a class in a table with no Class column');
    const again = `${base.register}\n## 3. Engine reads, again\n\n| Member | Group | Class | Evidence |\n| --- | --- | --- | --- |\n`;
    expect(problems({ register: again })).toContain('expected one table under "3. ", found 2');
  });

  it("the citations a proven same row may stand on, a section the register does not have and a fixture scenario", () => {
    const row = /\| `tick` \| lifecycle \| proven same \|[^\n]*/;
    const cite = (evidence: string) =>
      problems({ register: base.register.replace(row, `| \`tick\` | lifecycle | proven same | ${evidence} |`) }).join("\n");
    const none = "proven same, but the evidence cites no test, scenario or section";
    expect(cite("the scenario")).toContain(none);
    expect(cite("see gone.test.ts")).toContain(none);
    expect(cite("no scenarios cover this yet")).toContain(none);
    expect(cite("untested: nothing in section 3 checks it")).toContain(none);
    expect(cite("`src/tests/integration/cardTextParity.integration.test.ts`")).not.toContain(none);
    expect(cite("the `quoteBuild` row in Section 3")).not.toContain(none);
    expect(cite("the `amenities-modern` scenario")).not.toContain(none);
    expect(cite("the Modern scenarios' checkpoints")).not.toContain(none);
    expect(cite("`quoteBuild` in section 3")).not.toContain(none);
    // A section stands as evidence only beside another proven same row's name.
    expect(cite("`tick` in section 3")).toContain(none);
    expect(cite("`undo` in section 3")).toContain(none);
    expect(cite("`quoteBuild`, as section 10 of the web plan says")).toContain(none);
    // Two rows that cite each other ground neither.
    const quote = /\| `quoteBuild` \| query \| proven same \|[^\n]*/;
    const cycle = base.register.replace(row, "| `tick` | lifecycle | proven same | `quoteBuild` in section 3 |").replace(quote, "| `quoteBuild` | query | proven same | `tick` in section 3 |");
    const cycled = problems({ register: cycle }).filter((p) => p.endsWith(none));
    expect(cycled.map((p) => /row `(\w+)`/.exec(p)?.[1]).sort()).toEqual(["quoteBuild", "tick"]);
    const extra = (s: string) => problems({ register: `${base.register}\n${s}\n` }).join("\n");
    expect(extra("as section 12 says")).toContain("cites section 12, which it does not have");
    expect(extra("as Section 12's table says")).toContain("cites section 12, which it does not have");
    expect(extra("sections 2a, 4 and 13")).toContain("cites section 13, which it does not have");
    expect(extra("sections 1 to 14")).toContain("cites section 14, which it does not have");
    expect(extra("sections 1\u201314")).toContain("cites section 14, which it does not have");
    expect(extra("sections 1-14")).toContain("cites section 14, which it does not have");
    // The register is wrapped, so a citation can break across lines.
    expect(extra("sections 1\n  to 14")).toContain("cites section 14, which it does not have");
    expect(extra("section\n14")).toContain("cites section 14, which it does not have");
    expect(extra("the story's\n  section 14")).not.toContain("section 14");
    expect(extra("the stories' section 14")).not.toContain("section 14");
    expect(extra("sections 1 and 14\n  of the web plan")).not.toContain("section 14");
    expect(extra("section 3 or 14")).toContain("cites section 14, which it does not have");
    expect(extra("sections 1 \u2013 14")).toContain("cites section 14, which it does not have");
    // White space of any length around a dash, an Oxford "or", "through",
    // and a list in capitals.
    for (const cite of ["sections 1 \u2013\n  14", "sections 1\n  \u2013 14", "sections 1 \u2013  14", "sections 1, 4, or 14", "sections 1 through 14", "Sections 1 AND 14"]) {
      expect(extra(cite), cite).toContain("cites section 14, which it does not have");
      expect(extra(cite), cite).not.toMatch(/cites section \d+\s/);
    }
    // A list item opening the next line is no range.
    expect(extra("see section 14\n\n- 2 of the rows")).toContain("cites section 14, which it does not have");
    expect(extra("see section 7\n  - 14 files")).not.toContain("section 14");
    expect(extra("sections 1 and 12 of the web plan, and the story\u2019s section 13")).not.toContain("which it does not have");
    expect(extra("section 2d")).toContain("cites section 2d, which it does not have");
    expect(extra("as section 2a says, and sections 1, 4, 5 and 6")).not.toContain("which it does not have");
    expect(extra("the story's section 11, and section 10 of the web plan")).not.toContain("which it does not have");
    expect(extra("the `fixture-gone` scenario")).toContain("names scenario fixture-gone, which does not exist");
    expect(extra("the `fixture-split-tower` scenario")).not.toContain("names scenario");
    expect(problems({ exceptions: `${base.exceptions}\nthe \`gone-modern\` scenario\n` }).join("\n")).toContain(
      "release-3.0-exception-register.md names scenario gone-modern, which does not exist",
    );
    expect(extra("`tools/probe.md#top`")).toContain("cites tools/probe.md, outside the roots the path check follows");
  });

  it("follows the host and save directories the frontend guard skips", () => {
    expect(HOST_DIRS).toEqual(["src/wasmhost/", "src/dualrun/", "src/storage/"]);
  });

  it("an exception entry the register never names", () => {
    expect(problems({ exceptions: `${base.exceptions}\n## EX-98: new\n` })).toContain("EX-98 has no row in the register");
  });

  it("reads alignment separators and escaped pipes", () => {
    const [t] = tables("## 5. X\n\n| A | Class |\n| :--- | ---: |\n| `a \\| b` | proven same |\n");
    expect(t.rows).toEqual([["`a | b`", "proven same"]]);
  });

  it("finds every member of an extended or merged interface, once", () => {
    const src = "interface A { a(): void; a(x: number): void; b: number }\ninterface B extends A { c(): void }\ninterface B { e: string }\nexport interface EnginePort extends A, B { d(): void }";
    expect(sorted(portMembers(src))).toEqual(["a", "b", "c", "d", "e"]);
    expect(() => portMembers("export interface EnginePort { (x: number): void }")).toThrow(/no plain name/);
  });

  it("strips line numbers and anchors from cited paths and skips web links", () => {
    expect(citedPaths("`src/a.ts:12`, `src/b.ts:3-9`, `tick`, [x](c.md#top), [w](https://example.com)", "docs")).toEqual(["docs/c.md", "src/a.ts", "src/b.ts"]);
  });
});

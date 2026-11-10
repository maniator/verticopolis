/** Prints the test projects Vitest resolves for a bare `vitest run` in the
 *  working directory ({@link ProjectFiles}): each project's name and the test
 *  files Vitest finds for it, with the ones it would run as type tests
 *  apart, as paths from that directory.
 *  Vitest finds and applies the config itself, as it does for a run; the
 *  flags an npm script passes are not part of it. Node runs it as a script,
 *  started by `vitestProjects` in `wasmMapping.ts`. */
import { relative, sep } from "node:path";
import { createVitest } from "vitest/node";
import { PROJECTS_LINE, type ProjectFiles } from "./wasmMapping.ts";

// What `vitest run` sets before it creates Vitest (its `prepareVitest`, in
// Vitest 4.1.11), which a direct `createVitest` call skips. The guard's
// self-test holds `TEST` and `VITEST` to it.
process.env.TEST = "true";
process.env.VITEST = "true";
process.env.NODE_ENV ??= "test";

const root = process.cwd();
const repoPath = (file: string): string => relative(root, file).split(sep).join("/");
const vitest = await createVitest("test", { watch: false });
const projects: ProjectFiles[] = [];
try {
  for (const project of vitest.projects) {
    const { testFiles, typecheckTestFiles } = await project.globTestFiles();
    projects.push({ name: project.name, files: testFiles.map(repoPath).sort(), typecheckFiles: typecheckTestFiles.map(repoPath).sort() });
  }
} finally {
  await vitest.close();
}
// After Vitest has closed, on a line of its own; the parent reads the last
// such line, so a plugin's earlier output cannot stand in for it. Then the
// child exits at once, so a handle a plugin leaves open cannot hold it there
// (`vitest run` would wait out its teardown timeout for one, then exit). A
// failed write exits with an error.
process.stdout.write(`\n${PROJECTS_LINE}${JSON.stringify(projects)}\n`, (error) => process.exit(error ? 1 : undefined));

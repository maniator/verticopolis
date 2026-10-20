/**
 * The line `testStartLogSetup.ts` writes as each test begins (#1152). A run
 * that stalls inside a synchronous call never reaches the reporter for the
 * test it is in, because the worker reports to vitest from its event loop, so
 * the worker writes this line itself, straight to the process's stderr. The
 * worker's pid is in the line, so a stalled test names the process to look at
 * when several workers write to the same log.
 */
export function testStartLine(file: string, names: readonly string[], now: Date, pid: number): string {
  return `[${now.toISOString().slice(11, 19)} pid ${pid}] test start ${file} > ${names.join(" > ")}\n`;
}

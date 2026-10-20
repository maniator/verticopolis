/**
 * The line `testStartLogSetup.ts` writes as each test begins (#1152). A run
 * that stalls inside a synchronous call never reaches the reporter for the
 * test it is in, because the worker reports to vitest from its event loop, so
 * the worker writes this line itself, straight to the process's stderr.
 */
export function testStartLine(file: string, names: readonly string[], now: Date): string {
  return `[${now.toISOString().slice(11, 19)}] test start ${file} > ${names.join(" > ")}\n`;
}

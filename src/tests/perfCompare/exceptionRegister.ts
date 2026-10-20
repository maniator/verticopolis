import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { browserLaunch, type BrowserLaunch } from "./renderer";

/** The release exception register: entries `## EX-<n>: ...`, each with a `- **Status:**` line. Only the owner approves an entry. */
export const EXCEPTION_REGISTER = "_bmad-output/planning-artifacts/release-3.0-exception-register.md";

/** The issue an entry must name to cover an unverified renderer. */
export const RENDERER_ISSUE = "#1115";

export interface RegisterEntry {
  id: string;
  /** SHA-256 of the entry's text (line endings as LF), from its heading to the next level-1 or level-2 heading. */
  sha256: string;
}

const lf = (text: string): string => text.replace(/\r\n?/g, "\n");

/** The register without fenced code blocks and HTML comments, which are not entries. */
const prose = (text: string): string => lf(text).replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");

/**
 * Finds `id` in the register text and checks that the entry is approved and
 * scoped to the renderer (it names #1115). Throws with the reason otherwise,
 * so a run cannot declare an exception nobody approved: a proposed entry, an
 * entry about something else, an id that is not in the file, an id that
 * appears twice and a missing register all stop the run before it builds
 * anything. An entry runs from its `## <id>` heading to the next level-1 or
 * level-2 heading; its status must be one `- **Status:**` line whose whole
 * value is `approved`.
 */
export function resolveRendererException(id: string, register: string | null): RegisterEntry {
  if (register === null) throw new Error(`PW_RENDERER_EXCEPTION=${id}: the exception register (${EXCEPTION_REGISTER}) could not be read, so no exception is approved; run on a verified GPU`);
  const text = prose(register);
  const heading = new RegExp(`^## ${id}(?=[:\\s]|$)`, "m");
  const parts = text.split(/^(?=#{1,2} )/m);
  const entries = parts.filter((p) => heading.test(p));
  if (entries.length === 0) throw new Error(`PW_RENDERER_EXCEPTION=${id}: no such entry in ${EXCEPTION_REGISTER}`);
  if (entries.length > 1) throw new Error(`PW_RENDERER_EXCEPTION=${id}: ${entries.length} entries carry that id in ${EXCEPTION_REGISTER}; the register needs exactly one`);
  const entry = entries[0];
  const statuses = [...entry.matchAll(/^- \*\*Status:\*\*[ \t]*(.*?)[ \t]*$/gm)].map((m) => m[1]);
  if (statuses.length !== 1) throw new Error(`PW_RENDERER_EXCEPTION=${id}: the entry has ${statuses.length} Status lines; it needs exactly one`);
  if (statuses[0].toLowerCase() !== "approved") throw new Error(`PW_RENDERER_EXCEPTION=${id}: the entry's status is "${statuses[0]}" and only a status of exactly "approved" counts; only the owner approves an exception`);
  if (!new RegExp(`(?<![\\w#])${RENDERER_ISSUE}\\b`).test(entry)) throw new Error(`PW_RENDERER_EXCEPTION=${id}: the entry does not name ${RENDERER_ISSUE}, so it is not an exception for the renderer check`);
  return { id, sha256: createHash("sha256").update(entry.trim()).digest("hex") };
}

/** The register as `origin/main` holds it, with the commit it was read at; null when git cannot say. */
export type MainRegister = (repo: string) => { text: string; commit: string } | null;

export const registerFromMain: MainRegister = (repo) => {
  try {
    const git = (...args: string[]): string => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 });
    return { text: git("show", `origin/main:${EXCEPTION_REGISTER}`), commit: git("rev-parse", "origin/main").trim() };
  } catch {
    return null;
  }
};

/**
 * `browserLaunch`, plus the register lookup for a declared exception. Called
 * once at the start of a run, before any build. The entry is read from
 * `origin/main`, the branch the owner merges into: a branch or an uncommitted
 * edit cannot approve its own exception. The working tree's copy of the
 * register must match main's (line endings aside), so the run is on the text
 * that was approved, and main's commit is recorded.
 */
export function resolveLaunch(env: Record<string, string | undefined>, repo: string, main: MainRegister = registerFromMain): BrowserLaunch {
  const launch = browserLaunch(env);
  if (!launch.rendererException) return launch;
  const id = launch.rendererException;
  const fromMain = main(repo);
  if (!fromMain) throw new Error(`PW_RENDERER_EXCEPTION=${id}: ${EXCEPTION_REGISTER} could not be read from origin/main (run \`git fetch origin main\`); an exception counts only as main holds it`);
  const path = join(repo, EXCEPTION_REGISTER);
  const here = existsSync(path) && statSync(path).isFile() ? readFileSync(path, "utf8") : null;
  if (here === null || lf(here) !== lf(fromMain.text)) throw new Error(`PW_RENDERER_EXCEPTION=${id}: this tree's ${EXCEPTION_REGISTER} differs from origin/main's (${fromMain.commit.slice(0, 12)}); run from a tree whose register matches main, because only main's text can approve an exception`);
  const entry = resolveRendererException(id, fromMain.text);
  return { ...launch, rendererExceptionSha256: entry.sha256, rendererExceptionCommit: fromMain.commit };
}

/** The folder marker of a run under a register exception, for example `exception-ex-4`. */
export const exceptionMarker = (id: string): string => `exception-${id.toLowerCase()}`;

/**
 * An `--out` folder of a run under an exception must carry its marker, and
 * one without an exception must not, so a folder name never hides which kind
 * of run it holds.
 */
export function checkExceptionFolder(name: string, exception: string | null): void {
  const lower = name.toLowerCase();
  if (exception && !lower.includes(exceptionMarker(exception))) throw new Error(`--out ${name}: this run declares renderer exception ${exception}, so the folder name must contain ${exceptionMarker(exception)}`);
  if (!exception && /exception-ex-\d+/.test(lower)) throw new Error(`--out ${name} names a renderer exception, but this run declares none`);
}

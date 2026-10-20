import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { browserLaunch, type BrowserLaunch } from "./renderer";

/** The release exception register: entries `## EX-<n>: ...`, each with a `- **Status:**` line. Only the owner approves an entry. */
export const EXCEPTION_REGISTER = "_bmad-output/planning-artifacts/release-3.0-exception-register.md";

/** The issue an entry must name to cover an unverified renderer. */
export const RENDERER_ISSUE = "#1115";

export interface RegisterEntry {
  id: string;
  /** SHA-256 of the entry's text, from its heading to the next one. */
  sha256: string;
}

/**
 * Finds `id` in the register text and checks that the entry is approved and
 * scoped to the renderer (it names #1115). Throws with the reason otherwise,
 * so a run cannot declare an exception nobody approved: a proposed entry, an
 * entry about something else, an id that is not in the file and a missing
 * register all stop the run before it builds anything.
 */
export function resolveRendererException(id: string, register: string | null): RegisterEntry {
  if (register === null) throw new Error(`PW_RENDERER_EXCEPTION=${id}: the exception register (${EXCEPTION_REGISTER}) is not in this tree, so no exception is approved; run on a verified GPU`);
  const parts = register.split(/^(?=## EX-\d+\b)/m).filter((p) => p.startsWith("## EX-"));
  const entry = parts.find((p) => new RegExp(`^## ${id}\\b`).test(p));
  if (!entry) throw new Error(`PW_RENDERER_EXCEPTION=${id}: no such entry in ${EXCEPTION_REGISTER}`);
  const status = /^- \*\*Status:\*\*\s*([A-Za-z]+)/m.exec(entry)?.[1]?.toLowerCase();
  if (status !== "approved") throw new Error(`PW_RENDERER_EXCEPTION=${id}: the entry's status is ${status ?? "missing"}, not approved; only the owner approves an exception`);
  if (!entry.includes(RENDERER_ISSUE)) throw new Error(`PW_RENDERER_EXCEPTION=${id}: the entry does not name ${RENDERER_ISSUE}, so it is not an exception for the renderer check`);
  return { id, sha256: createHash("sha256").update(entry.trim()).digest("hex") };
}

/** `browserLaunch`, plus the register lookup for a declared exception. Called once at the start of a run, before any build. */
export function resolveLaunch(env: Record<string, string | undefined>, repo: string): BrowserLaunch {
  const launch = browserLaunch(env);
  if (!launch.rendererException) return launch;
  const path = join(repo, EXCEPTION_REGISTER);
  const entry = resolveRendererException(launch.rendererException, existsSync(path) ? readFileSync(path, "utf8") : null);
  return { ...launch, rendererExceptionSha256: entry.sha256 };
}

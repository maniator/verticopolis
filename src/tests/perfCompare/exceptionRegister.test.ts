import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkExceptionFolder, EXCEPTION_REGISTER, exceptionMarker, registerFromMain, resolveLaunch, resolveRendererException, type MainRegister } from "./exceptionRegister";

const entry = (id: string, status: string, body = "The renderer check (#1115) may warn instead of fail on the owner's laptop.") => `## ${id}: a title\n\n- **Source:** x\n- **Status:** ${status}\n- **What is lost:** ${body}\n`;
const register = (...entries: string[]) => `# Release 3.0 exception register\n\nintro text\n\n${entries.join("\n")}`;

describe("resolveRendererException", () => {
  it("resolves an approved entry that names #1115 and records its hash", () => {
    const text = register(entry("EX-1", "proposed (2026-10-20)", "a rollback loss (#902)"), entry("EX-4", "approved"));
    const a = resolveRendererException("EX-4", text);
    expect(a.id).toBe("EX-4");
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The hash covers that entry only, so editing another one does not move it, and editing this one does.
    expect(resolveRendererException("EX-4", register(entry("EX-1", "approved"), entry("EX-4", "approved"))).sha256).toBe(a.sha256);
    expect(resolveRendererException("EX-4", text.replace("laptop", "desktop")).sha256).not.toBe(a.sha256);
    // Line endings do not change what the owner approved.
    expect(resolveRendererException("EX-4", text.replace(/\n/g, "\r\n")).sha256).toBe(a.sha256);
  });
  it("refuses an id that is not in the register, a proposed or rejected entry, and an entry about something else", () => {
    const text = register(entry("EX-1", "proposed"), entry("EX-2", "rejected"), entry("EX-3", "approved", "a rollback loss (#902)"), entry("EX-4", "approved"));
    expect(() => resolveRendererException("EX-0", text)).toThrow(/no such entry/);
    expect(() => resolveRendererException("EX-99999999999999999999", text)).toThrow(/no such entry/);
    expect(() => resolveRendererException("EX-1", text)).toThrow(/status is "proposed"/);
    expect(() => resolveRendererException("EX-2", text)).toThrow(/status is "rejected"/);
    expect(() => resolveRendererException("EX-3", text)).toThrow(/does not name #1115/);
    expect(resolveRendererException("EX-4", text).id).toBe("EX-4");
  });
  it("matches the whole id, so EX-4 does not resolve to EX-40, EX-4.1 or EX-4-b", () => {
    for (const other of ["EX-40", "EX-4.1", "EX-4-b"]) expect(() => resolveRendererException("EX-4", register(entry(other, "approved")))).toThrow(/no such entry/);
  });
  it("accepts a status of exactly approved and nothing that only starts with it", () => {
    for (const status of ["approved in principle", "approved-pending", "Approved (pending owner sign-off)", "approved, then revoked", "not approved"]) {
      expect(() => resolveRendererException("EX-4", register(entry("EX-4", status))), status).toThrow(/only a status of exactly "approved" counts/);
    }
    expect(resolveRendererException("EX-4", register(entry("EX-4", "Approved"))).id).toBe("EX-4");
    expect(() => resolveRendererException("EX-4", register(`${entry("EX-4", "approved")}- **Status:** revoked\n`))).toThrow(/2 Status, Revoked or Withdrawn lines/);
    expect(() => resolveRendererException("EX-4", register("## EX-4: no status\n\n(#1115)\n"))).toThrow(/0 Status, Revoked or Withdrawn lines/);
  });
  it("reads the whole status value and counts every Status-like line", () => {
    const wrapped = (more: string) => `## EX-4: a title\n\n- **Status:** approved\n  ${more}\n- **Scope:** #1115\n`;
    expect(() => resolveRendererException("EX-4", register(wrapped("in principle only, pending the PC probe")))).toThrow(/status is "approved in principle only/);
    expect(resolveRendererException("EX-4", register(`${entry("EX-4", "approved")}\n`)).id).toBe("EX-4");
    for (const revoke of ["- **Status**: revoked", "* **Status:** revoked", "  - **Status:** revoked", "- **Revoked:** 2026-10-22 by the owner", "- **Withdrawn:** yes"]) {
      expect(() => resolveRendererException("EX-4", register(`${entry("EX-4", "approved")}${revoke}\n`)), revoke).toThrow(/Status, Revoked or Withdrawn lines/);
    }
    // The register's own house style is not the accepted form.
    expect(() => resolveRendererException("EX-4", register(entry("EX-4", "approved (2026-10-21, at the #945 sign-off)")))).toThrow(/only a status of exactly "approved" counts/);
    expect(() => resolveRendererException("EX-4", register(entry("EX-4", "approved", "Revoked on the 22nd. (#1115)")))).toThrow(/revoked or withdrawn/);
    expect(() => resolveRendererException("EX-4", register("## EX-4: x\n\n* **Status:** approved\n\n#1115\n"))).toThrow(/not in the form/);
  });
  it("ends an entry at the next level-1 or level-2 heading, so a later section lends it nothing", () => {
    const text = register(entry("EX-4", "proposed", "something else"), "## Appendix\n\n- **Status:** approved\n\nSee #1115.\n");
    expect(() => resolveRendererException("EX-4", text)).toThrow(/status is "proposed"/);
    // A level-3 heading stays inside the entry.
    expect(resolveRendererException("EX-4", register(`${entry("EX-4", "approved", "x")}\n### Scope\n\n#1115 only.\n`)).id).toBe("EX-4");
  });
  it("matches the issue number as a whole number", () => {
    expect(() => resolveRendererException("EX-4", register(entry("EX-4", "approved", "see #11150")))).toThrow(/does not name #1115/);
    expect(() => resolveRendererException("EX-4", register(entry("EX-4", "approved", "see ##1115")))).toThrow(/does not name #1115/);
    expect(resolveRendererException("EX-4", register(entry("EX-4", "approved", "see #1115."))).id).toBe("EX-4");
  });
  it("refuses an id that two entries carry", () => {
    expect(() => resolveRendererException("EX-4", register(entry("EX-4", "approved"), entry("EX-4", "approved")))).toThrow(/2 entries carry that id/);
  });
  it("ignores entries inside code fences and HTML comments", () => {
    expect(() => resolveRendererException("EX-4", register("```\n" + entry("EX-4", "approved") + "```\n"))).toThrow(/no such entry/);
    expect(() => resolveRendererException("EX-4", register("<!--\n" + entry("EX-4", "approved") + "-->\n"))).toThrow(/no such entry/);
    expect(resolveRendererException("EX-4", register("```\n" + entry("EX-4", "approved") + "```\n", entry("EX-4", "approved"))).id).toBe("EX-4");
  });
  it("refuses everything when the register could not be read", () => {
    expect(() => resolveRendererException("EX-1", null)).toThrow(/could not be read/);
  });
});

describe("resolveLaunch", () => {
  const tree = (text: string | null): string => {
    const dir = mkdtempSync(join(tmpdir(), "register-"));
    if (text !== null) {
      mkdirSync(dirname(join(dir, EXCEPTION_REGISTER)), { recursive: true });
      writeFileSync(join(dir, EXCEPTION_REGISTER), text);
    }
    return dir;
  };
  const onMain = (text: string | null): MainRegister => () => (text === null ? null : { text, commit: "0123456789abcdef0123456789abcdef01234567" });
  const approved = register(entry("EX-4", "approved"));
  const env = { PW_RENDERER_EXCEPTION: "ex-4" };

  it("needs no register without an exception", () => {
    expect(resolveLaunch({}, tree(null), onMain(null))).toMatchObject({ rendererException: null });
  });
  it("stops a run when origin/main cannot be read or does not approve the exception", () => {
    expect(() => resolveLaunch(env, tree(approved), onMain(null))).toThrow(/could not be read from origin\/main/);
    const proposed = register(entry("EX-4", "proposed"));
    expect(() => resolveLaunch(env, tree(proposed), onMain(proposed))).toThrow(/status is "proposed"/);
  });
  it("does not let this tree approve an exception main does not: a branch or an uncommitted entry fails", () => {
    const mainText = register(entry("EX-1", "proposed"));
    expect(() => resolveLaunch(env, tree(approved), onMain(mainText))).toThrow(/differs from origin\/main's \(0123456789ab\)/);
    expect(() => resolveLaunch(env, tree(null), onMain(approved))).toThrow(/differs from origin\/main's/);
  });
  it("carries the approved entry's hash and main's commit into the launch settings, whatever the line endings", () => {
    const l = resolveLaunch(env, tree(approved.replace(/\n/g, "\r\n")), onMain(approved));
    expect(l.rendererException).toBe("EX-4");
    expect(l.rendererExceptionSha256).toBe(resolveRendererException("EX-4", approved).sha256);
    expect(l.rendererExceptionCommit).toBe("0123456789abcdef0123456789abcdef01234567");
  });
  it("reports a register path that is a folder as a difference from main", () => {
    const dir = mkdtempSync(join(tmpdir(), "register-"));
    mkdirSync(join(dir, EXCEPTION_REGISTER), { recursive: true });
    expect(() => resolveLaunch(env, dir, onMain(approved))).toThrow(/differs from origin\/main's/);
  });
});

describe("registerFromMain", () => {
  const git = (cwd: string, ...args: string[]): string => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const write = (dir: string, text: string): void => {
    mkdirSync(dirname(join(dir, EXCEPTION_REGISTER)), { recursive: true });
    writeFileSync(join(dir, EXCEPTION_REGISTER), text);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "register");
  };
  const clone = (upstreamText: string) => {
    const root = mkdtempSync(join(tmpdir(), "regmain-"));
    const up = join(root, "up");
    mkdirSync(up);
    git(up, "init", "-q", "-b", "main");
    write(up, upstreamText);
    const work = join(root, "work");
    git(root, "clone", "-q", up, work);
    return { up, work };
  };
  const proposed = register(entry("EX-4", "proposed"));
  const approved = register(entry("EX-4", "approved"));

  it("reads the remote-tracking ref, so a local branch or tag called origin/main cannot approve an exception", () => {
    const { work } = clone(proposed);
    git(work, "checkout", "-q", "-b", "feature");
    write(work, approved);
    git(work, "branch", "origin/main", "feature");
    git(work, "tag", "origin/main", "feature");
    expect(registerFromMain(work)?.text).toBe(proposed);
  });
  it("fetches first, so an entry revoked on main counts as revoked", () => {
    const { up, work } = clone(approved);
    expect(registerFromMain(work)?.text).toBe(approved);
    write(up, proposed);
    const got = registerFromMain(work);
    expect(got?.text).toBe(proposed);
    expect(got?.commit).toBe(git(up, "rev-parse", "HEAD").trim());
  });
  it("answers null when there is no origin or no register on main", () => {
    const dir = mkdtempSync(join(tmpdir(), "regmain-"));
    git(dir, "init", "-q", "-b", "main");
    expect(registerFromMain(dir)).toBeNull();
    const { work } = clone("nothing here\n");
    expect(registerFromMain(work)?.text).toBe("nothing here\n");
  });
});

describe("checkExceptionFolder", () => {
  it("requires the exception marker in an --out name, and refuses one on a run without an exception", () => {
    expect(exceptionMarker("EX-4")).toBe("exception-ex-4");
    expect(() => checkExceptionFolder("2026-10-21-abc-run0b-worker", "EX-4")).toThrow(/must contain exception-ex-4/);
    expect(() => checkExceptionFolder("2026-10-21-abc-exception-ex-4-worker", "EX-4")).not.toThrow();
    expect(() => checkExceptionFolder("2026-10-21-abc-exception-ex-4-worker", null)).toThrow(/declares none/);
    // The marker is matched as a whole number: ex-40 does not carry EX-4.
    expect(() => checkExceptionFolder("2026-10-21-abc-exception-ex-40-worker", "EX-4")).toThrow(/must contain exception-ex-4/);
    expect(() => checkExceptionFolder("2026-10-21-abc-exception-ex-4", "EX-4")).not.toThrow();
    expect(() => checkExceptionFolder("2026-10-21-abc-run0b-worker", null)).not.toThrow();
  });
});

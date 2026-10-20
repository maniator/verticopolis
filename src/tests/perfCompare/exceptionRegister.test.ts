import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXCEPTION_REGISTER, resolveLaunch, resolveRendererException } from "./exceptionRegister";

const entry = (id: string, status: string, body = "The renderer check (#1115) may warn instead of fail on the owner's laptop.") => `## ${id}: a title\n\n- **Source:** x\n- **Status:** ${status}\n- **What is lost:** ${body}\n`;
const register = (...entries: string[]) => `# Release 3.0 exception register\n\nintro text\n\n${entries.join("\n")}`;

describe("resolveRendererException", () => {
  it("resolves an approved entry that names #1115 and records its hash", () => {
    const text = register(entry("EX-1", "proposed (2026-10-20)", "a rollback loss (#902)"), entry("EX-4", "approved by the owner (2026-10-21)"));
    const a = resolveRendererException("EX-4", text);
    expect(a.id).toBe("EX-4");
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The hash covers that entry only, so editing another one does not move it, and editing this one does.
    expect(resolveRendererException("EX-4", register(entry("EX-1", "approved"), entry("EX-4", "approved by the owner (2026-10-21)"))).sha256).toBe(a.sha256);
    expect(resolveRendererException("EX-4", text.replace("laptop", "desktop")).sha256).not.toBe(a.sha256);
  });
  it("refuses an id that is not in the register, a proposed or rejected entry, and an entry about something else", () => {
    const text = register(entry("EX-1", "proposed"), entry("EX-2", "rejected"), entry("EX-3", "approved", "a rollback loss (#902)"), entry("EX-4", "approved"));
    expect(() => resolveRendererException("EX-0", text)).toThrow(/no such entry/);
    expect(() => resolveRendererException("EX-99999999999999999999", text)).toThrow(/no such entry/);
    expect(() => resolveRendererException("EX-1", text)).toThrow(/status is proposed, not approved/);
    expect(() => resolveRendererException("EX-2", text)).toThrow(/status is rejected/);
    expect(() => resolveRendererException("EX-3", text)).toThrow(/does not name #1115/);
    expect(resolveRendererException("EX-4", text).id).toBe("EX-4");
  });
  it("matches the whole id, so EX-4 does not resolve to EX-40", () => {
    expect(() => resolveRendererException("EX-4", register(entry("EX-40", "approved")))).toThrow(/no such entry/);
  });
  it("refuses everything when the register is not in the tree", () => {
    expect(() => resolveRendererException("EX-1", null)).toThrow(/is not in this tree/);
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
  it("needs no register without an exception", () => {
    expect(resolveLaunch({}, tree(null))).toMatchObject({ rendererException: null });
  });
  it("stops a run that declares an exception the register does not approve", () => {
    expect(() => resolveLaunch({ PW_RENDERER_EXCEPTION: "EX-1" }, tree(null))).toThrow(/is not in this tree/);
    expect(() => resolveLaunch({ PW_RENDERER_EXCEPTION: "EX-1" }, tree(register(entry("EX-1", "proposed"))))).toThrow(/not approved/);
  });
  it("carries the approved entry's hash into the launch settings", () => {
    const l = resolveLaunch({ PW_RENDERER_EXCEPTION: "ex-4" }, tree(register(entry("EX-4", "approved"))));
    expect(l.rendererException).toBe("EX-4");
    expect(l.rendererExceptionSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readUntracked } from "./env";

describe("readUntracked", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), "untracked-"));
    dirs.push(d);
    return d;
  };

  it("reads a file, records a symlink by its target text, and gives up on a directory or a dangling path", () => {
    const d = tmp();
    writeFileSync(join(d, "a.txt"), "hello");
    symlinkSync("a.txt", join(d, "link"));
    symlinkSync("missing", join(d, "dangling"));
    mkdirSync(join(d, "nested"));
    expect(readUntracked(join(d, "a.txt"))?.toString()).toBe("hello");
    expect(readUntracked(join(d, "link"))?.toString()).toBe("symlink:a.txt");
    // A dangling link is still a link: its target text is what the tree holds.
    expect(readUntracked(join(d, "dangling"))?.toString()).toBe("symlink:missing");
    expect(readUntracked(join(d, "nested"))).toBeNull();
    expect(readUntracked(join(d, "absent"))).toBeNull();
  });
});

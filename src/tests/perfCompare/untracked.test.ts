import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FILE_LINKS, linkFile } from "../fixtures/links";
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

  it("reads a file, and gives up on a directory or an absent path", () => {
    const d = tmp();
    writeFileSync(join(d, "a.txt"), "hello");
    mkdirSync(join(d, "nested"));
    expect(readUntracked(join(d, "a.txt"))?.toString()).toBe("hello");
    expect(readUntracked(join(d, "nested"))).toBeNull();
    expect(readUntracked(join(d, "absent"))).toBeNull();
  });

  // A file symlink needs elevation or Developer Mode on Windows; FILE_LINKS is false there without them.
  it.skipIf(!FILE_LINKS)("records a symlink by its target text, even a dangling one", () => {
    const d = tmp();
    writeFileSync(join(d, "a.txt"), "hello");
    linkFile("a.txt", join(d, "link"));
    linkFile("missing", join(d, "dangling"));
    expect(readUntracked(join(d, "link"))?.toString()).toBe("symlink:a.txt");
    // A dangling link is still a link: its target text is what the tree holds.
    expect(readUntracked(join(d, "dangling"))?.toString()).toBe("symlink:missing");
  });
});

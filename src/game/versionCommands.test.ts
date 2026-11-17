import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ track: vi.fn(), show: vi.fn() }));
vi.mock("../analytics", () => ({ trackAppAction: m.track }));
vi.mock("../ui/versionsDialog", () => ({ showVersionsDialog: m.show }));

import { closeFileSpaceForTests, fileSpace } from "../storage/fileSpace";
import { VERSION_GAP_MS } from "../storage/fileVersions";
import type { VersionsCtx } from "../ui/versionsDialog";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { openVersion, showVersions, versionName } from "./versionCommands";

const bytes = (...values: number[]) => new Uint8Array(values);
const app = () => ({ ui: { closeModal: vi.fn() } });

beforeEach(async () => {
  vi.clearAllMocks();
  await fileSpace.open(new FakeIndexedDb().asFactory());
});
afterEach(() => closeFileSpaceForTests());

describe("Previous versions… on a My Towers tower", () => {
  it("names the new file after the tower and the version's time, with no colon", () => {
    expect(versionName("Sky", new Date(2026, 10, 17, 15, 4).getTime())).toBe("Sky (Nov 17 at 3.04 PM)");
    expect(versionName("Sky", new Date(2026, 0, 2, 0, 30).getTime())).toBe("Sky (Jan 2 at 12.30 AM)");
  });

  it("lists the tower's versions newest first, and counts the window", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    await fileSpace.overwrite(a.id, bytes(2), VERSION_GAP_MS);
    await fileSpace.overwrite(a.id, bytes(3), 2 * VERSION_GAP_MS);
    await showVersions(app() as never, a.id, vi.fn());
    const ctx = m.show.mock.calls[0][1] as VersionsCtx;
    expect(ctx.name).toBe("Sky");
    expect(ctx.versions.map((v) => v.at)).toEqual([2 * VERSION_GAP_MS, VERSION_GAP_MS]);
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_versions", "list");
  });

  it("shows an empty window for a tower with none yet, counted apart", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    await showVersions(app() as never, a.id, vi.fn());
    expect((m.show.mock.calls[0][1] as VersionsCtx).versions).toEqual([]);
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_versions", "none");
  });

  it("opens a version as a new file beside the tower, leaving the tower and its versions as they were", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    await fileSpace.overwrite(a.id, bytes(2), VERSION_GAP_MS);
    await fileSpace.overwrite(a.id, bytes(3), 2 * VERSION_GAP_MS);
    const [, older] = await fileSpace.versions(a.id);
    const openFile = vi.fn(async () => undefined);
    const shown = app();
    expect(await openVersion(shown as never, "Sky", older, openFile)).toBeNull();
    const made = fileSpace.list().find((f) => f.id !== a.id)!;
    expect(made.name).toBe(versionName("Sky", VERSION_GAP_MS));
    expect(await fileSpace.read(made.id)).toEqual(bytes(2));
    expect(openFile).toHaveBeenCalledExactlyOnceWith(made.id);
    expect(shown.ui.closeModal).toHaveBeenCalledOnce();
    expect(await fileSpace.read(a.id)).toEqual(bytes(3));
    expect(await fileSpace.versions(a.id)).toHaveLength(2);
    expect(m.track).toHaveBeenCalledExactlyOnceWith("file_versions", "open");
  });

  it("says a version is gone when newer ones replaced it, and makes no file", async () => {
    const a = await fileSpace.save("Sky", "tower", bytes(1), 0);
    await fileSpace.overwrite(a.id, bytes(2), VERSION_GAP_MS);
    const [v] = await fileSpace.versions(a.id);
    await fileSpace.remove(a.id);
    const openFile = vi.fn();
    expect(await openVersion(app() as never, "Sky", v, openFile)).toEqual({ text: "That version is gone. Newer versions may have replaced it.", kind: "bad" });
    expect(fileSpace.list()).toEqual([]);
    expect(openFile).not.toHaveBeenCalled();
  });
});

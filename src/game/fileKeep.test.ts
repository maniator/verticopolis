import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const track = vi.hoisted(() => vi.fn());
vi.mock("../analytics", () => ({ trackAppAction: track }));
import { closeFileSpaceForTests, fileSpace, FileSpaceFullError } from "../storage/fileSpace";
import { FakeIndexedDb } from "../tests/fakeIndexedDb";
import { currentFileId, setCurrentFile } from "./currentFile";
import { baseName, failed, keepOpenedFile } from "./fileKeep";

const bytes = (...v: number[]) => Uint8Array.from(v);

beforeEach(async () => {
  track.mockReset();
  setCurrentFile(null);
  await fileSpace.open(new FakeIndexedDb().asFactory());
});
afterEach(() => closeFileSpaceForTests());

describe("keeping a tower file that just opened", () => {
  it("names it without its extension", () => {
    expect(baseName("MYTOWER.TDT")).toBe("MYTOWER");
    expect(baseName("Sky  Hotel.vctower")).toBe("Sky Hotel");
    expect(baseName(".hidden")).toBe(".hidden");
  });

  it("adds a picked tower and makes it the live tower's file", async () => {
    const kept = await keepOpenedFile("Spire.vctower", bytes(1, 2, 3), "tower");
    expect(kept).toMatchObject({ name: "Spire", kind: "tower", size: 3 });
    expect(await fileSpace.read(kept!.id)).toEqual(bytes(1, 2, 3));
    expect(currentFileId()).toBe(kept!.id);
    expect(track).toHaveBeenCalledExactlyOnceWith("file_add", "picked");
  });

  it("keeps a 1994 file without making it the live tower's file", async () => {
    const kept = await keepOpenedFile("OLD.TDT", bytes(9), "tdt");
    expect(kept).toMatchObject({ name: "OLD", kind: "tdt" });
    expect(currentFileId()).toBeNull();
  });

  it("does not add a file opened from My Towers a second time", async () => {
    const first = await keepOpenedFile("Spire.vctower", bytes(1, 2), "tower");
    track.mockReset();
    const again = await keepOpenedFile("Spire.vctower", bytes(1, 2), "tower");
    expect(again!.id).toBe(first!.id);
    expect(fileSpace.list()).toHaveLength(1);
    expect(track).not.toHaveBeenCalled();
  });

  it("adds other bytes under the same name beside the first", async () => {
    await keepOpenedFile("Spire.vctower", bytes(1, 2), "tower");
    const other = await keepOpenedFile("Spire.vctower", bytes(1, 3), "tower");
    expect(other!.name).toBe("Spire (2)");
    expect(fileSpace.list()).toHaveLength(2);
  });

  it("answers null with My Towers closed", async () => {
    closeFileSpaceForTests();
    expect(await keepOpenedFile("Spire.vctower", bytes(1), "tower")).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it("answers null, and counts the failure, when the write fails", async () => {
    vi.spyOn(fileSpace, "add").mockRejectedValueOnce(new FileSpaceFullError());
    expect(await keepOpenedFile("Spire.vctower", bytes(1), "tower")).toBeNull();
    expect(track).toHaveBeenCalledExactlyOnceWith("file_failed", "full");
    expect(currentFileId()).toBeNull();
  });

  it("puts a failure in the player's words and counts its kind", () => {
    expect(failed(new Error("That name is taken."))).toEqual({ text: "That name is taken.", kind: "bad" });
    expect(track).toHaveBeenLastCalledWith("file_failed", "error");
  });
});

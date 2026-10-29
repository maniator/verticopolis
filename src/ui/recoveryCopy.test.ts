import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./downloadFile", () => ({ downloadFile: vi.fn() }));
import { downloadFile } from "./downloadFile";
import { downloadRecoveryCopy, RECOVERY_COPY_FILENAME } from "./recoveryCopy";

describe("downloadRecoveryCopy", () => {
  afterEach(() => vi.mocked(downloadFile).mockReset());

  it("hands the browser the text unchanged as a .txt download", () => {
    expect(downloadRecoveryCopy(() => "VCZ1:abc")).toBe("saved");
    expect(downloadFile).toHaveBeenCalledWith(RECOVERY_COPY_FILENAME, "VCZ1:abc", "application/octet-stream");
    expect(RECOVERY_COPY_FILENAME).toMatch(/recovery.*\.txt$/);
  });

  it("says none and downloads nothing when no save is stored", () => {
    expect(downloadRecoveryCopy(() => null)).toBe("none");
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("says failed when the download throws", () => {
    vi.mocked(downloadFile).mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(downloadRecoveryCopy(() => "x")).toBe("failed");
  });
});

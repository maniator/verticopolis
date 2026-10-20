// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./copyText";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("copyText", () => {
  it("writes through the Clipboard API", async () => {
    const writeText = vi.fn(async () => {});
    expect(
      await copyText("hello", {
        clipboard: { writeText } as unknown as Clipboard,
      }),
    ).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a selection copy when the page has no Clipboard API", async () => {
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    expect(
      await copyText("hello", { clipboard: undefined as unknown as Clipboard }),
    ).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back when the Clipboard API refuses", async () => {
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    expect(
      await copyText("hello", {
        clipboard: { writeText } as unknown as Clipboard,
      }),
    ).toBe(true);
    expect(exec).toHaveBeenCalled();
  });

  it("resolves false when both ways fail, and leaves nothing in the page", async () => {
    document.execCommand = vi.fn(() => {
      throw new Error("no");
    });
    expect(
      await copyText("hello", { clipboard: undefined as unknown as Clipboard }),
    ).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

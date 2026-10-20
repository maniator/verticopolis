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

  it("puts the fallback textarea inside an open dialog, which is where a modal page can select", async () => {
    const dialog = document.createElement("dialog");
    document.body.appendChild(dialog);
    (dialog as HTMLDialogElement & { open: boolean }).open = true;
    let parent: Element | null = null;
    document.execCommand = vi.fn(() => {
      parent = document.querySelector("textarea")?.parentElement ?? null;
      return true;
    });
    expect(await copyText("hello", { clipboard: undefined as unknown as Clipboard })).toBe(true);
    expect(parent).toBe(dialog);
  });

  it("gives focus back to the control that had it", async () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();
    document.execCommand = vi.fn(() => true);
    await copyText("hello", { clipboard: undefined as unknown as Clipboard });
    expect(document.activeElement).toBe(button);
  });

  it("does not claim success when the text could not be selected", async () => {
    const exec = vi.fn(() => true);
    document.execCommand = exec;
    const select = vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(() => {});
    expect(await copyText("hello", { clipboard: undefined as unknown as Clipboard })).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    select.mockRestore();
  });
});

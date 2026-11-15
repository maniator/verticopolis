import * as ex from "excalibur";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keyboardHost } from "./keyboardHost";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("keyboardHost (#322)", () => {
  it("keeps Excalibur's keyboard listeners off the window, and still focuses it", () => {
    const added = vi.spyOn(window, "addEventListener");
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    // The engine and each scene init a keyboard this way (`InputHost`).
    new ex.Keyboard().init({ global: keyboardHost(), grabWindowFocus: true });
    expect(added.mock.calls.map(([type]) => type)).toEqual([]);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("is the control: on the default global the same init lands on the window", () => {
    const added = vi.spyOn(window, "addEventListener");
    vi.spyOn(window, "focus").mockImplementation(() => {});
    new ex.Keyboard().init({ global: window, grabWindowFocus: false });
    expect(added.mock.calls.map(([type]) => type).sort()).toEqual(["blur", "keydown", "keyup"]);
  });
});

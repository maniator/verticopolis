import { describe, it, expect, vi } from "vitest";
import { confirmTemplate, installHelpTemplate } from "./confirm";
import { renderToFragment, click } from "../testing/litTestUtils";

/**
 * The E0 proof dialog. `confirmTemplate` is the first lit conversion, so it
 * carries the migration's per-aspect test package: a semantic structure check,
 * the inline `@click` dispatch (`onYes`/`onCancel`), and hostile input rendered
 * as text (lit auto-escape, the security win over the old string path). The live
 * behavior (open/confirm/cancel/close, no close button) is pinned by
 * `uiDialogs.integration.test.ts`.
 */

const noop = { onYes: () => {}, onCancel: () => {} };

describe("confirmTemplate structure", () => {
  it("renders the title, body, and a two-button actions row", () => {
    const frag = renderToFragment(confirmTemplate("Start over?", "This abandons your tower.", "Confirm", noop));
    expect(frag.querySelector("h2")?.textContent).toBe("Start over?");
    expect(frag.querySelector("p")?.textContent).toBe("This abandons your tower.");
    const buttons = frag.querySelectorAll(".modal-actions button");
    expect(buttons).toHaveLength(2);
  });

  it("wires Cancel as [data-act=no] and the primary as [data-act=yes] with the given label", () => {
    const frag = renderToFragment(confirmTemplate("T", "B", "Demolish", noop));
    const no = frag.querySelector('[data-act="no"]')!;
    const yes = frag.querySelector('[data-act="yes"]')!;
    expect(no.textContent).toBe("Cancel");
    expect([...no.classList]).toEqual(["btn"]);
    expect(yes.textContent).toBe("Demolish");
    expect(yes.classList.contains("primary")).toBe(true);
  });

  it("renders no [data-act=close] button (the no-close-button case)", () => {
    const frag = renderToFragment(confirmTemplate("T", "B", "Confirm", noop));
    expect(frag.querySelector('[data-act="close"]')).toBeNull();
  });
});

describe("confirmTemplate inline actions", () => {
  it("Confirm dispatches onYes, not onCancel", () => {
    const onYes = vi.fn();
    const onCancel = vi.fn();
    const frag = renderToFragment(confirmTemplate("T", "B", "Confirm", { onYes, onCancel }));
    click(frag.querySelector('[data-act="yes"]')!);
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Cancel dispatches onCancel, not onYes", () => {
    const onYes = vi.fn();
    const onCancel = vi.fn();
    const frag = renderToFragment(confirmTemplate("T", "B", "Confirm", { onYes, onCancel }));
    click(frag.querySelector('[data-act="no"]')!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onYes).not.toHaveBeenCalled();
  });
});

describe("installHelpTemplate variants (SPEC-pwa-install CAP-3 / CAP-5)", () => {
  it("defaults to the iOS Safari Share-sheet steps", () => {
    const frag = renderToFragment(installHelpTemplate(() => {}));
    const text = frag.textContent ?? "";
    expect(text).toMatch(/Safari/);
    expect(text).toMatch(/Add to Home Screen/i);
    // Never the tech term, never a "one-tap" promise.
    expect(text).not.toMatch(/pwa/i);
    expect(text).not.toMatch(/one[- ]tap/i);
  });

  it("renders the Chrome/Edge browser-menu steps for the browser variant", () => {
    const frag = renderToFragment(installHelpTemplate(() => {}, "browser"));
    const text = frag.textContent ?? "";
    expect(text).toMatch(/menu/i);
    expect(text).toMatch(/Install|Add to Home screen/i);
    expect(text).not.toMatch(/Safari/); // the iOS-only step must not leak in
    expect(text).not.toMatch(/pwa/i);
  });

  it("dispatches onClose from the single Got it action", () => {
    const onClose = vi.fn();
    const frag = renderToFragment(installHelpTemplate(onClose, "browser"));
    click(frag.querySelector('[data-act="close"]')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("confirmTemplate escapes interpolated copy as text", () => {
  it("renders hostile markup as literal text, injecting no element", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const frag = renderToFragment(confirmTemplate(hostile, `<b>bold</b>`, "OK", noop));
    // lit auto-escapes: the markup lands as text, not as an <img>/<b> element.
    expect(frag.querySelector("img")).toBeNull();
    expect(frag.querySelector("h2 b")).toBeNull();
    expect(frag.querySelector("h2")?.textContent).toBe(hostile);
    expect(frag.querySelector("p")?.textContent).toBe(`<b>bold</b>`);
  });
});

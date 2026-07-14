import { describe, it, expect, vi } from "vitest";
import { congratsTemplate } from "./congrats";
import { renderToFragment, click } from "../testing/litTestUtils";

/**
 * The TOWER-achieved congratulations modal body (migrated in the final sweep,
 * the one dialog outside the epic list). Package: the window grammar the modal
 * mount skins (a top-level h2), the celebratory copy, and the Continue action
 * dispatching its inline @click. The controller path (openModalTemplate mount,
 * ✕/Esc close) is pinned by the congratsTower integration test.
 */

describe("congratsTemplate", () => {
  it("renders the h2 title, the celebratory copy, and the Continue action", () => {
    const frag = renderToFragment(congratsTemplate(() => {}));
    expect(frag.querySelector("h2")!.textContent).toContain("TOWER achieved!");
    expect(frag.textContent).toContain("Congratulations, master builder!");
    const btn = frag.querySelector<HTMLButtonElement>('.modal-actions button[data-act="close"]')!;
    expect(btn).not.toBeNull();
    expect([...btn.classList].sort()).toEqual(["btn", "primary"]);
    expect(btn.textContent).toBe("Continue");
  });

  it("Continue dispatches onClose", () => {
    const onClose = vi.fn();
    const frag = renderToFragment(congratsTemplate(onClose));
    click(frag.querySelector('[data-act="close"]')!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

/**
 * The status bar's help for the Tools window, the way a 1995 program explained
 * its toolbar buttons (party, 2026-11-14): while the mouse pointer or the
 * keyboard focus rests on a tool's button, the bar's tool cell gives way to
 * `#sb-hint`, which names the tool and says what it does, and the picked
 * tool's card comes back when the pointer or the focus leaves.
 *
 * The text is each button's hidden `.pal-desc`, which is also the button's
 * accessible description (`aria-describedby`), so a screen reader hears the
 * same words on focus. A finger's tap is a pick, not a hover, so touch is
 * left out. Cost: one text write per button entered.
 */

/** The id of a palette button's description, by facility kind or tool. */
export function descriptionId(key: string): string {
  return `pal-desc-${key}`;
}

/** Wire the hint over `palette` once (the buttons inside may be rebuilt). */
export function wirePaletteHints(palette: HTMLElement, doc: Document = palette.ownerDocument): void {
  const itemOf = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>(".pal-item") : null;
  palette.addEventListener("pointerover", (e) => {
    if (e.pointerType === "mouse") showHint(itemOf(e.target), doc);
  });
  palette.addEventListener("pointerout", (e) => {
    const item = itemOf(e.target);
    if (e.pointerType === "mouse" && item && !(e.relatedTarget instanceof Node && item.contains(e.relatedTarget)))
      showHint(null, doc);
  });
  palette.addEventListener("focusin", (e) => showHint(itemOf(e.target), doc));
  palette.addEventListener("focusout", () => showHint(null, doc));
}

/** Show `item`'s name and description in the bar, or hand the cell back to
 *  the picked tool's card. */
function showHint(item: HTMLElement | null, doc: Document): void {
  const hint = doc.getElementById("sb-hint");
  if (!hint) return;
  const name = item?.querySelector(".pal-name")?.textContent?.trim();
  const description = item?.querySelector(".pal-desc")?.textContent?.trim();
  hint.textContent = name && description ? `${name}: ${description}` : "";
  hint.hidden = !hint.textContent;
}

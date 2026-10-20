/**
 * Put text on the clipboard. The async Clipboard API is tried first; a page
 * without it (an insecure context, an older browser) or one that refuses the
 * write falls back to selecting a hidden textarea and `execCommand("copy")`.
 * Resolves false when both fail, so the caller can tell the player to copy by
 * hand.
 */
export async function copyText(
  text: string,
  nav: Pick<Navigator, "clipboard"> = navigator,
  doc: Document = document,
  /** Where the fallback textarea goes. Inside an open modal dialog the rest of
   *  the page is inert and cannot take a selection, so pass that dialog. */
  container: Element = doc.querySelector("dialog[open]") ?? doc.body,
): Promise<boolean> {
  try {
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the selection copy
  }
  const previous = doc.activeElement as HTMLElement | null;
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  container.appendChild(area);
  try {
    area.focus();
    area.select();
    // A copy of an empty selection reports success, so check that the whole
    // text is selected before asking for it.
    if (doc.activeElement !== area || area.selectionEnd - area.selectionStart !== text.length) return false;
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    previous?.focus?.();
  }
}

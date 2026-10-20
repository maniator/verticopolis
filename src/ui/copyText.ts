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
): Promise<boolean> {
  try {
    if (nav.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the selection copy
  }
  const area = doc.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  doc.body.appendChild(area);
  try {
    area.select();
    return doc.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

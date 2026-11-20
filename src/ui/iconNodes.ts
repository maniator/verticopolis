/**
 * The components' pixel icons placed into the game's own elements, the ones
 * no template draws (a toolbar button, a bulletin line, the status bar's news
 * cell). Each icon renders from `iconTemplate` into a fragment of its own and
 * its element is placed from there (the components' `renderDetached`), so the
 * element it lands in keeps the rest of its children.
 *
 * Cost: one small template render per icon placed. The toolbar's icons are
 * placed once at boot; a bulletin line, a toast and the news cell place at
 * most one each, as the line arrives.
 */
import { html } from "lit-html";
import { renderDetached } from "@verticopolis/components/windows/detached";
import { iconTemplate, messageWithIcons, type IconName, type IconOpts } from "@verticopolis/components/windows/icons";

/** The icon `name` as an element to place. */
export function iconNode(name: IconName, opts?: IconOpts, doc: Document = document): Element {
  return renderDetached(doc, html`${iconTemplate(name, opts)}`).elements[0];
}

/** Append `message` to `el`, its known leading emoji swapped for its pixel
 *  icon. Every character of the rest stays a text node, so engine text never
 *  becomes markup. */
export function appendMessage(el: Element, message: string): void {
  const doc = el.ownerDocument;
  for (const part of messageWithIcons(message))
    el.append(typeof part === "string" ? part : renderDetached(doc, html`${part}`).elements[0]);
}

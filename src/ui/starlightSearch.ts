/**
 * Opens a Starlight site's search box from a menu item (the help site's
 * Edit > Find…).
 *
 * Starlight's search button opens its dialog and then listens on `window` for
 * a click outside the dialog, which closes it. A menu item's click is still
 * bubbling up to `window` while its handler runs, so a click on the button
 * from inside that handler would close the dialog straight away. The click
 * waits for the next tick, once the item's own click is done.
 */
export function openStarlightSearch(doc: Document = document): void {
  setTimeout(() => doc.querySelector<HTMLButtonElement>("site-search button[data-open-modal]")?.click());
}

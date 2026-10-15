/**
 * Hand the player a file as a browser download: a blob URL clicked through an
 * anchor with `download` set. Shared by the tower export (`UI.downloadFile`)
 * and the crash report.
 */
export function downloadFile(filename: string, contents: string | Uint8Array, mime: string): void {
  // A Uint8Array may be backed by a SharedArrayBuffer, which Blob refuses;
  // copying into a fresh view satisfies both (exports are ~100KB, so the copy
  // is free).
  const part = typeof contents === "string" ? contents : new Uint8Array(contents);
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking in the same task can abort the download on engines that fetch
  // the blob URL asynchronously (Safari/Firefox), and this is the ONLY way
  // to get a tower out. Give the navigation a generous head start.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

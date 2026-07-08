import type { PlatformPort } from "./types";

/** The plain-browser port: exactly what the game did before the platform seam
 *  existed. Any behavior change here is a regression (PRD N1). */
export const browserPlatform: PlatformPort = {
  isNativeWrapper: false,

  saveFile(filename: string, contents: string | Uint8Array, mime: string): Promise<void> {
    // The contract's plain Uint8Array admits SharedArrayBuffer-backed views,
    // which Blob refuses; copying into a fresh view satisfies both (exports
    // are ~100KB, so the copy is free).
    const part = typeof contents === "string" ? contents : new Uint8Array(contents);
    const blob = new Blob([part], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    // Revoking in the same task can abort the download on engines that fetch
    // the blob URL asynchronously (Safari/Firefox), and this is the ONLY way
    // to get a tower out now. Give the navigation a generous head start.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return Promise.resolve();
  },

  openExternal(url: string): void {
    // The game only passes absolute http(s) URLs (the types.ts contract);
    // refuse anything else so this seam can never become a javascript:/file:
    // gadget if a future call site ever feeds it an untrusted string.
    let scheme = "";
    try {
      scheme = new URL(url).protocol;
    } catch {
      // Not an absolute URL; falls through to the refusal below.
    }
    if (scheme !== "http:" && scheme !== "https:") {
      console.warn("[platform] openExternal refused a non-http(s) URL");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },
};

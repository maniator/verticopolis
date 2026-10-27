import { liveDiagnostics } from "./wasmhost/engineDiagnosticsLive";
import { copyText } from "./ui/copyText";

/** Copy the engine diagnostics from the stop screen, where Help cannot be
 *  opened (#963). The report is built from the page's own state, so it works
 *  when the engine never loaded. */
export function copyEngineDiagnostics(e: Event): void {
  const status = (e.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(".engine-failure-copy-status");
  const host = document.getElementById("boot-fallback-host") ?? document.body;
  const { text } = liveDiagnostics();
  void copyText(text, navigator, document, host).then((ok) => {
    if (status) status.textContent = ok ? "Copied." : "Could not copy. Select the text below and copy it by hand.";
    if (ok) return;
    // Nothing reached the clipboard, so show the report where it can be selected.
    let area = host.querySelector<HTMLTextAreaElement>(".engine-failure-copy-text");
    if (!area) {
      area = document.createElement("textarea");
      area.className = "engine-failure-copy-text";
      area.readOnly = true;
      area.rows = 12;
      area.setAttribute("aria-label", "Engine diagnostics");
      area.style.cssText = "width:min(48em,100%);box-sizing:border-box;font:12px/1.4 ui-monospace,monospace;text-align:left";
      status?.closest("p")?.insertAdjacentElement("afterend", area);
    }
    area.value = text;
    area.focus();
    area.select();
  });
}

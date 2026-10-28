import { repairEnginePackage, repairMessage, updateRegistration, type RepairResult } from "./wasmhost/engineRepair";

/**
 * The stop screen's Repair engine files button (#985, design 5.4): runs the
 * repair, says what happened in the status beside the button, and leaves the
 * button available for another try. It never reloads the page or activates a
 * worker; the player presses Reload.
 */
export async function runEngineRepair(e: Event, repair: () => Promise<RepairResult> = () => repairEnginePackage({ update: updateRegistration })): Promise<void> {
  const button = e.currentTarget as HTMLButtonElement;
  const status = button.parentElement?.querySelector<HTMLElement>(".engine-failure-repair-status");
  if (button.getAttribute("aria-disabled") === "true") return;
  button.setAttribute("aria-disabled", "true");
  if (status) status.textContent = "Repairing the engine files.";
  try {
    if (status) status.textContent = repairMessage(await repair());
  } catch {
    if (status) status.textContent = repairMessage({ ok: false, reason: "unavailable" });
  } finally {
    button.removeAttribute("aria-disabled");
  }
}

/**
 * Engine-neutral copy shared by simulation logs, notifications and the UI.
 * This module contains text only, with no gameplay or engine imports.
 * Keep in sync with the VacateReason union in src/engine/types.ts; that
 * module enforces Record<VacateReason, string> at compile time.
 */
export const VACATE_REASON_TEXT = {
  access: "no route to the lobby",
  noTransport: "no way to transportation from here",
  congestion: "overcrowded vertical transport",
  rent: "rent set too high",
  noise: "a noisy neighbor nearby",
  transportFar: "too far from a stairway, escalator, or passenger elevator",
  lobbyFar: "too far from a lobby or sky lobby",
  unmetDemand: "too few shops or restaurants within reach",
  relocation: "the household is relocating",
};

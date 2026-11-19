import { readFileSync } from "node:fs";
import { decodeVctower } from "../../storage/vctowerContainer";
import type { SerializedGame } from "@verticopolis/components/shared/types";
import { scheduleFromSlots } from "@verticopolis/components/port/scheduleSlots";
import { createAppHistory } from "../../game/appHistory";
import { createCardKit } from "../../game/cardKit";
import { newViewReader } from "../../game/portAccess";
import { ScheduleReview } from "../../game/scheduleReview";
import { browserAcknowledgements } from "../../game/scheduleRecovery";
import type { ReviewRow } from "../../ui/templates/scheduleReview";
import { engineFromSave } from "../portKit/rustEngine";

/**
 * The schedule review's integration harness (#1548): the game's own pieces around one tower on the Rust engine
 * (the port, the view, the card kit, real Undo and the review), with every message it shows recorded. Shared by
 * `scheduleReview.integration.test.ts` and `scheduleReviewClassic.integration.test.ts`.
 */

export const load = (name: string) => decodeVctower(readFileSync(`node_modules/@verticopolis/engine/conformance/fixtures/${name}.vctower`, "utf8")) as SerializedGame;
export const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
};

/** The paths at which two JSON values differ, so a test can say exactly what a command touched. */
export function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (a === b) return [];
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return [path];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}/${k}`));
}

/** The game's own pieces around one tower: the port, the view, the card kit, real Undo, and the review. */
export function play(raw: SerializedGame, store: Parameters<typeof browserAcknowledgements>[0] = memory()) {
  const port = engineFromSave(JSON.stringify(raw));
  const reader = newViewReader(port);
  reader.update();
  const kit = createCardKit({ enginePort: port, reader });
  const toasts: string[] = [];
  const opened: number[] = [];
  const said: string[] = [];
  const order: string[] = [];
  const announced: string[] = [];
  const shown: { rows: readonly ReviewRow[]; handlers: Record<string, () => void>; focus?: string }[] = [];
  const history = createAppHistory({
    enginePort: port,
    ui: { toast: (t) => void toasts.push(t) },
    followSwap: () => reader.update(),
    showSteps: () => {},
  });
  const review = new ScheduleReview({
    engine: () => port,
    reader: () => reader,
    kit: () => kit,
    ui: {
      toast: (t) => void toasts.push(t),
      sayVisibly: (t) => void (said.push(t), order.push("say")),
      showScheduleReview: (rows, handlers, focus) => {
        shown.push({ rows, handlers: handlers ?? {}, focus });
        order.push("open");
        return document.createElement("div");
      },
    },
    audio: { sfx: () => {} },
    captureUndo: (label) => history.capture(label),
    commitUndo: () => history.commit(),
    refreshEditor: () => {},
    announce: (m) => void announced.push(m),
    openSchedule: (id) => void opened.push(id),
    acknowledgements: browserAcknowledgements(store),
  });
  const saved = () => JSON.parse(port.serialize()) as unknown;
  const scheduleOf = (id: number) => scheduleFromSlots(port.shaftSchedule(id));
  const dialog = () => shown[shown.length - 1]!;
  return {
    port,
    reader,
    kit,
    review,
    history,
    toasts,
    said,
    order,
    announced,
    opened,
    shown,
    dialog,
    saved,
    scheduleOf,
    store,
  };
}

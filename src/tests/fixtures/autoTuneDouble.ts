import { coerceSchedule } from "../../engine/elevatorSchedule";
import { referenceFacts, referencePreset, referenceProposal, type ShaftFacts } from "../../engine/port/queries";
import type { ScheduleDialogCtx } from "../../ui/uiElevatorSchedule";

type DoubleCtx = Pick<ScheduleDialogCtx, "cars" | "bottom" | "top" | "stops" | "origins" | "isExpress"> & {
  /** The shaft's measured curves, as the engine would hold them. */
  hourly?: { weekday?: readonly number[]; weekend?: readonly number[] };
};

/**
 * Stand-ins for the engine's schedule queries (Auto-tune, the advice and
 * staging facts, and the presets), for the schedule dialog's unit tests, which
 * hand the dialog fake stops and curves instead of a tower. They answer from
 * those fakes through the TypeScript references (`referenceProposal`,
 * `referenceFacts`, `referencePreset`), the same functions the real-WASM
 * parity tests pin the Rust engine to (`autoTuneProposal.integration.test.ts`,
 * `scheduleAuthoring.integration.test.ts`), so what the dialog does with an
 * answer is tested here and what the answer is, there.
 */
function shaftOf(ctx: DoubleCtx, modern: boolean): ShaftFacts {
  const rows = ctx.stops.read();
  return {
    modern,
    cars: ctx.cars,
    bottom: ctx.bottom,
    top: ctx.top,
    served: rows.filter((r) => r.served).map((r) => r.floor).sort((a, b) => a - b),
    lobbies: new Set(rows.filter((r) => r.served && r.lobby).map((r) => r.floor)),
    hourly: ctx.hourly && { weekday: [...(ctx.hourly.weekday ?? [])], weekend: [...(ctx.hourly.weekend ?? [])] },
    origins: ctx.origins,
    express: ctx.isExpress,
  };
}

export function referenceEngine(ctx: DoubleCtx, modern = true): Pick<ScheduleDialogCtx, "autoTune" | "facts" | "preset"> {
  return {
    autoTune: (draft, weekendView) =>
      referenceProposal(shaftOf(ctx, modern), coerceSchedule(draft, ctx.cars, ctx.bottom, ctx.top), weekendView),
    facts: (draft, weekendView) =>
      referenceFacts(shaftOf(ctx, modern), coerceSchedule(draft, ctx.cars, ctx.bottom, ctx.top), weekendView),
    preset: (name) => referencePreset(shaftOf(ctx, modern), name),
  };
}

export function referenceAutoTune(ctx: DoubleCtx, modern = true): ScheduleDialogCtx["autoTune"] {
  return referenceEngine(ctx, modern).autoTune;
}

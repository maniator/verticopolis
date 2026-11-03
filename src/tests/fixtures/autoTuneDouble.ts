import { coerceSchedule } from "../../engine/elevatorSchedule";
import { referenceProposal } from "../../engine/port/queries";
import type { ScheduleDialogCtx } from "../../ui/uiElevatorSchedule";

/**
 * A stand-in for the engine's Auto-tune proposal, for the schedule dialog's
 * unit tests, which hand the dialog fake stops and curves instead of a tower.
 * It answers from those fakes through the TypeScript reference
 * (`referenceProposal`), the same function the real-WASM parity test pins
 * the Rust engine to (`autoTuneProposal.integration.test.ts`), so what the
 * dialog does with an answer is tested here and what the answer is, there.
 */
export function referenceAutoTune(
  ctx: Pick<ScheduleDialogCtx, "cars" | "bottom" | "top" | "stops" | "origins"> & {
    /** The shaft's measured curves, as the engine would hold them. */
    hourly?: { weekday?: readonly number[]; weekend?: readonly number[] };
  },
  modern = true,
): ScheduleDialogCtx["autoTune"] {
  return (draft, weekendView) => {
    const rows = ctx.stops.read();
    return referenceProposal(
      {
        modern,
        cars: ctx.cars,
        bottom: ctx.bottom,
        top: ctx.top,
        served: rows.filter((r) => r.served).map((r) => r.floor).sort((a, b) => a - b),
        lobbies: new Set(rows.filter((r) => r.served && r.lobby).map((r) => r.floor)),
        hourly: ctx.hourly && { weekday: [...(ctx.hourly.weekday ?? [])], weekend: [...(ctx.hourly.weekend ?? [])] },
        origins: ctx.origins,
      },
      coerceSchedule(draft, ctx.cars, ctx.bottom, ctx.top),
      weekendView,
    );
  };
}

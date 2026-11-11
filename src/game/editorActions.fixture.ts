import { vi } from "vitest";
import { PortCodes } from "../simport/portCodes";
import { catalogFor } from "../tests/catalogFixture";
import { LAYOUT, mockPort } from "../tests/portKit/mockPort";
import type { CardKit } from "./cardKit";
import { EditorActions, type EditorActionsDeps } from "./editorActions";

/** The editor actions over a mock port and card kit, for
 *  `editorActions.test.ts` and `editorActionsSchedule.test.ts`. */
export const CATALOG = catalogFor("classic");

/** A command record: status 1 (done) or 0 (refused), then the op's slots. */
export function rec(
  op: string,
  ok: boolean,
  slots: Record<string, number> = {},
): Float64Array {
  const all: Record<string, number> = { ...slots, status: ok ? 1 : 0 };
  return Float64Array.from(LAYOUT.records[op].map((n) => all[n] ?? 0));
}

export const office: { id: number; kind: string; filmPolicy?: string } = {
  id: 7,
  kind: "office",
};
export const lift = {
  id: 12,
  kind: "elevatorStandard",
  bottom: 1,
  top: 5,
  cars: 2,
  stops: [1, 2, 3, 4, 5],
  origins: { weekday: [[[3, 2]]], weekend: [[]] } as unknown,
};
export const SCHEDULE = { cars: [] };

export type Answers = Parameters<typeof mockPort>[0];

export function setup(
  answers: Answers = {},
  selected: { type: "unit" | "transport"; id: number } | null = {
    type: "unit",
    id: office.id,
  },
) {
  const port = mockPort({
    lastReason: () => "The engine said no.",
    ...answers,
  });
  const codes = new PortCodes(port);
  const cards = {
    unit: vi.fn((id: number) => (id === office.id ? { ...office } : undefined)),
    shaft: vi.fn((id: number) => (id === lift.id ? { ...lift } : undefined)),
    forget: vi.fn(),
  };
  const kit = {
    cards,
    catalog: () => CATALOG,
    currentSchedule: vi.fn(() => SCHEDULE),
    previewRentBatch: vi.fn(() => ({ matched: 3 })),
  } as unknown as CardKit;
  const reader = { header: {} as never, update: vi.fn() };
  const deps = {
    engine: () => port,
    codes: () => codes,
    reader: () => reader,
    kit: () => kit,
    ui: {
      toast: vi.fn(),
      showBatchPricingDialog: vi.fn(),
      showElevatorScheduleDialog: vi.fn(),
    },
    audio: { sfx: vi.fn() },
    build: {
      tryRemoveUnit: vi.fn(() => true),
      removeTransportWithRefund: vi.fn(() => true),
    },
    selected: vi.fn(() => selected),
    clearSelection: vi.fn(),
    refreshEditor: vi.fn(),
    captureUndo: vi.fn(),
    commitUndo: vi.fn(),
    undoGesture: vi.fn(() => 1),
    announce: vi.fn(),
  } satisfies EditorActionsDeps;
  return {
    port,
    codes,
    cards,
    kit,
    reader,
    deps,
    actions: new EditorActions(deps),
  };
}

/** A root holding the editor card's inputs. */
export function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

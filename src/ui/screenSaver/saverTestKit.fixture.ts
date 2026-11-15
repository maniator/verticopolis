import { vi } from "vitest";

/** A 2D context double: every drawing call is a spy, so a scene test asserts
 *  what was drawn and how often. */
export function ctxDouble() {
  return {
    canvas: { width: 0, height: 0 },
    fillStyle: "" as unknown,
    globalAlpha: 1,
    font: "",
    imageSmoothingEnabled: true,
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 40 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
}

export type CtxDouble = ReturnType<typeof ctxDouble>;

export const asCtx = (c: CtxDouble) => c as unknown as CanvasRenderingContext2D;

/** A fixed sequence of "random" numbers, cycling. */
export function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

import { vi } from "vitest";

/**
 * Shared harness for the sprite-review page guards, which run `preview.ts` and
 * `gallery.ts` for a frame without a real canvas.
 */

/**
 * Run `load` (a page's dynamic import) and return a function that removes every
 * window listener the page registered while it loaded. The gallery listens for
 * `resize` at module scope, and the Vitest worker's window outlives the test
 * file, so without this the listener (and the page it closes over) leaks into
 * whatever file the worker runs next.
 */
export async function importRemovingWindowListeners(load: () => Promise<unknown>): Promise<() => void> {
  const added: Array<[string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]> = [];
  const original = window.addEventListener;
  const spy = vi.spyOn(window, "addEventListener").mockImplementation(function (
    this: Window,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (!listener) return;
    added.push([type, listener, options]);
    original.call(this, type, listener, options);
  });
  try {
    await load();
  } finally {
    spy.mockRestore();
  }
  return () => {
    for (const [type, listener, options] of added) window.removeEventListener(type, listener, options);
  };
}

/** A 2D-context stand-in that absorbs every call; the hooks report the calls a
 *  guard wants to see. */
export interface FakeContextHooks {
  /** Every `ctx.scale(sx, sy)` call. The pages magnify by transforming the
   *  context, so this is the only place the real factor can be observed. */
  onScale?: (sx: number, sy: number) => void;
  /** Every `ctx.fillText(text)` call: proof a page actually drew its cells. */
  onFillText?: (text: string) => void;
}

export function fakeContext(hooks: FakeContextHooks = {}): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {};
  const ctx: unknown = new Proxy({} as Record<string | symbol, unknown>, {
    get(_t, prop) {
      if (prop === "canvas") return { width: 4096, height: 4096, getContext: () => ctx };
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") {
        return () => ({ addColorStop: () => {} });
      }
      if (prop === "measureText") return () => ({ width: 4 });
      if (prop === "scale") return (sx: number, sy: number) => hooks.onScale?.(sx, sy);
      if (prop === "fillText") return (text: string) => hooks.onFillText?.(text);
      if (prop in store) return store[prop];
      return () => {};
    },
    set(_t, prop, value) {
      store[prop] = value;
      return true;
    },
  });
  return ctx as CanvasRenderingContext2D;
}

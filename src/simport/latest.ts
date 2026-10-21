/**
 * Keeps a panel to its newest question (facade slice 4, #1211). A panel that
 * asks the port again before the last answer arrived (a new selection, a new
 * pointer cell, the next refresh) only wants the newest answer: on a worker an
 * older one can land later and would paint over it. `latest()` returns a
 * function that takes the promise of an answer and the render for it, and
 * runs the render only if no newer promise was handed to it since. On the
 * TypeScript adapter and the main-thread Rust one the answer lands in a
 * microtask of the same task, so the order never changes there and nothing
 * paints between the question and the render.
 *
 * The returned promise settles after the render (or after skipping it). It
 * carries the newest question's rejection, so the caller decides where a
 * failure goes; a question a newer one replaced settles quietly either way,
 * since nobody is waiting for its answer.
 */
export function latest<T>(): (answer: Promise<T>, render: (value: T) => void) => Promise<void> {
  let newest = 0;
  return (answer, render) => {
    const mine = ++newest;
    return answer.then(
      (value) => {
        if (mine === newest) render(value);
      },
      (e: unknown) => {
        if (mine === newest) throw e;
      },
    );
  };
}

/** One {@link latest} per owner (an app, a panel), made on first use, so two
 *  owners never drop each other's answers. */
export function latestPer<T>(): (owner: object) => ReturnType<typeof latest<T>> {
  const asks = new WeakMap<object, ReturnType<typeof latest<T>>>();
  return (owner) => {
    let ask = asks.get(owner);
    if (!ask) asks.set(owner, (ask = latest<T>()));
    return ask;
  };
}

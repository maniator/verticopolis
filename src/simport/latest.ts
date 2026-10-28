/**
 * Orders a panel's answers from the port (facade slice 4, #1211). Two tokens:
 * {@link latest} keeps a panel to its newest question, for panels that show
 * one answer at a time (cards, previews); {@link inOrder} never draws an older
 * answer after a newer one and, on a port that answers in order, draws every
 * answer, for a panel whose drawing carries state from one answer to the next
 * (the traffic chip).
 *
 * `latest` keeps a panel to its newest question. A panel that asks the port
 * again before the last answer arrived (a new selection, a new pointer cell,
 * the next refresh) only wants the newest answer: on a worker an older one can
 * land later and would paint over it. `latest()` returns a
 * function that takes the promise of an answer and the render for it, and
 * runs the render only if no newer promise was handed to it since. The
 * TypeScript adapter computes its answer as it is asked and resolves with it,
 * so the answer lands in a microtask of the same task, the order never
 * changes, and nothing paints between the question and the render; the
 * main-thread Rust adapter (slice 7) is to answer the same way.
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
  return perOwner(() => latest<T>());
}

/**
 * Like {@link latest}, for a panel whose drawing carries state from one answer
 * to the next (the traffic chip's hysteresis), so skipping an answer would
 * change what it shows. Every answer is drawn, in the order it was asked,
 * except one that lands after a newer question has already settled: that one
 * is dropped, and its failure with it. Answers that land in order, as the
 * TypeScript adapter's do, are all drawn, as a synchronous read drew every
 * refresh, even when several questions are out at once (the screenshot
 * tooling's stepped clock asks several times in one task).
 *
 * It does not hold back new questions while one is out. A port that answers
 * more slowly than the panel asks (a worker) would queue a question per
 * refresh and draw each late answer in turn, so that port must bring its own
 * back-pressure before a per-tick panel uses it (slice 4's story records this
 * for the worker host).
 */
export function inOrder<T>(): (answer: Promise<T>, render: (value: T) => void) => Promise<void> {
  let asked = 0;
  let settled = 0;
  return (answer, render) => {
    const mine = ++asked;
    return answer.then(
      (value) => {
        if (mine < settled) return;
        settled = mine;
        render(value);
      },
      (e: unknown) => {
        if (mine < settled) return;
        settled = mine;
        throw e;
      },
    );
  };
}

/** One {@link inOrder} per owner, made on first use. */
export function inOrderPer<T>(): (owner: object) => ReturnType<typeof inOrder<T>> {
  return perOwner(() => inOrder<T>());
}

function perOwner<F>(make: () => F): (owner: object) => F {
  const made = new WeakMap<object, F>();
  return (owner) => {
    let f = made.get(owner);
    if (f === undefined) made.set(owner, (f = make()));
    return f;
  };
}

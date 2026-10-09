import type { Simulation } from "./Simulation";
import type { SerializedGame } from "./serializedGame";

/**
 * The two views the engine conformance suite hashes (conformance/README.md).
 * They live here, engine-pure, so the browser's dual run can take them from
 * the live simulation; the digest itself stays with the tests.
 */

/** The saved game minus prose: log entry `text` and the pending choice's
 *  `message` are player copy (locale-formatted money), so they stay out of the
 *  hash. Every other field of both stays in. */
export function stateView(sim: Simulation): unknown {
  const data = sim.serialize() as SerializedGame & Record<string, unknown>;
  const view: Record<string, unknown> = { ...data };
  if (data.log) view.log = data.log.map(({ text: _text, ...rest }) => rest);
  const events = data.events as { pending?: { message: string } | null } | undefined;
  if (events?.pending) {
    const { message: _message, ...pending } = events.pending;
    view.events = { ...events, pending };
  }
  return view;
}

/** The live crowd, which saves never carry: its people, id source and rng. */
export function crowdView(sim: Simulation): unknown {
  return { nextId: sim.crowd.nextId, rng: sim.crowd.rng.seed, people: sim.crowd.people };
}

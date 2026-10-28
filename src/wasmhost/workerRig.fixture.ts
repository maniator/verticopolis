import { Simulation } from "../engine/Simulation";
import { attachWorkerHost, type WorkerHost } from "./workerHost";
import { EngineWorkerCore } from "./workerCore";
import { stepGate } from "./stepGate";
import type { FromWorker, ToWorker } from "./workerProtocol";
import { fakeModule, type FakeEngine } from "./fakeEngine.fixture";

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

/** A loopback between the host and a core on the fake engine: every
 *  message is structured-cloned and delivered in a later task. */
export function rig(sim = Simulation.newGame(7, "classic"), mod = fakeModule()) {
  const toHost: FromWorker[] = [];
  const toWorker: ToWorker[] = [];
  const fatal: string[] = [];
  const errors: string[] = [];
  let host: WorkerHost | null = null;
  const core = new EngineWorkerCore(mod, (msg) => {
    toHost.push(msg);
    const copy = structuredClone(msg);
    setTimeout(() => host?.receive(copy), 0);
  });
  host = attachWorkerHost(sim, {
    gen: 1,
    catalogs: core.catalogs(),
    send: (msg) => {
      toWorker.push(msg);
      const copy = structuredClone(msg);
      setTimeout(() => core.handle(copy), 0);
    },
    onFatal: (m) => fatal.push(m),
    onError: (m) => errors.push(m),
  });
  const engine = (): FakeEngine => last(mod.engines)!;
  const settleTasks = async (n = 8) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { sim, host, core, mod, engine, toHost, toWorker, fatal, errors, settleTasks, gate: () => stepGate(sim)! };
}

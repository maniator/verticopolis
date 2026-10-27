import { checkBinding } from "../dualrun/binding";
import { EngineBootError, bootFailureReason, packageFailureOf } from "./engineBoot";
import { loadEngineModule } from "./loadEngineModule";
import type { BuildMetadataResult } from "./buildSection";
import { EngineWorkerCore } from "./workerCore";
import type { FromWorker, ToWorker } from "./workerProtocol";

/**
 * The engine worker's entry point (experimental, `?engine=wasm-worker`): the
 * browser glue around {@link EngineWorkerCore}. The first message names the
 * package URL (resolved against the page, which a worker cannot do for
 * itself); messages that arrive while it loads are queued and applied in
 * order once it is ready. A package that fails to load answers with one
 * error, and the main thread stays on the TypeScript engine.
 */
type Scope = { postMessage(msg: FromWorker, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const scope = self as unknown as Scope;
const post = (msg: FromWorker, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

let core: EngineWorkerCore | null = null;
let queue: ToWorker[] | null = [];
let loading = false;
/** What the binary's build section said, kept so a load that fails after the
 *  binary compiled can still report it (#963). */
let build: BuildMetadataResult | undefined;

async function load(url: string): Promise<void> {
  // The same byte check as the main thread's (the respawn path loads here
  // too); a refusal reaches the main thread with its detail.
  const { mod, exports } = await loadEngineModule(url, {
    onBuild: (b) => {
      build = b;
      post({ type: "build", build: b });
    },
  });
  let binding: ReturnType<typeof checkBinding>;
  try {
    binding = checkBinding(mod);
  } catch (e) {
    // A package that passes the byte check but lacks what this shell calls is
    // a mismatched one, as the main-thread load codes it.
    throw new EngineBootError("package-mismatch", e instanceof Error ? e.message : String(e));
  }
  const ready = new EngineWorkerCore(binding, post, () => exports?.memory?.buffer.byteLength ?? null);
  // No catalog function at all is a foreign package, as the main-thread host
  // codes it (catalogVerdict).
  if (typeof binding.catalog !== "function") throw new EngineBootError("package-mismatch", "the WASM binding exports no catalog");
  post({ type: "ready", catalogs: ready.catalogs(), identity: ready.identity(), build });
  core = ready;
  const pending = queue ?? [];
  queue = null;
  for (const msg of pending) core.handle(msg);
}

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    if (loading) return;
    loading = true;
    load(msg.url).catch((err: unknown) => {
      queue = null;
      const refused = packageFailureOf(err);
      post({ type: "error", fatal: true, message: `could not load the Rust engine: ${err instanceof Error ? err.message : String(err)}`, reason: bootFailureReason(err), ...(refused ? { package: refused } : {}), ...(build ? { build } : {}) });
    });
    return;
  }
  if (core) core.handle(msg);
  else queue?.push(msg);
};

import { checkBinding } from "./binding";
import type { ShadowCommand } from "./commands";
import { ShadowEngine } from "./shadow";

/**
 * The dual run's worker: loads the browser build of the binding
 * (`src/public/engine/`, written by `npm run wasm:build`), holds the
 * shadow engine, applies the commands the main thread posts in order, and
 * answers every checkpoint with the first divergence it found or an ok.
 * Every reply about a tower carries the generation of that tower's load.
 * The package is served beside the app (`src/public/engine/`), loaded by the URL
 * the controller sends first, so a bundle never carries it and a checkout
 * without it reports the missing module instead.
 */
export type WorkerReply =
  | { type: "ready" }
  | { type: "ok"; gen: number; label: string }
  | { type: "divergence"; gen: number; label: string; view: "state" | "crowd"; path: string; live: string; shadow: string }
  | { type: "error"; gen?: number; message: string };

const post = (reply: WorkerReply) => (self as unknown as { postMessage(r: WorkerReply): void }).postMessage(reply);
const show = (v: unknown) => {
  const text = JSON.stringify(v);
  if (text === undefined) return "undefined";
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
};

let shadow: ShadowEngine | null = null;
/** The generation of the last load, so an ordinary command's failure is
 *  charged to the tower it belongs to rather than to whichever tower the
 *  controller follows by the time the reply arrives. */
let gen: number | undefined;
/** Commands that arrived before the module loaded; dropped once loading
 *  has failed, since nothing will ever apply them. */
let queue: ShadowCommand[] | null = [];

async function load(url: string): Promise<void> {
  const mod = (await import(/* @vite-ignore */ url)) as { default: () => Promise<unknown> };
  await mod.default();
  shadow = new ShadowEngine(checkBinding(mod));
  post({ type: "ready" });
  const pending = queue ?? [];
  queue = null;
  for (const cmd of pending) handle(cmd);
}

function handle(cmd: ShadowCommand): void {
  if (!shadow) {
    queue?.push(cmd);
    return;
  }
  // After a refused load nothing can apply until the next load, so the
  // commands in between are dropped rather than each reported.
  if (!shadow.loaded() && cmd.op !== "load") return;
  if (cmd.op === "load") gen = cmd.gen;
  try {
    const d = shadow.apply(cmd);
    if (cmd.op === "checkpoint") {
      if (d) post({ type: "divergence", gen: cmd.gen, label: d.label, view: d.view, path: d.path, live: show(d.live), shadow: show(d.shadow) });
      else post({ type: "ok", gen: cmd.gen, label: cmd.label });
    }
  } catch (e) {
    post({ type: "error", gen, message: `${cmd.op}: ${e instanceof Error ? e.message : String(e)}` });
  }
}

/** The controller's first message: where the package is served (resolved
 *  against the page, which a worker cannot do for itself). */
export interface WorkerInit {
  type: "init";
  url: string;
}

let loading = false;
self.onmessage = (e: MessageEvent<ShadowCommand | WorkerInit>) => {
  const data = e.data;
  if ("type" in data && data.type === "init") {
    if (loading) return;
    loading = true;
    load(data.url).catch((err: unknown) => {
      queue = null;
      post({ type: "error", message: `could not load the WASM binding: ${err instanceof Error ? err.message : String(err)}` });
    });
    return;
  }
  handle(data as ShadowCommand);
};

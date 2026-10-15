import type { ShadowCommand } from "../dualrun/commands";

/**
 * The messages between the main thread and the engine worker
 * (`engineWorker.ts`, experimental, `?engine=wasm-worker`). The design and
 * its reasons are in `docs/architecture/wasm-worker-host.md`.
 *
 * The worker holds the one authoritative engine. The main thread holds the
 * read model the renderer and the panels read, and the frame loop that paces
 * the clock (#867): it decides how many minutes each step covers, exactly as
 * it does for the other hosts, and sends the steps in order with the
 * commands. Every step and every command carries a sequence number from one
 * counter per tower (`seq`), the worker applies them in that order, and each
 * reply says the last one it applied, so the main thread knows which of its
 * own commands a reply already includes.
 *
 * Every message about a tower carries that tower's generation (`gen`); a
 * reply for an older tower is ignored.
 */

/** The first message: where the package is served. */
export interface InitMessage {
  type: "init";
  url: string;
}

/** Start a tower from its save and boundary markers (the same payload the
 *  dual run's load command carries). Resets `seq` to 0. */
export interface LoadMessage {
  type: "load";
  gen: number;
  save: string;
  markers: { lastHour: number; lastDay: number; lastQuarter: number; lastMonth: number };
}

/** One step or one command, in send order. */
export type Op = { seq: number; dt: number } | { seq: number; cmd: Exclude<ShadowCommand, { op: "load" | "tick" | "checkpoint" }> };

/** What the main thread asks the next reply to carry. `logSeq` is the
 *  engine log cursor the main thread has applied, so the reply holds only
 *  the entries after it. `merge` asks for the full save even when the
 *  tower's revision and hour pass did not move (the main thread skipped one,
 *  or wants an exact save to write). */
export interface FrameRequest {
  req: number;
  logSeq: number;
  merge: boolean;
}

/** Steps and commands, then (optionally) a frame request answered after
 *  them. The main thread sends one per rendered frame that stepped, and one
 *  per command between frames. */
export interface OpsMessage {
  type: "ops";
  gen: number;
  ops: Op[];
  request?: FrameRequest;
}

/** Free the tower's engine (the main thread let it go). */
export interface FreeMessage {
  type: "free";
  gen: number;
}

export type ToWorker = InitMessage | LoadMessage | OpsMessage | FreeMessage;

/** The package loaded. Carries the catalogs as the binding's text, so the
 *  main thread reads prices and build rules from the engine without loading
 *  a second copy of it. */
export interface ReadyReply {
  type: "ready";
  catalogs: { classic: string; modern: string };
}

/** The tower's engine exists; `view` is its first frame. */
export interface LoadedReply {
  type: "loaded";
  gen: number;
  view: Float64Array;
}

/** The full-save half of a frame, sent when the tower's revision or the
 *  engine's hour pass moved since the last one sent, or when asked for. */
export interface MergePayload {
  save: string;
  telemetry: string;
  housekeeping: string | null;
}

/** The answer to a frame request. `view` is the engine's frame view, its
 *  buffer transferred. `events` is every gameplay event the engine emitted
 *  since the last reply, as the binding's JSON text (the one drain; the main
 *  thread fans them out). `log` is the binding's entries after the request's
 *  cursor, or null when the cursor is current. `pending` is the pending
 *  choice's text while one is up. `workMs` is the worker's time on the ops
 *  and on building this reply, for the benchmark, as is `memoryBytes`. */
export interface FrameReply {
  type: "frame";
  gen: number;
  req: number;
  seq: number;
  view: Float64Array;
  events: string;
  dropped: number;
  log: string | null;
  pending: string | null;
  merge: MergePayload | null;
  workMs: { ops: number; reply: number };
  /** The worker's WASM linear memory, when the entry point can read it. */
  memoryBytes: number | null;
}

/** A load, a step or a command the engine refused or failed on. `seq` is
 *  the op's, when it was one. `fatal` marks an error the tower cannot go on
 *  past (a refused load, a gap in the sequence, a reply that could not be
 *  built): the main thread lets the tower go. An error without it is one
 *  op the engine refused, reported while the host goes on. */
export interface ErrorReply {
  type: "error";
  gen?: number;
  seq?: number;
  fatal: boolean;
  message: string;
}

export type FromWorker = ReadyReply | LoadedReply | FrameReply | ErrorReply;

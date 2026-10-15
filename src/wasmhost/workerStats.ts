import type { FromWorker, ToWorker } from "./workerProtocol";

/** The worker host's interface and its options (the host itself is
 *  `workerHost.ts`). */
export interface WorkerHost {
  readonly gen: number;
  readonly stats: WorkerHostStats;
  /** Whether the worker has loaded the tower. */
  loaded(): boolean;
  /** Whether the gate is open: loaded, nothing in flight, and the last reply
   *  included every command. */
  idle(): boolean;
  /** Route a worker reply here. */
  receive(msg: FromWorker): void;
  /** The frame loop's flush: send the batch with a frame request, when
   *  nothing is in flight and there is something to answer for. */
  flush(): void;
  /** Resolve once the read model includes every op sent and the engine's
   *  exact save is held (or the host has let go). */
  settle(): Promise<void>;
  detach(): void;
}

export interface WorkerHostOptions {
  gen: number;
  /** The catalogs' text from the worker's ready reply. */
  catalogs: { classic: string; modern: string };
  send(msg: ToWorker, transfer?: Transferable[]): void;
  /** A failure the host cannot continue past (a refused load, a gap in the
   *  sequence, a malformed reply, a clock that disagrees with the engine's).
   *  The controller lets the host go and the tower continues on the
   *  TypeScript engine from the read model. */
  onFatal(message: string): void;
  /** An op the engine refused or failed on: reported, and the host goes on,
   *  as the main-thread host goes on after a command the engine threw on. */
  onError(message: string): void;
  /** How long the worker gets to answer a load or a frame request before
   *  the host gives up on it (a hung worker, a lost reply). */
  replyTimeoutMs?: number;
}

/** The worker host's counters, for the benchmark and for tooling: what
 *  crossed the boundary, how long the main thread spent on it, and how long
 *  commands took to be acknowledged. Kept apart from the host itself. */
export interface WorkerHostStats {
  /** Messages and payload sent to the worker and received from it. */
  messagesSent: number;
  messagesReceived: number;
  opsSent: number;
  /** Bytes received: frame views, plus the text fields at two bytes a
   *  character (the size a structured clone of a JS string copies). */
  bytesReceived: number;
  frameBytes: number;
  mergeBytes: number;
  merges: number;
  replies: number;
  /** Replies that predated one of the instance's commands. */
  staleReplies: number;
  /** Main-thread time applying replies, and the worker's own time. */
  applyMs: number;
  mergeMs: number;
  workerOpsMs: number;
  workerReplyMs: number;
  /** Command to the first reply that includes it (the ack) and to the end
   *  of applying the first fresh reply that includes it (the change visible
   *  in the read model), in ms, for the last commands (bounded). */
  commandAckMs: number[];
  commandVisibleMs: number[];
  /** Commands a reply has included so far (not bounded). */
  commandsAcked: number;
  /** The seq of the last command sent, and the last op a fresh reply
   *  included, so a caller can wait for one command's acknowledgement. */
  lastCommandSeq: number;
  ackedSeq: number;
  /** `serialize` calls answered with the read model's own save (no exact
   *  engine save was current). */
  approximateSaves: number;
  /** The worker's WASM linear memory at the last reply. */
  workerMemoryBytes: number | null;
}

/** Latency samples kept per list. */
export const LATENCY_SAMPLES = 512;

export function newWorkerHostStats(): WorkerHostStats {
  return {
    messagesSent: 0, messagesReceived: 0, opsSent: 0, bytesReceived: 0, frameBytes: 0, mergeBytes: 0, merges: 0, replies: 0, staleReplies: 0,
    applyMs: 0, mergeMs: 0, workerOpsMs: 0, workerReplyMs: 0, commandAckMs: [], commandVisibleMs: [], commandsAcked: 0, lastCommandSeq: 0, ackedSeq: 0, approximateSaves: 0, workerMemoryBytes: null,
  };
}

export function pushSample(list: number[], v: number): void {
  list.push(v);
  if (list.length > LATENCY_SAMPLES) list.shift();
}

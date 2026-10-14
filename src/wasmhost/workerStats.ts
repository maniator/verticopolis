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
   *  of applying that reply (the change visible in the read model), in ms,
   *  for the last commands (bounded). */
  commandAckMs: number[];
  commandVisibleMs: number[];
  /** Commands a reply has included so far (not bounded). */
  commandsAcked: number;
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
    applyMs: 0, mergeMs: 0, workerOpsMs: 0, workerReplyMs: 0, commandAckMs: [], commandVisibleMs: [], commandsAcked: 0, approximateSaves: 0, workerMemoryBytes: null,
  };
}

export function pushSample(list: number[], v: number): void {
  list.push(v);
  if (list.length > LATENCY_SAMPLES) list.shift();
}

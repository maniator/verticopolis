/** How many error messages a host status keeps in `errors`: the first ones,
 *  so the cause of a run of failures stays readable. */
export const HOST_ERROR_HISTORY = 50;

/** Bounded error history with the latest failure available after overflow. */
export interface HostErrors {
  /** The first `HOST_ERROR_HISTORY` error messages, oldest first. */
  errors: string[];
  /** The latest error message, kept after `errors` is full; null while there
   *  has been none. While `droppedErrors` is 0 it is also that list's last
   *  entry. It is not tied to a fallback: an error recorded while a tower is
   *  still hosted (a detach that threw) replaces it too. The worker host
   *  records a failed detach before the cause when it drops its worker, so
   *  there `errors` lists the detach failure first and this keeps the cause. */
  lastError: string | null;
  /** Errors left out of `errors` because it was full. The latest of them is
   *  still `lastError`, so `droppedErrors - 1` are lost when it is above 0. */
  droppedErrors: number;
}

/** Record one error on a host status: always `lastError`, and `errors` while
 *  it has room, else the dropped count. */
export function recordHostError(status: HostErrors, message: string): void {
  status.lastError = message;
  if (status.errors.length < HOST_ERROR_HISTORY) status.errors.push(message);
  else status.droppedErrors++;
}

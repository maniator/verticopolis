/** Bounded error history with the latest failure available after overflow. */
export interface HostErrors {
  errors: string[];
  lastError: string | null;
  /** Errors omitted from the history, which keeps its first 50 entries. */
  droppedErrors: number;
}

export function recordHostError(status: HostErrors, message: string): void {
  status.lastError = message;
  if (status.errors.length < 50) status.errors.push(message);
  else status.droppedErrors++;
}

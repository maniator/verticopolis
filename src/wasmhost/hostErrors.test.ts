import { describe, expect, it } from "vitest";
import { recordHostError, type HostErrors } from "./hostErrors";

describe("host error history", () => {
  it("keeps the latest failure through overflow and a later recurrence", () => {
    const status: HostErrors = { errors: [], lastError: null, droppedErrors: 0 };
    expect(status.lastError).toBeNull();
    for (let i = 1; i <= 50; i++) recordHostError(status, `error ${i}`);
    expect(status.errors).toHaveLength(50);
    expect(status.lastError).toBe("error 50");
    expect(status.droppedErrors).toBe(0);
    recordHostError(status, "fallback");
    expect(status.lastError).toBe("fallback");
    expect(status.droppedErrors).toBe(1);
    expect(status.errors[49]).toBe("error 50");
    recordHostError(status, "fallback again");
    expect(status.lastError).toBe("fallback again");
    expect(status.droppedErrors).toBe(2);
    expect(status.errors).toHaveLength(50);
  });

  it("keeps histories independent across host sessions", () => {
    const first: HostErrors = { errors: [], lastError: null, droppedErrors: 0 };
    const next: HostErrors = { errors: [], lastError: null, droppedErrors: 0 };
    recordHostError(first, "failed");
    expect(next).toEqual({ errors: [], lastError: null, droppedErrors: 0 });
  });
});
